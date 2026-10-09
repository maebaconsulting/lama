#!/usr/bin/env bash
# HTTPS et heure du serveur (distribution D-05 à D-07, D-10, D-12) : commande
# lama-certificat, certificat du serveur, synchronisation de l'heure et règle
# polkit qui laisse le compte lama régler l'horloge. Chargé par « source »
# depuis installer.sh et mettre-a-jour.sh ; adresse_actuelle est essayée seule
# avec une commande ip simulée (src/server/deploy-https.test.ts).
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/langue.sh"

# Adresse IPv4 par laquelle le serveur sort sur le réseau (route par défaut),
# sans rien envoyer : c'est l'adresse fixe à réserver dans la box. Vide si
# aucune route n'existe.
adresse_actuelle() {
  ip -4 route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }'
}

# Installe ce qui sert au HTTPS et à l'heure, depuis le dossier de la version
# DOSSIER, la configuration étant dans CONF (/etc/lama) :
#   lien /usr/local/sbin/lama-certificat vers le script de la version en service ;
#   règle polkit 50-lama-heure.rules ; synchronisation de l'heure (systemd-timesyncd) ;
#   certificat du serveur fait s'il manque (adresse LAMA_ADRESSE, sinon l'adresse
#   actuelle), sinon renouvelé au seuil de 90 jours.
# L'installation comme la mise à jour (re)démarrent lama juste après : lama-certificat
# est donc appelé sans relance (LAMA_SANS_RELANCE=1), pour ne pas relancer en pleine
# mise à jour l'ancienne version. Le dossier des règles polkit (LAMA_POLKIT_DIR, pour
# les essais) n'est créé que s'il manque : celui du paquet polkitd garde ses droits.
# Retour 1 si le certificat n'a pas pu être fait : lama démarre alors en http seul.
installer_https_heure() {
  local DOSSIER="$1" CONF_ARG="$2" ADRESSE REGLES="${LAMA_POLKIT_DIR:-/etc/polkit-1/rules.d}"
  ln -sfn /opt/lama/actuelle/deploy/lama-certificat.sh /usr/local/sbin/lama-certificat
  [ -d "$REGLES" ] || install -d -m 0755 "$REGLES"
  install -m 0644 "$DOSSIER/deploy/polkit/50-lama-heure.rules" "$REGLES/50-lama-heure.rules"
  timedatectl set-ntp true || echo "$(msg "La synchronisation de l'heure n'a pas pu être activée, l'heure se corrige dans Réglages, Heure." "Time synchronisation could not be turned on, the time can be corrected in Settings, Time.")"
  if [ -f "$CONF_ARG/tls/serveur.crt" ]; then
    LAMA_SANS_RELANCE=1 LAMA_TLS_DIR="$CONF_ARG/tls" "$DOSSIER/deploy/lama-certificat.sh" --renouveler || return 1
    return 0
  fi
  ADRESSE="${LAMA_ADRESSE:-$(adresse_actuelle)}"
  if [ -z "$ADRESSE" ]; then
    echo "$(msg "Aucune adresse IP trouvée pour le certificat. Relancez avec sudo LAMA_ADRESSE=192.168.1.50 suivi de la commande, avec l'adresse fixe du serveur." "No IP address found for the certificate. Run again with sudo LAMA_ADRESSE=192.168.1.50 followed by the command, with the server's fixed address.")" >&2
    return 1
  fi
  LAMA_SANS_RELANCE=1 LAMA_TLS_DIR="$CONF_ARG/tls" "$DOSSIER/deploy/lama-certificat.sh" --adresse "$ADRESSE" || return 1
  echo "$(msg "Réservez l'adresse $ADRESSE à ce serveur dans la box, elle figure dans le certificat. Si elle change, lancez sudo lama-certificat --adresse suivi de la nouvelle adresse." "Reserve the address $ADRESSE for this server in the router, it is written in the certificate. If it changes, run sudo lama-certificat --adresse followed by the new address.")"
}

# Vrai dès que lama répond sur la machine : en https (autorité de l'institut,
# nom lama.local) quand un certificat existe, sinon en http. Avec « ou-http »
# (retour à une version d'avant le HTTPS), une réponse en http suffit. En http, seule
# une réponse 200 compte : la redirection 301 du port 80 d'une version en https ne
# prouve pas que l'application répond.
lama_repond() {
  local CONF_ARG="$1" MODE="${2:-}" ESSAI
  for ESSAI in $(seq 1 30); do
    if [ -f "$CONF_ARG/tls/serveur.crt" ] && curl -fsS --max-time 5 --cacert "$CONF_ARG/tls/autorite.crt" --resolve lama.local:443:127.0.0.1 https://lama.local/api/auth/state >/dev/null 2>&1; then
      return 0
    fi
    if { [ ! -f "$CONF_ARG/tls/serveur.crt" ] || [ "$MODE" = "ou-http" ]; } && [ "$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1/api/auth/state 2>/dev/null)" = 200 ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Paquets dont dépendent le HTTPS (openssl), le réglage de l'heure par l'écran
# (polkitd) et la synchronisation de l'heure (systemd-timesyncd) ; affiche ceux qui
# manquent, séparés par des espaces (rien si tout est là).
paquets_manquants() {
  local PAQUET MANQUANTS=""
  for PAQUET in openssl polkitd systemd-timesyncd; do
    dpkg -s "$PAQUET" >/dev/null 2>&1 || MANQUANTS="$MANQUANTS $PAQUET"
  done
  echo "${MANQUANTS# }"
}

# Mise à jour : installe les paquets manquants (l'installateur le fait déjà), sans
# jamais arrêter la mise à jour : hors ligne, apt-get échoue, et le message dit ce
# qui manque encore et ce qui ne marchera pas sans.
assurer_paquets() {
  local MANQUANTS PAQUET
  MANQUANTS="$(paquets_manquants)"
  [ -n "$MANQUANTS" ] || return 0
  # shellcheck disable=SC2086 # un mot par paquet
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q $MANQUANTS || true
  MANQUANTS="$(paquets_manquants)"
  [ -n "$MANQUANTS" ] || return 0
  echo "$(msg "Paquets manquants, non installés (pas d'internet ?) : $MANQUANTS. La mise à jour continue." "Missing packages, not installed (no internet?): $MANQUANTS. The update goes on.")"
  for PAQUET in $MANQUANTS; do
    case "$PAQUET" in
      openssl) echo "  $(msg "Sans openssl, pas de certificat : lama reste en http." "Without openssl, no certificate: lama stays on http.")" ;;
      polkitd) echo "  $(msg "Sans polkitd, Réglages, Heure est refusé : l'heure ne se règle qu'avec sudo timedatectl set-time." "Without polkitd, Settings, Time is refused: the time can only be set with sudo timedatectl set-time.")" ;;
      systemd-timesyncd) echo "  $(msg "Sans systemd-timesyncd, l'heure ne se règle pas seule quand internet passe." "Without systemd-timesyncd, the time is not set automatically when internet is available.")" ;;
    esac
  done
  echo "$(msg "Une fois internet revenu : sudo apt-get update && sudo apt-get install $MANQUANTS, puis relancez la mise à jour." "Once internet is back: sudo apt-get update && sudo apt-get install $MANQUANTS, then run the update again.")"
}

# Première mise à jour en https (aucune paire avant, une paire après) : consigne pour
# chaque appareil, empreinte de l'autorité (lama-certificat --etat de la version DOSSIER)
# et rappel des 30 jours pendant lesquels sessions et déclarations des appareils sont
# reprises. Même consigne que l'installateur.
annoncer_https() {
  local DOSSIER="$1" CONF_ARG="$2" ADRESSE
  ADRESSE="$(cat "$CONF_ARG/tls/adresse" 2>/dev/null || echo '192.168.x.y')"
  echo
  echo "$(msg "lama passe en https. Sur chaque appareil du Wi-Fi de l'institut, ouvrez d'abord http://lama.local/certificat (ou http://$ADRESSE/certificat) et approuvez le certificat, puis ouvrez https://lama.local. Fermez et rouvrez les onglets de lama restés ouverts." "lama now uses https. On each device on the institute's Wi-Fi, first open http://lama.local/certificat (or http://$ADRESSE/certificat) and approve the certificate, then open https://lama.local. Close and reopen any lama tabs left open.")"
  LAMA_TLS_DIR="$CONF_ARG/tls" "$DOSSIER/deploy/lama-certificat.sh" --etat || true
  echo "$(msg "Faites-le dans les 30 jours : passé ce délai, chaque appareil devra se reconnecter et être déclaré de nouveau." "Do it within 30 days: after that, each device will have to sign in again and be declared again.")"
}
