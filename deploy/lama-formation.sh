#!/usr/bin/env bash
# Base de formation de lama (distribution D-14, D-16, D-19) : une base d'entraînement sur le même
# mini-PC, port 8443, même certificat, jamais la vraie base. Installé en lien sous
# /usr/local/sbin/lama-formation, à lancer avec sudo :
#   sudo lama-formation --installer         compte et dossiers, service lama-formation, puis les quatre comptes
#   sudo lama-formation --comptes           mots de passe des quatre comptes de formation (créés s'ils manquent)
#   sudo lama-formation --remettre-a-zero   démonstration recréée à neuf, comptes de formation gardés
#   sudo lama-formation --etat              service, adresse et comptes
# La première fois, avant que le lien existe : sudo /opt/lama/actuelle/deploy/lama-formation.sh --installer
set -euo pipefail

ICI="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
# Messages (msg) et création du compte de service à numéro fixe (creer_compte_service) ;
# installer.sh, chargé par « source », s'arrête avant toute action.
source "$ICI/installer.sh"

APP=/opt/lama
COMPTE_FORMATION=lama-formation
# Numéro fixe, voisin de celui du compte lama (871), pour les mêmes raisons (installer.sh).
UID_FORMATION=872
DATA_FORMATION=/var/lib/lama-formation
CONF_FORMATION=/etc/lama-formation
SERVICE_FORMATION=lama-formation.service
# Même nom que DEMANDE_REMISE_A_ZERO (src/server/formation/remise-a-zero.ts).
DEMANDE=remise-a-zero.demandee
LOGINS="formation.admin, formation.gerante, formation.reception, formation.praticienne"

# Lance une commande sous le compte de la formation, en mode formation, sur ses dossiers (jamais
# ceux de l'environnement de l'appelant), depuis un dossier qu'il peut lire. umask 077 : runuser
# garde le masque de root (0022), la base et le fichier de demande seraient lisibles de tous.
comme_formation() { ( umask 077; cd / && runuser -u "$COMPTE_FORMATION" -- env LAMA_FORMATION=1 LAMA_DATA_DIR="$DATA_FORMATION" LAMA_CONFIG_DIR="$CONF_FORMATION" HOME="$DATA_FORMATION" "$@" ); }

# Demande un mot de passe sans écho, deux fois, 10 caractères au moins (comptés en caractères,
# non en octets), et l'écrit sur la sortie standard (lue par l'appelant) ; questions et refus
# vont sur la sortie d'erreur.
demander_mot_de_passe() {
  local ROLE="$1" PREMIER SECOND LONGUEUR
  while true; do
    printf '%s' "$(msg "Mot de passe du compte $ROLE (10 caractères au moins), " "Password of the $ROLE account (at least 10 characters), ")" >&2
    IFS= read -rs PREMIER || return 1
    printf '\n' >&2
    LONGUEUR="$(LC_ALL=C.UTF-8; printf '%s' "${#PREMIER}")"
    if [ "$LONGUEUR" -lt 10 ]; then
      printf '%s\n' "$(msg "Trop court, recommencez." "Too short, try again.")" >&2
      continue
    fi
    printf '%s' "$(msg "Le même, une seconde fois, " "The same one, a second time, ")" >&2
    IFS= read -rs SECOND || return 1
    printf '\n' >&2
    if [ "$PREMIER" != "$SECOND" ]; then
      printf '%s\n' "$(msg "Les deux saisies diffèrent, recommencez." "The two entries differ, try again.")" >&2
      continue
    fi
    printf '%s\n' "$PREMIER"
    return 0
  done
}

# Demande les quatre mots de passe (administration, gérante, réception, praticienne) et les
# passe à « cli formation-comptes » par l'entrée standard, jamais en argument : ils ne
# figurent ni dans la liste des processus ni dans aucun journal. Crée les comptes, ou change
# leurs mots de passe et les débloque ; la première fois, la base et sa démonstration avec.
ecrire_comptes() {
  local P1 P2 P3 P4
  P1="$(demander_mot_de_passe "$(msg "administration" "administration")")" || return 1
  P2="$(demander_mot_de_passe "$(msg "gérante" "manager")")" || return 1
  P3="$(demander_mot_de_passe "$(msg "réception" "reception")")" || return 1
  P4="$(demander_mot_de_passe "$(msg "praticienne" "practitioner")")" || return 1
  printf '%s\n%s\n%s\n%s\n' "$P1" "$P2" "$P3" "$P4" | comme_formation /usr/bin/node "$APP/actuelle/dist-server/cli.mjs" formation-comptes
}

# Vrai dès que la base de formation répond en https sur le port 8443, avec l'autorité de l'institut.
formation_repond() {
  local ESSAI
  for ESSAI in $(seq 1 30); do
    if curl -fsS --max-time 5 --cacert /etc/lama/tls/autorite.crt --resolve lama.local:8443:127.0.0.1 https://lama.local:8443/api/auth/state >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Vrai si le serveur a annoncé, depuis l'heure donnée, qu'il n'a gardé aucun compte à la remise
# à zéro (les deux annonces invitent à lancer « sudo lama-formation --comptes »).
remise_sans_compte() {
  journal_formation "$1" | grep -q 'lama-formation --comptes'
}

# Journal du service de la formation depuis l'heure donnée (remplacé dans les essais).
journal_formation() {
  journalctl -u lama-formation --since "$1" --no-pager 2>/dev/null || true
}

# Remise à zéro (D-19) : service arrêté, demande déposée par le compte de la formation, service relancé,
# qui refait la base avant de l'ouvrir ; même geste que Réglages, Formation dans l'écran.
remettre_a_zero() {
  local DEBUT
  [ -d "$DATA_FORMATION" ] || echec "$(msg "La base de formation n'est pas installée. Lancez sudo lama-formation --installer." "The training database is not installed. Run sudo lama-formation --installer.")"
  DEBUT="$(date '+%Y-%m-%d %H:%M:%S')"
  systemctl stop "$SERVICE_FORMATION"
  comme_formation touch "$DATA_FORMATION/$DEMANDE"
  systemctl start "$SERVICE_FORMATION"
  formation_repond || echec "$(msg "La base de formation ne répond pas. Consultez journalctl -u lama-formation -n 50" "The training database does not respond. See journalctl -u lama-formation -n 50")"
  if remise_sans_compte "$DEBUT"; then
    echo "$(msg "Base de formation remise à zéro, démonstration recréée, aucun compte gardé, lancez sudo lama-formation --comptes." "Training database reset, demonstration recreated, no account kept, run sudo lama-formation --comptes.")"
  else
    echo "$(msg "Base de formation remise à zéro, démonstration recréée, comptes gardés." "Training database reset, demonstration recreated, accounts kept.")"
  fi
}

# Installation (D-14) : compte et dossiers propres, clé maîtresse propre (jamais celle de la vraie
# base), service, lien de la commande, puis les quatre comptes, avant le premier démarrage.
installer_formation() {
  [ -L "$APP/actuelle" ] || echec "$(msg "lama n'est pas installé ici. Lancez d'abord sudo ./deploy/installer.sh." "lama is not installed here. Run sudo ./deploy/installer.sh first.")"
  [ -f /etc/lama/tls/serveur.crt ] || echec "$(msg "Le certificat de lama manque, la formation l'emploie aussi. Lancez d'abord sudo lama-certificat --adresse suivi de l'adresse fixe." "The lama certificate is missing, the training database uses it too. First run sudo lama-certificat --adresse followed by the fixed address.")"
  creer_compte_service "$COMPTE_FORMATION" "$UID_FORMATION" "$DATA_FORMATION" || echec "$(msg "Le compte de la formation n'a pas pu être créé." "The training account could not be created.")"
  install -d -m 0700 -o "$COMPTE_FORMATION" -g "$COMPTE_FORMATION" "$DATA_FORMATION"
  install -d -m 0750 -o root -g "$COMPTE_FORMATION" "$CONF_FORMATION"
  if [ ! -f "$CONF_FORMATION/master.key" ]; then
    ( umask 077; head -c 32 /dev/urandom | base64 > "$CONF_FORMATION/master.key" )
  fi
  chown "$COMPTE_FORMATION:$COMPTE_FORMATION" "$CONF_FORMATION/master.key"
  chmod 0600 "$CONF_FORMATION/master.key"
  install -m 0644 "$APP/actuelle/deploy/systemd/$SERVICE_FORMATION" /etc/systemd/system/
  ln -sfn "$APP/actuelle/deploy/lama-formation.sh" /usr/local/sbin/lama-formation
  systemctl daemon-reload
  echo "$(msg "Quatre comptes de formation, $LOGINS. Choisissez leurs mots de passe, différents de ceux de la vraie base." "Four training accounts, $LOGINS. Choose their passwords, different from those of the real database.")"
  ecrire_comptes || echec "$(msg "Les comptes de formation n'ont pas été créés. Relancez sudo lama-formation --installer." "The training accounts were not created. Run sudo lama-formation --installer again.")"
  systemctl enable "$SERVICE_FORMATION"
  systemctl restart "$SERVICE_FORMATION"
  formation_repond || echec "$(msg "La base de formation ne répond pas. Consultez journalctl -u lama-formation -n 50" "The training database does not respond. See journalctl -u lama-formation -n 50")"
  afficher_etat
}

# Service, adresse et comptes de la formation.
afficher_etat() {
  local ADRESSE
  ADRESSE="$(cat /etc/lama/tls/adresse 2>/dev/null || echo '192.168.x.y')"
  if systemctl is-active --quiet "$SERVICE_FORMATION"; then
    echo "$(msg "Base de formation en marche, https://lama.local:8443 (ou https://$ADRESSE:8443)." "Training database running, https://lama.local:8443 (or https://$ADRESSE:8443).")"
  else
    echo "$(msg "Base de formation arrêtée ou absente. Installation, sudo lama-formation --installer." "Training database stopped or missing. Installation, sudo lama-formation --installer.")"
  fi
  echo "$(msg "Comptes, $LOGINS." "Accounts, $LOGINS.")"
}

# Chargé par « source » (essais), le script s'arrête ici.
[ "${BASH_SOURCE:-$0}" = "$0" ] || return 0

[ "$(id -u)" -eq 0 ] || echec "$(msg "Lancez cette commande avec sudo." "Run this command with sudo.")"
case "${1:-}" in
  --installer) installer_formation ;;
  --comptes)
    [ -d "$DATA_FORMATION" ] || echec "$(msg "La base de formation n'est pas installée. Lancez sudo lama-formation --installer." "The training database is not installed. Run sudo lama-formation --installer.")"
    ecrire_comptes || echec "$(msg "Mots de passe inchangés." "Passwords unchanged.")"
    ;;
  --remettre-a-zero) remettre_a_zero ;;
  --etat) afficher_etat ;;
  *) echec "$(msg "Indiquez --installer, --comptes, --remettre-a-zero ou --etat." "Give --installer, --comptes, --remettre-a-zero or --etat.")" ;;
esac
