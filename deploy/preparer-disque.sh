#!/usr/bin/env bash
# Prépare un disque USB pour les sauvegardes. Efface le disque, le formate en ext4
# avec l'étiquette LAMA-SAUVEGARDE, puis y pose le témoin .lama-sauvegarde.
# À lancer en root avec le disque entier en argument, par exemple sudo ./preparer-disque.sh /dev/sdb
set -euo pipefail

# Messages dans la langue de LANG ou de LAMA_LANGUE (msg "texte" "text").
source "$(dirname "${BASH_SOURCE[0]}")/langue.sh"

USB=/mnt/lama-sauvegarde
COMPTE=lama

echec() { printf '%s\n' "$1" >&2; exit 1; }

# Dit si le disque passé en argument ne doit pas être effacé : il porte le
# système (racine, /boot, /boot/efi, mémoire d'échange, composant LVM/LUKS
# sous-jacent) ou l'une de ses partitions est montée ailleurs que sur le disque
# de sauvegarde (données de l'application, /srv…), que ce soit le disque
# lui-même ou l'un de ses descendants (partition, volume LVM, périphérique
# déchiffré). Tous les points de montage sont lus (colonne MOUNTPOINTS, un
# périphérique peut être monté à plusieurs endroits, séparés par \x0a). Seul
# $USB est toléré : il est démonté juste avant l'effacement. Affiche le motif
# sur la sortie standard et retourne 0 (vrai) s'il faut refuser ce disque, 1
# sinon. Échoue fermé : si lsblk échoue (par exemple une version trop
# ancienne qui ne connaît pas MOUNTPOINTS) ou ne décrit rien, le disque est
# refusé. Fonction isolée pour être testée seule, avec une commande lsblk
# simulée (src/server/deploy.test.ts).
disque_refuse() {
  local DISQUE="$1" SORTIE LIGNE NAME MOUNTPOINTS FSTYPE POINT
  if [ "$(lsblk -dno TYPE "$DISQUE" 2>/dev/null || true)" != "disk" ]; then
    printf '%s\n' "$(msg "n'est pas un disque entier (une partition a peut-être été indiquée à sa place)" "is not a whole disk (a partition may have been given instead)")"
    return 0
  fi
  if ! SORTIE="$(lsblk -Pno NAME,MOUNTPOINTS,FSTYPE "$DISQUE" 2>/dev/null)" || [ -z "$SORTIE" ]; then
    printf '%s\n' "$(msg "n'a pas pu être examiné (lsblk en échec ou trop ancien), abandon par précaution" "could not be examined (lsblk failed or is too old), stopping as a precaution")"
    return 0
  fi
  while IFS= read -r LIGNE; do
    NAME=""; MOUNTPOINTS=""; FSTYPE=""
    eval "$LIGNE"
    case "$FSTYPE" in
      LVM2_member|crypto_LUKS)
        printf '%s\n' "$(msg "porte un volume système géré par LVM ou chiffré ($NAME)" "holds a system volume managed by LVM or encrypted ($NAME)")"
        return 0
        ;;
    esac
    while IFS= read -r POINT; do
      case "$POINT" in
        "") ;;
        /|/boot|/boot/efi|'[SWAP]')
          printf '%s\n' "$(msg "porte le système ($NAME monté sur $POINT)" "holds the system ($NAME mounted on $POINT)")"
          return 0
          ;;
        "$USB") ;;
        *)
          printf '%s\n' "$(msg "est en service ($NAME monté sur $POINT)" "is in use ($NAME mounted on $POINT)")"
          return 0
          ;;
      esac
    done <<< "${MOUNTPOINTS//\\x0a/$'\n'}"
  done <<< "$SORTIE"
  return 1
}

# Dit si le disque système n'a pas pu être identifié : vrai (0) si aucun
# périphérique, sur l'ensemble des disques connus de lsblk, ne porte la
# racine "/" (par exemple une racine sur un système de fichiers que lsblk ne
# rattache à aucun point de montage visible). Dans ce cas, preparer-disque.sh
# doit abandonner par précaution plutôt que de risquer d'effacer le mauvais
# disque. Fonction isolée pour être testée seule, comme disque_refuse.
systeme_non_identifie() {
  lsblk -rno MOUNTPOINT 2>/dev/null | grep -qx '/' && return 1
  return 0
}

# Donne le disque de sauvegarde monté au compte du service, avec toute son
# arborescence (après une reprise sur une autre machine, les sauvegardes
# peuvent appartenir à un ancien numéro de compte), et y pose le témoin
# .lama-sauvegarde, sans que root suive jamais un lien symbolique : le dossier
# est modifiable par le service, qui aurait pu y remplacer le témoin ou un
# fichier par un lien vers un fichier du système (/etc/shadow par exemple).
# chown -h -R -P parcourt sans entrer dans les liens et ne change que le lien,
# jamais sa cible ; un témoin qui est un lien est refusé ; le témoin absent
# est créé par le compte du service lui-même, qui ne peut alors atteindre que
# ce qu'il atteint déjà. Retourne 1 si le témoin n'est pas un fichier
# ordinaire à la fin. Fonction isolée pour être testée seule
# (src/server/deploy.test.ts), recopiée à l'identique dans installer.sh et
# preparer-disque.sh.
poser_temoin() {
  local DOSSIER="$1" COMPTE_SERVICE="$2"
  local TEMOIN_DISQUE="$DOSSIER/.lama-sauvegarde"
  if [ -L "$DOSSIER" ] || [ -L "$TEMOIN_DISQUE" ]; then
    printf '%s\n' "$(msg "$TEMOIN_DISQUE est un lien symbolique, supprimez-le puis relancez." "$TEMOIN_DISQUE is a symbolic link, delete it, then run again.")" >&2
    return 1
  fi
  chown -h -R -P "$COMPTE_SERVICE:$COMPTE_SERVICE" "$DOSSIER"
  if [ ! -e "$TEMOIN_DISQUE" ]; then
    ( cd / && runuser -u "$COMPTE_SERVICE" -- touch -- "$TEMOIN_DISQUE" )
  fi
  if [ -L "$TEMOIN_DISQUE" ] || [ ! -f "$TEMOIN_DISQUE" ]; then
    printf '%s\n' "$(msg "$TEMOIN_DISQUE n'est pas un fichier ordinaire." "$TEMOIN_DISQUE is not a regular file.")" >&2
    return 1
  fi
}

# La suite ne s'exécute que si le script est lancé directement (jamais quand
# il est chargé par « source », utilisé par les tests pour isoler disque_refuse,
# systeme_non_identifie et poser_temoin).
if [ "${BASH_SOURCE:-$0}" = "$0" ]; then

  [ "$(id -u)" -eq 0 ] || echec "$(msg "Lancez ce script avec sudo." "Run this script with sudo.")"
  DISQUE="${1:-}"
  if [ -z "$DISQUE" ]; then
    lsblk -o NAME,SIZE,MODEL,TRAN,LABEL
    echec "$(msg "Indiquez le disque à préparer, par exemple sudo ./preparer-disque.sh /dev/sdb" "Give the disk to prepare, for example sudo ./preparer-disque.sh /dev/sdb")"
  fi
  DISQUE="$(readlink -f "$DISQUE")"
  [ -b "$DISQUE" ] || echec "$(msg "$DISQUE n'est pas un disque." "$DISQUE is not a disk.")"

  systeme_non_identifie && echec "$(msg "Le disque système n'a pas pu être identifié, abandon par précaution." "The system disk could not be identified, stopping as a precaution.")"
  MOTIF="$(disque_refuse "$DISQUE")" && echec "$DISQUE $MOTIF. $(msg "Choisissez le disque USB." "Choose the USB drive.")"

  lsblk "$DISQUE"
  printf "$(msg "Tout le contenu de %s sera effacé. Tapez EFFACER puis Entrée pour continuer. " "Everything on %s will be erased. Type ERASE then Enter to continue. ")" "$DISQUE"
  read -r REPONSE || echec "$(msg "Abandon, rien n'a été effacé." "Stopped, nothing was erased.")"
  [ "$REPONSE" = "$MOT_EFFACER" ] || echec "$(msg "Abandon, rien n'a été effacé." "Stopped, nothing was erased.")"

  umount "$USB" 2>/dev/null || true
  for PARTIE in $(lsblk -lnpo NAME "$DISQUE" | tail -n +2); do umount "$PARTIE" 2>/dev/null || true; done
  wipefs -a "$DISQUE"
  parted -s "$DISQUE" mklabel gpt mkpart sauvegarde ext4 1MiB 100%
  partprobe "$DISQUE" 2>/dev/null || true
  udevadm settle
  PARTITION="$(lsblk -lnpo NAME "$DISQUE" | sed -n 2p)"
  [ -n "$PARTITION" ] || echec "$(msg "La partition n'apparaît pas. Débranchez puis rebranchez le disque, et relancez." "The partition does not show up. Unplug the disk and plug it back in, then run again.")"
  mkfs.ext4 -F -L LAMA-SAUVEGARDE "$PARTITION"
  udevadm settle

  systemctl daemon-reload
  systemctl restart "$(systemd-escape --path --suffix=automount "$USB")" || true
  ls "$USB" >/dev/null 2>&1 || true
  findmnt -n -t ext4 "$USB" >/dev/null || echec "$(msg "Le disque est formaté mais ne se monte pas. Vérifiez la ligne LAMA-SAUVEGARDE de /etc/fstab." "The disk is formatted but does not mount. Check the LAMA-SAUVEGARDE line in /etc/fstab.")"
  poser_temoin "$USB" "$COMPTE" || echec "$(msg "Le témoin du disque n'a pas pu être posé, aucune sauvegarde n'y sera écrite." "The disk marker could not be written, no backup will be written to it.")"
  echo "$(msg "Disque LAMA-SAUVEGARDE prêt. La prochaine sauvegarde y sera écrite." "LAMA-SAUVEGARDE drive ready. The next backup will be written to it.")"

fi
