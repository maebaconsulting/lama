#!/usr/bin/env bash
# Installe une nouvelle version de lama et redémarre le service, avec retour
# automatique à la version précédente si la nouvelle ne répond pas.
# À lancer en root depuis le dossier extrait de la nouvelle archive, avec sudo ./deploy/mettre-a-jour.sh
set -euo pipefail

# Messages dans la langue de LANG ou de LAMA_LANGUE (msg "texte" "text").
source "$(dirname "${BASH_SOURCE[0]}")/langue.sh"
# Passerelle WhatsApp WAHA (installer_waha).
source "$(dirname "${BASH_SOURCE[0]}")/waha.sh"
# HTTPS et heure du serveur (assurer_paquets, installer_https_heure, lama_repond, annoncer_https).
source "$(dirname "${BASH_SOURCE[0]}")/https-heure.sh"

APP=/opt/lama
DATA=/var/lib/lama
CONF=/etc/lama
COMPTE=lama
GARDER=3
TEMOIN=/run/lama-mise-a-jour.temoin

etape() { printf '\n== %s\n' "$1"; }
echec() { printf '%s\n' "$1" >&2; exit 1; }
# Réponse de lama : https quand le certificat existe (lama_repond, https-heure.sh), sinon
# http ; « ou-http » pour la version précédente, qui peut être d'avant le HTTPS. Chaque
# essai garde curl -fsS --max-time 5, pour ne jamais rester bloqué.
repond() { lama_repond "$CONF" "${1:-}"; }

# Choisit, parmi les copies avant-migration-*.db du dossier donné, la plus
# ANCIENNE postérieure au témoin (pas la plus récente) : avec Restart=always,
# une nouvelle version qui replante après avoir validé une partie de ses
# migrations en repose une copie à chaque relance ; prendre la plus récente
# restaurerait une base déjà à moitié migrée. Les noms sont un epoch en
# millisecondes à 13 chiffres (voir avant-migration dans src/server/boot.ts),
# donc le tri lexical suffit. Seuls les fichiers ordinaires comptent (-type f) :
# le dossier appartient au service, qui aurait pu y poser un lien symbolique
# vers un fichier du système. Fonction isolée pour être testée seule, comme
# disque_refuse (preparer-disque.sh).
copie_avant_migration() {
  local DOSSIER="$1" TEMOIN_ARG="$2"
  find "$DOSSIER" -maxdepth 1 -type f -name 'avant-migration-*.db' -newer "$TEMOIN_ARG" 2>/dev/null | sort | head -n1
}

# Lance une commande sous le compte du service, depuis un dossier qu'il peut
# lire. Toute opération dans $DATA passe par là : un lien qu'il y aurait posé
# n'atteint alors que ce qu'il atteint déjà, jamais un fichier de root.
comme_service() { ( cd / && runuser -u "$COMPTE" -- "$@" ); }

# Remet la copie d'avant migration en place de lama.db, sous le compte du
# service, dans cet ordre (comme la restauration du service, backup.ts) :
# copie posée à côté sous lama.db.retour, base migrée mise de côté avec ses
# fichiers -wal et -shm, puis renommage. Un échec de la copie (disque plein)
# laisse ainsi la base migrée en place : jamais d'instant sans base, où un
# redémarrage ouvrirait l'écran d'installation. Fonction isolée pour être
# testée seule, comme copie_avant_migration.
remettre_copie() {
  local DOSSIER="$1" COPIE_ARG="$2" SUFFIXE="$3"
  comme_service cp -- "$COPIE_ARG" "$DOSSIER/lama.db.retour"
  comme_service chmod 0600 "$DOSSIER/lama.db.retour"
  comme_service mv -T -- "$DOSSIER/lama.db" "$DOSSIER/lama.db.migree-$SUFFIXE"
  if [ -f "$DOSSIER/lama.db-wal" ]; then comme_service mv -T -- "$DOSSIER/lama.db-wal" "$DOSSIER/lama.db-wal.migree-$SUFFIXE"; fi
  if [ -f "$DOSSIER/lama.db-shm" ]; then comme_service mv -T -- "$DOSSIER/lama.db-shm" "$DOSSIER/lama.db-shm.migree-$SUFFIXE"; fi
  comme_service mv -T -- "$DOSSIER/lama.db.retour" "$DOSSIER/lama.db"
}

# La suite ne s'exécute que si le script est lancé directement (jamais quand il
# est chargé par « source », utilisé par les tests pour isoler copie_avant_migration
# et remettre_copie).
if [ "${BASH_SOURCE:-$0}" = "$0" ]; then

  SOURCE="$(cd "$(dirname "$0")/.." && pwd -P)"

  [ "$(id -u)" -eq 0 ] || echec "$(msg "Lancez ce script avec sudo." "Run this script with sudo.")"
  [ -L "$APP/actuelle" ] || echec "$(msg "lama n'est pas installé ici. Lancez d'abord deploy/installer.sh." "lama is not installed here. Run deploy/installer.sh first.")"
  [ -f "$SOURCE/VERSION" ] && [ -f "$SOURCE/dist-server/main.mjs" ] || echec "$(msg "Archive incomplète, lancez le script depuis le dossier extrait." "Incomplete archive, run the script from the extracted folder.")"
  VERSION="$(cat "$SOURCE/VERSION")"
  [[ "$VERSION" =~ ^[0-9]{8}-[0-9]{4}-[0-9a-f]+$ ]] || echec "$(msg "VERSION invalide dans l'archive, refabriquez le paquet avec pnpm paquet." "Invalid VERSION in the archive, rebuild the package with pnpm paquet.")"
  PRECEDENTE="$(readlink -f "$APP/actuelle")"
  # La source ne doit jamais être la version en service ni le dossier $APP/actuelle
  # (pwd -P résout ce dossier vers sa cible réelle) : la suppression plus bas
  # viderait la source avant que cp -R ait pu la recopier.
  [ "$SOURCE" != "$PRECEDENTE" ] || echec "$(msg "N'installez pas depuis la version en service ($APP/actuelle), copiez d'abord l'archive ailleurs puis relancez depuis le dossier extrait." "Do not install from the running version ($APP/actuelle), copy the archive elsewhere first, then run again from the extracted folder.")"
  [ "$SOURCE" != "$APP/versions/$VERSION" ] || echec "$(msg "N'installez pas depuis $APP, copiez d'abord l'archive ailleurs puis relancez depuis le dossier extrait." "Do not install from $APP, copy the archive elsewhere first, then run again from the extracted folder.")"
  [ "$PRECEDENTE" != "$APP/versions/$VERSION" ] || echec "$(msg "La version $VERSION est déjà en service." "Version $VERSION is already running.")"

  etape "$(msg "Sauvegarde avant la mise à jour" "Backup before the update")"
  if ! systemctl start lama-sauvegarde.service --wait; then
    CODE_SAUVEGARDE="$(systemctl show -p ExecMainStatus --value lama-sauvegarde.service)"
    if [ "$CODE_SAUVEGARDE" = "2" ]; then
      echo "$(msg "La copie sur le disque USB a échoué, la copie Google Drive est en file. La mise à jour continue." "The copy to the USB drive failed, the Google Drive copy is queued. The update goes on.")"
    else
      echec "$(msg "La sauvegarde a échoué. Mise à jour annulée, rien n'a été modifié." "The backup failed. Update cancelled, nothing was changed.")"
    fi
  fi

  etape "$(msg "Nouvelle version $VERSION" "New version $VERSION")"
  rm -rf "$APP/versions/$VERSION"
  cp -R "$SOURCE" "$APP/versions/$VERSION"
  chown -R root:root "$APP/versions/$VERSION"
  chmod -R go-w "$APP/versions/$VERSION"
  install -m 0644 "$APP/versions/$VERSION"/deploy/systemd/* /etc/systemd/system/
  systemctl daemon-reload

  etape "$(msg "Certificat HTTPS et heure du serveur" "HTTPS certificate and server time")"
  # openssl, polkitd et systemd-timesyncd : posés par l'installateur depuis la vague 2,
  # absents d'un serveur installé avant.
  assurer_paquets
  # Sans paire avant et avec une paire après, c'est le passage au https : annoncé en fin.
  AVAIT_HTTPS=0
  [ -f "$CONF/tls/serveur.crt" ] && AVAIT_HTTPS=1
  # Avant le redémarrage : la nouvelle version démarre directement en https. Un échec
  # laisse la mise à jour continuer, lama démarre alors en http seul.
  installer_https_heure "$APP/versions/$VERSION" "$CONF" || echo "$(msg "Le certificat HTTPS n'a pas pu être fait, lama reste en http. Lancez ensuite sudo lama-certificat --adresse suivi de l'adresse fixe du serveur." "The HTTPS certificate could not be made, lama stays on http. Then run sudo lama-certificat --adresse followed by the server's fixed address.")"
  systemctl enable lama-certificat.timer
  systemctl start lama-certificat.timer
  ln -sfn "$APP/versions/$VERSION" "$APP/actuelle"
  # Posé juste avant que la nouvelle version ne démarre (et ne joue ses migrations
  # éventuelles), pour retrouver ensuite une copie avant-migration plus récente que lui.
  touch "$TEMOIN"
  systemctl restart lama.service

  etape "$(msg "Vérification" "Check")"
  if ! repond; then
    echo "$(msg "La nouvelle version ne répond pas. Retour à la version précédente." "The new version does not respond. Going back to the previous version.")" >&2
    systemctl stop lama.service
    ln -sfn "$PRECEDENTE" "$APP/actuelle"
    install -m 0644 "$PRECEDENTE"/deploy/systemd/* /etc/systemd/system/
    systemctl daemon-reload
    MESSAGE_BASE="$(msg "la base de données n'a pas été modifiée" "the database was not changed")"
    COPIE="$(copie_avant_migration "$DATA" "$TEMOIN")"
    if [ -n "$COPIE" ]; then
      HORODATAGE="$(date +%Y%m%d-%H%M%S)"
      remettre_copie "$DATA" "$COPIE" "$HORODATAGE"
      MESSAGE_BASE="$(msg "la base d'avant la migration a été remise en place, la base migrée est gardée sous lama.db.migree-$HORODATAGE" "the database from before the migration was put back, the migrated database is kept as lama.db.migree-$HORODATAGE")"
    fi
    systemctl start lama.service
    repond ou-http || echec "$(msg "La version précédente ne répond pas non plus, $MESSAGE_BASE. Consultez journalctl -u lama -n 100" "The previous version does not respond either, $MESSAGE_BASE. See journalctl -u lama -n 100")"
    rm -rf "$APP/versions/$VERSION"
    echec "$(msg "Mise à jour annulée, la version précédente est de nouveau en service, $MESSAGE_BASE." "Update cancelled, the previous version is running again, $MESSAGE_BASE.")"
  fi
  rm -f "$TEMOIN"
  # Base de formation (distribution D-14), si elle est installée et en marche : relancée sur la même version
  # que lama, une fois celle-ci vérifiée (try-restart ne démarre jamais un service arrêté ou absent).
  systemctl try-restart lama-formation.service || true

  etape "$(msg "WhatsApp (passerelle WAHA)" "WhatsApp (WAHA gateway)")"
  # Seulement une fois la nouvelle version en service : elle porte la version
  # de WAHA essayée avec elle (deploy/waha.version).
  installer_waha "$APP/actuelle" "$CONF" "$COMPTE" || echo "$(msg "WhatsApp n'a pas été mis à jour, lama fonctionne. Relancez sudo ./deploy/installer.sh depuis ce dossier une fois le problème réglé." "WhatsApp was not updated, lama works. Run sudo ./deploy/installer.sh from this folder again once the problem is fixed.")"

  etape "$(msg "Nettoyage" "Clean-up")"
  # Trie les versions par nom (AAAAMMJJ-HHMM-hachage, donc les plus récentes en
  # tête), pas par date de modification ; la version en service et la précédente
  # sont toujours gardées, même si elles tombaient hors des GARDER plus récentes.
  GARDEES=0
  while IFS= read -r NOM; do
    [ -z "$NOM" ] && continue
    GARDEES=$((GARDEES + 1))
    [ "$GARDEES" -le "$GARDER" ] && continue
    [ "$NOM" = "$VERSION" ] && continue
    [ "$NOM" = "$(basename "$PRECEDENTE")" ] && continue
    rm -rf "$APP/versions/$NOM"
  done < <(cd "$APP/versions" && ls -1d */ 2>/dev/null | sed 's#/$##' | sort -r)
  echo "$(msg "lama est à jour, version $VERSION." "lama is up to date, version $VERSION.")"
  if [ "$AVAIT_HTTPS" = 0 ] && [ -f "$CONF/tls/serveur.crt" ]; then
    annoncer_https "$APP/actuelle" "$CONF"
  fi

fi
