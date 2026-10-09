#!/usr/bin/env bash
# Autorité de certification de l'institut et certificat du serveur (distribution D-05, D-06).
# Installé en lien sous /usr/local/sbin/lama-certificat, à lancer avec sudo :
#   sudo lama-certificat --adresse 192.168.1.50   autorité créée si elle manque, certificat refait pour cette adresse
#   sudo lama-certificat --renouveler [--forcer]  certificat refait s'il reste moins de 90 jours (ou s'il n'est pas valable)
#   sudo lama-certificat --etat                   empreinte de l'autorité, adresse et échéance du certificat
# Dossier : LAMA_TLS_DIR (défaut /etc/lama/tls) ; commande openssl : LAMA_OPENSSL (défaut openssl).
set -euo pipefail

ICI="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
# Messages dans la langue de LANG ou de LAMA_LANGUE (msg "texte" "text").
source "$ICI/langue.sh"

TLS="${LAMA_TLS_DIR:-/etc/lama/tls}"
OPENSSL="${LAMA_OPENSSL:-openssl}"
COMPTE=lama
NOM=lama.local
DUREE_AUTORITE=3650
DUREE_SERVEUR=397
SEUIL_JOURS=90
# Plus tôt que cette date, l'horloge du serveur est fausse (pile de la carte mère usée) :
# un certificat daté ainsi serait refusé par tous les appareils.
PLANCHER=2026-10-01

echec() { printf '%s\n' "$1" >&2; exit 1; }

# Vrai si l'argument est une adresse IPv4 d'un réseau local (10/8, 172.16/12, 192.168/16),
# les seules que l'autorité permet (contrainte de noms). Les zéros de tête sont refusés (192.168.001.050) :
# openssl 3 les rejette dans le certificat et LibreSSL les normalise, l'adresse gardée différerait.
# Fonction isolée pour les essais.
adresse_valide() {
  local IP="$1" A B C D
  [[ "$IP" =~ ^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$ ]] || return 1
  A=$((10#${BASH_REMATCH[1]})); B=$((10#${BASH_REMATCH[2]})); C=$((10#${BASH_REMATCH[3]})); D=$((10#${BASH_REMATCH[4]}))
  [ "$A" -le 255 ] && [ "$B" -le 255 ] && [ "$C" -le 255 ] && [ "$D" -le 255 ] || return 1
  [ "$A" -eq 10 ] && return 0
  [ "$A" -eq 172 ] && [ "$B" -ge 16 ] && [ "$B" -le 31 ] && return 0
  [ "$A" -eq 192 ] && [ "$B" -eq 168 ] && return 0
  return 1
}

# Vrai si l'horloge est plausible (pas avant PLANCHER).
heure_plausible() {
  [[ ! "$(date -u +%Y-%m-%d)" < "$PLANCHER" ]]
}

# Dossier de travail en cours : effacé à la sortie, réussie ou non (trap posé plus bas).
TRAVAIL_COURANT=""
nettoyer() { [ -z "$TRAVAIL_COURANT" ] || rm -rf "$TRAVAIL_COURANT"; }

# Lance une commande openssl dont la sortie d'erreur est gardée, et s'arrête avec le message
# donné (déjà dans la langue en cours) suivi de ce qu'openssl a dit si elle échoue.
# Usage : openssl_ou_echec "$(msg "fr" "en")" ERREURS COMMANDE...
openssl_ou_echec() {
  local MESSAGE="$1" ERR="$2"
  shift 2
  "$@" 2>"$ERR" || echec "$MESSAGE
$(cat "$ERR")"
}

# Propriétaires et droits (root seulement : sous un compte ordinaire, en essai, seuls les droits sont posés).
proprietaire() {
  local QUI="$1" FICHIER="$2"
  if [ "$(id -u)" -eq 0 ]; then chown "$QUI" "$FICHIER"; fi
}

# S'arrête si une moitié seulement de l'autorité est là : la remplacer en silence obligerait
# chaque appareil à approuver de nouveau l'autorité, c'est une décision à prendre à la main.
controler_autorite() {
  local DOSSIER="$1"
  if { [ -f "$DOSSIER/autorite.crt" ] && [ ! -f "$DOSSIER/autorite.key" ]; } || { [ ! -f "$DOSSIER/autorite.crt" ] && [ -f "$DOSSIER/autorite.key" ]; }; then
    echec "$(msg "L'autorité de $DOSSIER est incomplète (autorite.crt ou autorite.key manque). Elle n'est pas remplacée, tous les appareils devraient l'approuver de nouveau. Restaurez le fichier manquant depuis la sauvegarde, ou supprimez les deux fichiers pour en créer une nouvelle." "The authority in $DOSSIER is incomplete (autorite.crt or autorite.key is missing). It is not replaced, every device would have to approve it again. Restore the missing file from the backup, or delete both files to create a new one.")"
  fi
}

# Crée l'autorité dans DOSSIER si elle manque : clé EC P-256 (root, 0600), certificat de
# 10 ans dont la contrainte de noms ne permet que lama.local et les réseaux locaux.
fabriquer_autorite() {
  local DOSSIER="$1" TRAVAIL
  controler_autorite "$DOSSIER"
  [ -f "$DOSSIER/autorite.crt" ] && return 0
  TRAVAIL="$(mktemp -d "$DOSSIER/.autorite.XXXXXX")"
  TRAVAIL_COURANT="$TRAVAIL"
  cat > "$TRAVAIL/autorite.cnf" <<FIN
[req]
distinguished_name = dn
prompt = no
utf8 = yes
string_mask = utf8only
[dn]
O = lama
CN = Autorité de lama $(date -u +%Y%m%d)-$("$OPENSSL" rand -hex 4)
[ext]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
nameConstraints = critical,permitted;DNS:$NOM,permitted;IP:10.0.0.0/255.0.0.0,permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0
FIN
  ( umask 077; openssl_ou_echec "$(msg "Échec de la fabrication de la clé de l'autorité avec openssl." "openssl failed while making the authority key.")" "$TRAVAIL/erreurs" \
    "$OPENSSL" genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -pkeyopt ec_param_enc:named_curve -out "$TRAVAIL/autorite.key" )
  openssl_ou_echec "$(msg "Échec de la fabrication du certificat de l'autorité avec openssl." "openssl failed while making the authority certificate.")" "$TRAVAIL/erreurs" \
    "$OPENSSL" req -x509 -new -key "$TRAVAIL/autorite.key" -sha256 -days "$DUREE_AUTORITE" -config "$TRAVAIL/autorite.cnf" -extensions ext -out "$TRAVAIL/autorite.crt"
  chmod 0600 "$TRAVAIL/autorite.key"
  chmod 0644 "$TRAVAIL/autorite.crt"
  proprietaire root:root "$TRAVAIL/autorite.key"
  proprietaire root:root "$TRAVAIL/autorite.crt"
  mv -f "$TRAVAIL/autorite.key" "$DOSSIER/autorite.key"
  mv -f "$TRAVAIL/autorite.crt" "$DOSSIER/autorite.crt"
  rm -rf "$TRAVAIL"
}

# Fabrique le certificat du serveur (lama.local et ADRESSE, 397 jours) signé par l'autorité.
# Clé et certificat préparés à côté puis mis en place par renommage, la clé d'abord :
# le serveur ne recharge qu'une paire qui va ensemble (src/server/tls/contexte.ts).
fabriquer_serveur() {
  local DOSSIER="$1" ADRESSE="$2" TRAVAIL
  TRAVAIL="$(mktemp -d "$DOSSIER/.serveur.XXXXXX")"
  TRAVAIL_COURANT="$TRAVAIL"
  cat > "$TRAVAIL/serveur.ext" <<FIN
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
subjectAltName = DNS:$NOM,IP:$ADRESSE
FIN
  ( umask 077; openssl_ou_echec "$(msg "Échec de la fabrication de la clé du serveur avec openssl." "openssl failed while making the server key.")" "$TRAVAIL/erreurs" \
    "$OPENSSL" genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -pkeyopt ec_param_enc:named_curve -out "$TRAVAIL/serveur.key" )
  openssl_ou_echec "$(msg "Échec de la demande de certificat du serveur avec openssl." "openssl failed while making the server certificate request.")" "$TRAVAIL/erreurs" \
    "$OPENSSL" req -new -key "$TRAVAIL/serveur.key" -subj "/CN=$NOM" -out "$TRAVAIL/serveur.csr"
  openssl_ou_echec "$(msg "Échec de la signature du certificat du serveur avec openssl." "openssl failed while signing the server certificate.")" "$TRAVAIL/erreurs" \
    "$OPENSSL" x509 -req -in "$TRAVAIL/serveur.csr" -CA "$DOSSIER/autorite.crt" -CAkey "$DOSSIER/autorite.key" \
    -set_serial "0x$("$OPENSSL" rand -hex 16)" -days "$DUREE_SERVEUR" -sha256 -extfile "$TRAVAIL/serveur.ext" -out "$TRAVAIL/serveur.crt"
  chmod 0640 "$TRAVAIL/serveur.key"
  chmod 0644 "$TRAVAIL/serveur.crt"
  proprietaire "root:$COMPTE" "$TRAVAIL/serveur.key"
  proprietaire root:root "$TRAVAIL/serveur.crt"
  printf '%s\n' "$ADRESSE" > "$TRAVAIL/adresse"
  chmod 0644 "$TRAVAIL/adresse"
  mv -f "$TRAVAIL/serveur.key" "$DOSSIER/serveur.key"
  mv -f "$TRAVAIL/serveur.crt" "$DOSSIER/serveur.crt"
  mv -f "$TRAVAIL/adresse" "$DOSSIER/adresse"
  rm -rf "$TRAVAIL"
}

# Vrai (0) si le certificat du serveur doit être refait : absent, refusé par l'autorité
# (expiré, pas encore valable, abîmé), clé absente ou d'une autre paire, ou à moins de SEUIL_JOURS de son échéance.
doit_renouveler() {
  local DOSSIER="$1"
  [ -f "$DOSSIER/serveur.crt" ] && [ -f "$DOSSIER/serveur.key" ] || return 0
  [ "$("$OPENSSL" pkey -in "$DOSSIER/serveur.key" -pubout 2>/dev/null)" = "$("$OPENSSL" x509 -in "$DOSSIER/serveur.crt" -noout -pubkey 2>/dev/null)" ] || return 0
  "$OPENSSL" verify -CAfile "$DOSSIER/autorite.crt" "$DOSSIER/serveur.crt" >/dev/null 2>&1 || return 0
  "$OPENSSL" x509 -in "$DOSSIER/serveur.crt" -noout -checkend $((SEUIL_JOURS * 86400)) >/dev/null 2>&1 && return 1
  return 0
}

# Empreinte SHA-256 de l'autorité, en paires hexadécimales séparées par deux-points.
empreinte() {
  "$OPENSSL" x509 -in "$1/autorite.crt" -noout -fingerprint -sha256 | cut -d= -f2
}

# Date d'échéance d'un certificat, telle qu'openssl l'écrit.
echeance() {
  "$OPENSSL" x509 -in "$1" -noout -enddate | cut -d= -f2
}

# Un seul lancement à la fois sur le dossier (tâche mensuelle et commande à la main) ;
# sans flock (essais sur macOS), pas de verrou.
verrouiller() {
  command -v flock >/dev/null 2>&1 || return 0
  exec 9>"$TLS/.verrou"
  flock 9
}

# Relance lama s'il tourne (try-restart ne démarre pas un service arrêté), après la création ou le
# remplacement de la paire du serveur : lama démarré sans certificat (HTTP seul) passe ainsi en HTTPS
# sans relance à la main. Le rechargement à chaud de lama couvre déjà le renouvellement, la relance
# ne fait que l'avancer. Sans systemd, sous un compte ordinaire, en essai ou avec LAMA_SANS_RELANCE=1
# (installation et mise à jour, qui redémarrent lama elles-mêmes juste après), rien.
relancer_lama() {
  [ "${LAMA_SANS_RELANCE:-0}" != "1" ] || return 0
  [ "$(id -u)" -eq 0 ] && [ "${LAMA_ESSAI_SANS_ROOT:-0}" != "1" ] || return 0
  command -v systemctl >/dev/null 2>&1 || return 0
  if systemctl try-restart lama.service >/dev/null 2>&1; then
    echo "$(msg "Service lama relancé avec le nouveau certificat." "lama service restarted with the new certificate.")"
  fi
  # La base de formation emploie le même certificat : relancée aussi si elle est en marche.
  systemctl try-restart lama-formation.service >/dev/null 2>&1 || true
}

# Chargé par « source » (essais), le script s'arrête ici.
[ "${BASH_SOURCE:-$0}" = "$0" ] || return 0

if [ "$(id -u)" -ne 0 ] && [ "${LAMA_ESSAI_SANS_ROOT:-0}" != "1" ]; then
  echec "$(msg "Lancez cette commande avec sudo." "Run this command with sudo.")"
fi
command -v "$OPENSSL" >/dev/null 2>&1 || echec "$(msg "La commande openssl est introuvable. Installez-la avec sudo apt-get install openssl." "The openssl command was not found. Install it with sudo apt-get install openssl.")"

trap nettoyer EXIT
ACTION=""
ADRESSE=""
FORCER=0
while [ $# -gt 0 ]; do
  case "$1" in
    --adresse) ACTION=adresse; ADRESSE="${2:-}"; shift 2 || shift ;;
    --renouveler) ACTION=renouveler; shift ;;
    --forcer) FORCER=1; shift ;;
    --etat) ACTION=etat; shift ;;
    *) echec "$(msg "Option inconnue $1. Options possibles, --adresse IP, --renouveler [--forcer], --etat." "Unknown option $1. Possible options, --adresse IP, --renouveler [--forcer], --etat.")" ;;
  esac
done
[ -n "$ACTION" ] || echec "$(msg "Indiquez --adresse IP, --renouveler ou --etat." "Give --adresse IP, --renouveler or --etat.")"

if [ "$ACTION" = "etat" ]; then
  [ -f "$TLS/autorite.crt" ] || echec "$(msg "Aucune autorité dans $TLS. Lancez sudo lama-certificat --adresse IP." "No authority in $TLS. Run sudo lama-certificat --adresse IP.")"
  echo "$(msg "Empreinte SHA-256 de l'autorité, à comparer sur chaque appareil" "SHA-256 fingerprint of the authority, to compare on each device")"
  echo "  $(empreinte "$TLS")"
  echo "$(msg "Autorité valable jusqu'au $(echeance "$TLS/autorite.crt")" "Authority valid until $(echeance "$TLS/autorite.crt")")"
  if [ -f "$TLS/serveur.crt" ]; then
    echo "$(msg "Certificat du serveur pour $NOM et $(cat "$TLS/adresse" 2>/dev/null || echo '?'), valable jusqu'au $(echeance "$TLS/serveur.crt")" "Server certificate for $NOM and $(cat "$TLS/adresse" 2>/dev/null || echo '?'), valid until $(echeance "$TLS/serveur.crt")")"
    if doit_renouveler "$TLS"; then
      echo "$(msg "À renouveler, lancez sudo lama-certificat --renouveler." "Due for renewal, run sudo lama-certificat --renouveler.")"
    fi
  else
    echo "$(msg "Aucun certificat du serveur." "No server certificate.")"
  fi
  exit 0
fi

heure_plausible || echec "$(msg "L'horloge du serveur indique $(date '+%d/%m/%Y %H:%M'), elle est fausse. Réglez-la (sudo timedatectl set-time 'AAAA-MM-JJ HH:MM:SS') puis relancez." "The server clock reads $(date '+%d/%m/%Y %H:%M'), which is wrong. Set it (sudo timedatectl set-time 'YYYY-MM-DD HH:MM:SS'), then run again.")"

if [ "$ACTION" = "adresse" ]; then
  adresse_valide "$ADRESSE" || echec "$(msg "Adresse refusée, $ADRESSE. Une adresse IPv4 du réseau local est attendue (10.x.x.x, 172.16.x.x à 172.31.x.x, 192.168.x.x)." "Address refused, $ADRESSE. An IPv4 address of the local network is expected (10.x.x.x, 172.16.x.x to 172.31.x.x, 192.168.x.x).")"
  install -d -m 0750 "$TLS"
  proprietaire "root:$COMPTE" "$TLS"
  verrouiller
  fabriquer_autorite "$TLS"
  fabriquer_serveur "$TLS" "$ADRESSE"
  echo "$(msg "Certificat du serveur fait pour $NOM et $ADRESSE, valable $DUREE_SERVEUR jours." "Server certificate made for $NOM and $ADRESSE, valid for $DUREE_SERVEUR days.")"
  relancer_lama
  echo "$(msg "Empreinte SHA-256 de l'autorité, à comparer sur chaque appareil" "SHA-256 fingerprint of the authority, to compare on each device")"
  echo "  $(empreinte "$TLS")"
  exit 0
fi

# --renouveler
controler_autorite "$TLS"
[ -f "$TLS/autorite.crt" ] && [ -f "$TLS/autorite.key" ] || echec "$(msg "Aucune autorité dans $TLS. Lancez sudo lama-certificat --adresse IP." "No authority in $TLS. Run sudo lama-certificat --adresse IP.")"
verrouiller
ADRESSE="$(cat "$TLS/adresse" 2>/dev/null || true)"
adresse_valide "$ADRESSE" || echec "$(msg "Adresse du serveur inconnue dans $TLS/adresse. Lancez sudo lama-certificat --adresse IP." "Server address unknown in $TLS/adresse. Run sudo lama-certificat --adresse IP.")"
if [ "$FORCER" = 1 ] || doit_renouveler "$TLS"; then
  fabriquer_serveur "$TLS" "$ADRESSE"
  echo "$(msg "Certificat du serveur renouvelé pour $NOM et $ADRESSE, valable $DUREE_SERVEUR jours." "Server certificate renewed for $NOM and $ADRESSE, valid for $DUREE_SERVEUR days.")"
  relancer_lama
else
  echo "$(msg "Certificat du serveur encore valable plus de $SEUIL_JOURS jours, rien à faire." "Server certificate still valid for more than $SEUIL_JOURS days, nothing to do.")"
fi
