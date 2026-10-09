#!/usr/bin/env bash
# Passerelle WhatsApp WAHA (sous-projet 7, vague 2) : conteneur Docker sur le
# serveur de l'institut, moteur GOWS, joignable seulement depuis la machine.
# Chargé par « source » depuis installer.sh, mettre-a-jour.sh et restaurer.sh ;
# chaque fonction est essayée seule avec une commande docker simulée
# (src/server/deploy.test.ts).
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/langue.sh"

WAHA_CONTENEUR=lama-waha
WAHA_VOLUME=lama-waha-sessions
WAHA_ADRESSE=http://127.0.0.1:3000

# Image GOWS de la version donnée pour l'architecture dpkg donnée (amd64 ou
# arm64) ; retour 1 pour un autre processeur, que WAHA ne publie pas.
image_waha() {
  case "$1" in
    amd64) printf 'devlikeapro/waha:gows-%s' "$2" ;;
    arm64) printf 'devlikeapro/waha:gows-arm-%s' "$2" ;;
    *) return 1 ;;
  esac
}

# Crée la clé de WAHA (64 caractères hexadécimaux) dans le fichier
# d'environnement donné, lisible par root seul, ou garde celle qui s'y trouve :
# une réinstallation ou une mise à jour ne casse pas la liaison avec lama.
# Retour 1 si le fichier ne contient pas une clé valide.
preparer_cle_waha() {
  local FICHIER="$1"
  if [ ! -f "$FICHIER" ]; then
    ( umask 077; printf 'WAHA_API_KEY=%s\n' "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$FICHIER" )
  fi
  chmod 0600 "$FICHIER"
  grep -qx 'WAHA_API_KEY=[0-9a-f]\{64\}' "$FICHIER"
}

# Met le conteneur sur l'image donnée. Déjà en service sur cette image avec
# cette clé : rien n'est touché (la session WhatsApp n'est pas coupée à chaque
# mise à jour de lama). Sinon l'image est tirée d'abord : sans réseau, l'ancien
# conteneur reste en service (retour 1) ; puis l'ancien est mis de côté, et
# remis en service si le neuf ne démarre pas (port pris, par exemple). La clé
# passe par --env-file, jamais par la ligne de commande ; la session WhatsApp
# vit dans un volume et survit au remplacement.
lancer_waha() {
  local IMAGE="$1" FICHIER_CLE="$2" ANCIEN="$WAHA_CONTENEUR-ancien"
  if [ "$(docker inspect -f '{{.Config.Image}} {{.State.Running}}' "$WAHA_CONTENEUR" 2>/dev/null)" = "$IMAGE true" ] \
    && docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$WAHA_CONTENEUR" 2>/dev/null | grep -qxF -f "$FICHIER_CLE"; then
    return 0
  fi
  docker pull -q "$IMAGE" >/dev/null || return 1
  docker rm -f "$ANCIEN" >/dev/null 2>&1 || true
  if docker inspect "$WAHA_CONTENEUR" >/dev/null 2>&1; then
    docker stop "$WAHA_CONTENEUR" >/dev/null 2>&1 || true
    docker rename "$WAHA_CONTENEUR" "$ANCIEN"
  fi
  if docker run -d --name "$WAHA_CONTENEUR" --restart unless-stopped -p 127.0.0.1:3000:3000 -v "$WAHA_VOLUME":/app/.sessions --env-file "$FICHIER_CLE" -e WHATSAPP_DEFAULT_ENGINE=GOWS -e WAHA_DASHBOARD_ENABLED=False -e WHATSAPP_SWAGGER_ENABLED=False "$IMAGE" >/dev/null; then
    docker rm -f "$ANCIEN" >/dev/null 2>&1 || true
    return 0
  fi
  docker rm -f "$WAHA_CONTENEUR" >/dev/null 2>&1 || true
  if docker inspect "$ANCIEN" >/dev/null 2>&1; then
    docker rename "$ANCIEN" "$WAHA_CONTENEUR"
    docker start "$WAHA_CONTENEUR" >/dev/null 2>&1 || true
  fi
  return 1
}

# Attend que WAHA réponde avec sa clé (60 s au plus). La clé passe à curl par
# l'entrée standard (-H @-), jamais par la ligne de commande.
attendre_waha() {
  local FICHIER_CLE="$1" CLE_WAHA
  CLE_WAHA="$(sed -n 's/^WAHA_API_KEY=//p' "$FICHIER_CLE")"
  for _ in $(seq 1 60); do
    printf 'X-Api-Key: %s\n' "$CLE_WAHA" | curl -fsS --max-time 5 -H @- "$WAHA_ADRESSE/api/version" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

# Inscrit la clé et l'adresse de WAHA dans les réglages de lama, par le compte
# du service (qui seul lit la clé maîtresse) ; la clé passe par l'entrée
# standard. Le fournisseur n'est pas choisi : l'administrateur l'active dans
# les Réglages.
inscrire_cle_waha() {
  local FICHIER_CLE="$1" APP_DIR="$2" COMPTE_SERVICE="$3"
  sed -n 's/^WAHA_API_KEY=//p' "$FICHIER_CLE" | ( cd / && runuser -u "$COMPTE_SERVICE" -- /usr/bin/node "$APP_DIR/dist-server/cli.mjs" waha-cle )
}

# Installe Docker d'Ubuntu s'il manque, puis WAHA à la version écrite dans
# deploy/waha.version, et inscrit sa clé. Retour 1 au premier échec, avec le
# motif sur la sortie d'erreur : lama reste en service sans WhatsApp.
installer_waha() {
  local APP_DIR="$1" CONF_DIR="$2" COMPTE_SERVICE="$3" VERSION_WAHA IMAGE
  if ! command -v docker >/dev/null 2>&1; then
    apt-get install -y -q docker.io || { printf '%s\n' "$(msg "Docker n'a pas pu être installé." "Docker could not be installed.")" >&2; return 1; }
  fi
  systemctl enable --now docker >/dev/null 2>&1 || { printf '%s\n' "$(msg "Docker ne démarre pas." "Docker does not start.")" >&2; return 1; }
  VERSION_WAHA="$(cat "$APP_DIR/deploy/waha.version")"
  IMAGE="$(image_waha "$(dpkg --print-architecture)" "$VERSION_WAHA")" || { printf '%s\n' "$(msg "Processeur non pris en charge par WAHA." "Processor not supported by WAHA.")" >&2; return 1; }
  preparer_cle_waha "$CONF_DIR/waha.env" || { printf '%s\n' "$(msg "Clé de WAHA illisible dans $CONF_DIR/waha.env, supprimez ce fichier puis relancez." "Unreadable WAHA key in $CONF_DIR/waha.env, delete this file, then run again.")" >&2; return 1; }
  lancer_waha "$IMAGE" "$CONF_DIR/waha.env" || { printf '%s\n' "$(msg "L'image $IMAGE n'a pas pu être téléchargée ou lancée (connexion à internet ?)." "The image $IMAGE could not be downloaded or started (internet connection?).")" >&2; return 1; }
  attendre_waha "$CONF_DIR/waha.env" || { printf '%s\n' "$(msg "WAHA ne répond pas. Consultez docker logs $WAHA_CONTENEUR" "WAHA does not respond. See docker logs $WAHA_CONTENEUR")" >&2; return 1; }
  inscrire_cle_waha "$CONF_DIR/waha.env" "$APP_DIR" "$COMPTE_SERVICE" || { printf '%s\n' "$(msg "La clé de WAHA n'a pas pu être inscrite dans les réglages." "The WAHA key could not be saved in the settings.")" >&2; return 1; }
  echo "$(msg "WAHA $VERSION_WAHA est en service. Pour relier le téléphone de l'institut, choisissez WAHA dans Réglages, WhatsApp, puis scannez le QR code." "WAHA $VERSION_WAHA is running. To link the institute's phone, choose WAHA in Settings, WhatsApp, then scan the QR code.")"
}
