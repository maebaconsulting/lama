#!/usr/bin/env bash
# Autorise lama à déposer ses sauvegardes dans Google Drive. À faire une seule fois.
# L'autorisation se limite aux fichiers créés par l'application (portée drive.file).
# rclone 1.60 (Ubuntu 24.04) ne pose aucune question à « config create » : le script
# affiche lui-même la commande d'autorisation, fait décoder par jeton-drive.mjs le bloc
# renvoyé par rclone authorize et écrit la configuration.
set -euo pipefail

# Messages dans la langue de LANG ou de LAMA_LANGUE (msg "texte" "text").
source "$(dirname "${BASH_SOURCE[0]}")/langue.sh"

COMPTE=lama
DATA=/var/lib/lama
REMOTE=gdrive
DOSSIER=lama

echec() { printf '%s\n' "$1" >&2; exit 1; }
comme_service() { runuser -u "$COMPTE" -- env RCLONE_CONFIG="$DATA/rclone/rclone.conf" HOME="$DATA" "$@"; }

[ "$(id -u)" -eq 0 ] || echec "$(msg "Lancez ce script avec sudo." "Run this script with sudo.")"
command -v rclone >/dev/null || echec "$(msg "rclone manque. Lancez d'abord deploy/installer.sh." "rclone is missing. Run deploy/installer.sh first.")"
[ -x /usr/bin/node ] || echec "$(msg "Node manque. Lancez d'abord deploy/installer.sh." "Node is missing. Run deploy/installer.sh first.")"
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd /

if [ "$LANGUE" = "en" ]; then
  cat <<'FIN'
This server has no browser. Here is how to authorise Google Drive.
  1. On a computer that has a browser and rclone, run exactly:
       rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"
  2. Sign in with the institute's Google account and accept.
  3. The computer shows a block of text between two lines of arrows.
     Copy the whole block, paste it here, then press Enter. It is not shown while you type.
FIN
else
  cat <<'FIN'
Ce serveur n'a pas de navigateur. Voici comment autoriser Google Drive.
  1. Sur un ordinateur qui a un navigateur et rclone, lancez exactement :
       rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"
  2. Connectez-vous avec le compte Google de l'institut et acceptez.
  3. L'ordinateur affiche un bloc de texte entre deux lignes de flèches.
     Copiez tout ce bloc, collez-le ici puis Entrée. Il ne s'affiche pas pendant la saisie.
FIN
fi

printf '%s' "$(msg "Bloc : " "Block: ")"
read -rs JETON || echec "$(msg "Aucun bloc reçu. Relancez le script." "No block received. Run the script again.")"
echo
# Le texte collé passe par l'entrée standard, jamais en argument (visible dans ps).
CONFIG="$(printf '%s' "$JETON" | /usr/bin/node "$ICI/jeton-drive.mjs")" || echec "$(msg "Relancez le script et collez tout le bloc." "Run the script again and paste the whole block.")"
unset JETON

# Remplace toute configuration rclone du service (un seul remote, celui-ci) : écrite
# à côté puis renommée, elle appartient toujours au service, en 0600.
printf '%s\n' "$CONFIG" \
  | comme_service sh -c 'umask 077 && rm -f "$RCLONE_CONFIG.nouveau" && cat > "$RCLONE_CONFIG.nouveau" && mv -f "$RCLONE_CONFIG.nouveau" "$RCLONE_CONFIG"' \
  || echec "$(msg "La configuration de rclone n'a pas pu être écrite dans $DATA/rclone." "The rclone configuration could not be written to $DATA/rclone.")"
unset CONFIG

comme_service rclone mkdir -- "$REMOTE:$DOSSIER" || echec "$(msg "Google Drive refuse cette autorisation ou ne répond pas. Vérifiez internet, puis relancez le script." "Google Drive refuses this authorisation or does not respond. Check the internet connection, then run the script again.")"
comme_service rclone lsd -- "$REMOTE:" >/dev/null || echec "$(msg "Google Drive ne répond pas avec cette autorisation. Relancez le script." "Google Drive does not respond with this authorisation. Run the script again.")"
echo "$(msg "Google Drive est autorisé." "Google Drive is authorised.")"
echo "$(msg "Dans l'application, Réglages puis Connexions, enregistrez la destination $REMOTE:$DOSSIER" "In the application, Settings then Connections, save the destination $REMOTE:$DOSSIER")"
