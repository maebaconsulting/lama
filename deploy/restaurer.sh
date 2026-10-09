#!/usr/bin/env bash
# Restaure une sauvegarde quand l'application ne démarre plus. Sinon, passer par
# Réglages, Sauvegardes, dans l'application.
# Exemples, en root
#   sudo ./restaurer.sh /mnt/lama-sauvegarde/quotidiennes/lama-20260928-0200.db.gz.age
#   sudo ./restaurer.sh --drive lama-20260928-0200.db.gz.age
#   sudo ./restaurer.sh --lister
# La clé privée des sauvegardes est demandée au clavier. Elle ne passe que par la
# mémoire vive (/run) le temps de la restauration, puis elle est effacée.
set -euo pipefail

# Messages dans la langue de LANG ou de LAMA_LANGUE (msg "texte" "text").
source "$(dirname "${BASH_SOURCE[0]}")/langue.sh"
# Passerelle WhatsApp WAHA (inscrire_cle_waha).
source "$(dirname "${BASH_SOURCE[0]}")/waha.sh"
# Réponse de l'application (lama_repond).
source "$(dirname "${BASH_SOURCE[0]}")/https-heure.sh"

APP=/opt/lama
COMPTE=lama
DATA=/var/lib/lama
USB=/mnt/lama-sauvegarde
REMOTE="${LAMA_DRIVE:-gdrive:lama}"
NOM_VALIDE='^lama-[0-9]{8}-[0-9]{4}\.db\.gz\.age$'
ARRETE=0

etape() { printf '\n== %s\n' "$1"; }
echec() { printf '%s\n' "$1" >&2; exit 1; }
comme_service() { runuser -u "$COMPTE" -- env RCLONE_CONFIG="$DATA/rclone/rclone.conf" HOME="$DATA" "$@"; }
# Réponse de l'application, en https quand le certificat existe (lama_repond, https-heure.sh).
repond() { lama_repond /etc/lama; }

[ "$(id -u)" -eq 0 ] || echec "$(msg "Lancez ce script avec sudo." "Run this script with sudo.")"
# Même masque que le service (UMask=0077) : runuser garde celui de root, et la
# base préparée par le CLI serait sinon remise en service lisible par tous.
umask 077
# Un répertoire courant hors d'atteinte du compte de service (par exemple /root)
# ferait échouer runuser : on se place dans un dossier lisible par tous avant.
cd /

if [ "${1:-}" = "--lister" ]; then
  echo "$(msg "Disque USB" "USB drive")"
  ls -1 "$USB/quotidiennes" "$USB/mensuelles" 2>/dev/null || echo "  $(msg "disque absent" "drive missing")"
  echo "$(msg "Google Drive ($REMOTE)" "Google Drive ($REMOTE)")"
  comme_service rclone lsf -- "$REMOTE/quotidiennes" 2>/dev/null || echo "  $(msg "inaccessible" "unreachable")"
  comme_service rclone lsf -- "$REMOTE/mensuelles" 2>/dev/null || true
  exit 0
fi

TRAVAIL="$(mktemp -d /run/lama-restauration.XXXXXX)"
# Une restauration interrompue (Ctrl-C, coupure SSH) ou un démarrage en échec ne
# doivent jamais laisser le service arrêté : ce nettoyage le relance si le drapeau
# posé après l'arrêt est levé et que le service n'est pas actif.
nettoyage() {
  # Un second Ctrl-C pendant le nettoyage ne doit pas interrompre l'effacement
  # de la clé ni la relance du service.
  trap '' INT HUP TERM
  rm -rf "$TRAVAIL"
  if [ "$ARRETE" = "1" ] && ! systemctl is-active --quiet lama.service; then
    systemctl start lama.service || true
  fi
}
trap nettoyage EXIT
chown -h "$COMPTE:$COMPTE" "$TRAVAIL"
chmod 0700 "$TRAVAIL"

case "${1:-}" in
  --drive)
    NOM="${2:-}"
    [[ "$NOM" =~ $NOM_VALIDE ]] || echec "$(msg "Nom de sauvegarde invalide, forme attendue lama-AAAAMMJJ-HHMM.db.gz.age" "Invalid backup name, expected form lama-YYYYMMDD-HHMM.db.gz.age")"
    FICHIER="$TRAVAIL/$NOM"
    comme_service rclone copyto -- "$REMOTE/quotidiennes/$NOM" "$FICHIER" \
      || comme_service rclone copyto -- "$REMOTE/mensuelles/$NOM" "$FICHIER" \
      || echec "$(msg "Sauvegarde introuvable sur Google Drive." "Backup not found on Google Drive.")"
    ;;
  "")
    echec "$(msg "Indiquez le fichier de sauvegarde, ou --drive suivi de son nom, ou --lister." "Give the backup file, or --drive followed by its name, or --lister.")"
    ;;
  *)
    [ -f "$1" ] || echec "$(msg "Fichier introuvable." "File not found.")"
    NOM="$(basename -- "$1")"
    [[ "$NOM" =~ $NOM_VALIDE ]] || echec "$(msg "Nom de sauvegarde invalide, forme attendue lama-AAAAMMJJ-HHMM.db.gz.age" "Invalid backup name, expected form lama-YYYYMMDD-HHMM.db.gz.age")"
    FICHIER="$TRAVAIL/$NOM"
    # Lu par le compte du service, jamais par root : sur le disque de sauvegarde,
    # qui lui appartient, le fichier pourrait être un lien vers un fichier du
    # système (/etc/shadow par exemple) que root copierait sinon pour lui.
    runuser -u "$COMPTE" -- cp -- "$1" "$FICHIER" \
      || echec "$(msg "Le compte du service ne peut pas lire ce fichier. Copiez-le dans /tmp, rendez-le lisible avec chmod 0644, puis relancez." "The service account cannot read this file. Copy it to /tmp, make it readable with chmod 0644, then run again.")"
    ;;
esac

printf '%s' "$(msg "Collez la clé privée des sauvegardes (AGE-SECRET-KEY-1…) puis Entrée. " "Paste the backup private key (AGE-SECRET-KEY-1…) then Enter. ")"
read -rs CLE || echec "$(msg "Abandon, rien n'a été modifié." "Stopped, nothing was changed.")"
printf '\n'
case "$CLE" in
  AGE-SECRET-KEY-1*) ;;
  *) echec "$(msg "Ce n'est pas une clé privée de sauvegarde, rien n'a été modifié." "This is not a backup private key, nothing was changed.")" ;;
esac

etape "$(msg "Arrêt du service" "Stopping the service")"
systemctl stop lama.service
ARRETE=1
# La clé n'est écrite et donnée au compte du service qu'une fois le service
# arrêté : un processus compromis ne peut plus la lire dans /run.
( umask 077; printf '%s\n' "$CLE" > "$TRAVAIL/cle" )
unset CLE
chown -h "$COMPTE:$COMPTE" "$TRAVAIL/cle"

etape "$(msg "Préparation de la restauration" "Preparing the restore")"
if ! runuser -u "$COMPTE" -- /usr/bin/node "$APP/actuelle/dist-server/cli.mjs" restaurer "$FICHIER" "$TRAVAIL/cle"; then
  rm -f "$TRAVAIL/cle"
  systemctl start lama.service || echec "$(msg "Restauration impossible et l'application ne redémarre pas. Consultez journalctl -u lama -n 100" "Restore failed and the application does not restart. See journalctl -u lama -n 100")"
  ARRETE=0
  echec "$(msg "Restauration impossible. La base en service est intacte et l'application a redémarré." "Restore failed. The running database is intact and the application has restarted.")"
fi
rm -f "$TRAVAIL/cle"

etape "$(msg "Redémarrage" "Restart")"
systemctl start lama.service || echec "$(msg "L'application ne redémarre pas après la restauration. Consultez journalctl -u lama -n 100" "The application does not restart after the restore. See journalctl -u lama -n 100")"
ARRETE=0
repond || echec "$(msg "L'application ne répond pas après la restauration. Consultez journalctl -u lama -n 100" "The application does not respond after the restore. See journalctl -u lama -n 100")"
# La base restaurée peut venir d'une autre machine, avec une autre clé de
# WAHA : celle du conteneur de cette machine y est réinscrite.
if [ -f /etc/lama/waha.env ]; then
  inscrire_cle_waha /etc/lama/waha.env "$APP/actuelle" "$COMPTE" || echo "$(msg "La clé de WAHA n'a pas pu être réinscrite, relancez sudo ./deploy/installer.sh pour réparer WhatsApp." "The WAHA key could not be saved again, run sudo ./deploy/installer.sh to repair WhatsApp.")"
fi
echo "$(msg "Restauration terminée. L'ancienne base est gardée dans $DATA sous le nom avant-restauration-…" "Restore finished. The old database is kept in $DATA under the name avant-restauration-…")"
