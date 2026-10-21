#!/usr/bin/env bash
# Installe lama sur un mini-PC Ubuntu 24.04 ou 26.04 neuf (Server ou bureau), ou le réinstalle
# sans toucher aux données ni aux clés déjà présentes.
# À lancer en root depuis le dossier extrait de l'archive, avec sudo ./deploy/installer.sh
# Deux modes, au choix au lancement ou par option : --auto (réglages par défaut,
# aucune question) ou --assiste (une question à chaque choix).
set -euo pipefail

# Messages dans la langue de LANG ou de LAMA_LANGUE (msg "texte" "text").
source "$(dirname "${BASH_SOURCE[0]}")/langue.sh"
# Passerelle WhatsApp WAHA (installer_waha).
source "$(dirname "${BASH_SOURCE[0]}")/waha.sh"
# HTTPS et heure du serveur (installer_https_heure, lama_repond).
source "$(dirname "${BASH_SOURCE[0]}")/https-heure.sh"
# Forme des versions (version_valide, spec du 21/10/2026, M-1).
source "$(dirname "${BASH_SOURCE[0]}")/verification.sh"
# Mise à jour par le réseau (poser_mise_a_jour_reseau).
source "$(dirname "${BASH_SOURCE[0]}")/mise-a-jour-pose.sh"

SOURCE="$(cd "$(dirname "$0")/.." && pwd -P)"
APP=/opt/lama
DATA=/var/lib/lama
CONF=/etc/lama
USB=/mnt/lama-sauvegarde
COMPTE=lama
# Numéro fixe du compte et du groupe de service, pris dans la plage système
# (100 à 999) loin des numéros attribués d'office, qui partent de 999 en
# descendant. Une machine de remplacement retrouve ainsi le même propriétaire
# sur le disque de sauvegarde (reprise après panne, LISEZMOI).
UID_SERVICE=871
NOM_RESEAU=lama
LIGNE_FSTAB="LABEL=LAMA-SAUVEGARDE /mnt/lama-sauvegarde ext4 nofail,noatime,x-systemd.automount,x-systemd.device-timeout=5s,x-systemd.idle-timeout=10min 0 2"

etape() { printf '\n== %s\n' "$1"; }
echec() { printf '%s\n' "$1" >&2; exit 1; }

# Crée le compte de service et son groupe avec le numéro fixe donné. Un compte
# déjà présent est gardé tel quel (réinstallation). Si le numéro est déjà pris
# par un autre compte ou un autre groupe, rien n'est créé : message sur la
# sortie d'erreur et retour 1, plutôt qu'un numéro différent de celui des
# autres machines. Fonction isolée pour être testée seule (src/server/deploy.test.ts).
creer_compte_service() {
  local COMPTE_SERVICE="$1" NUMERO="$2" DOSSIER="$3" AUTRE
  if id "$COMPTE_SERVICE" >/dev/null 2>&1; then
    return 0
  fi
  if AUTRE="$(getent passwd "$NUMERO")"; then
    printf '%s\n' "$(msg "Le numéro $NUMERO est déjà pris par le compte ${AUTRE%%:*}. Libérez-le (ou changez UID_SERVICE dans ce script) puis relancez." "Number $NUMERO is already used by the account ${AUTRE%%:*}. Free it (or change UID_SERVICE in this script), then run again.")" >&2
    return 1
  fi
  if AUTRE="$(getent group "$NUMERO")" && [ "${AUTRE%%:*}" != "$COMPTE_SERVICE" ]; then
    printf '%s\n' "$(msg "Le numéro $NUMERO est déjà pris par le groupe ${AUTRE%%:*}. Libérez-le (ou changez UID_SERVICE dans ce script) puis relancez." "Number $NUMERO is already used by the group ${AUTRE%%:*}. Free it (or change UID_SERVICE in this script), then run again.")" >&2
    return 1
  fi
  if ! getent group "$COMPTE_SERVICE" >/dev/null; then
    groupadd --system --gid "$NUMERO" "$COMPTE_SERVICE"
  elif [ "$(getent group "$COMPTE_SERVICE" | cut -d: -f3)" != "$NUMERO" ]; then
    printf '%s\n' "$(msg "Le groupe $COMPTE_SERVICE existe déjà avec un autre numéro que $NUMERO. Supprimez-le puis relancez." "The group $COMPTE_SERVICE already exists with a number other than $NUMERO. Delete it, then run again.")" >&2
    return 1
  fi
  useradd --system --uid "$NUMERO" --gid "$NUMERO" --home-dir "$DOSSIER" --no-create-home --shell /usr/sbin/nologin "$COMPTE_SERVICE"
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

# Affiche les clés de secours une seule fois, dans un cadre à imprimer ou à
# recopier ; une clé vide est dite « déjà créée ». Les textes traduits sont
# calculés avant le document : aucune apostrophe dans une valeur par défaut
# ${…:-…} d'un document ouvert (défaut trouvé en machine virtuelle, plan 2B).
# Fonction isolée pour être testée seule (src/server/deploy.test.ts).
afficher_cles() {
  local MAITRESSE="$1" PRIVEE="$2" DEJA TITRE CONSIGNE SERVEUR CLE1 CLE2 SANS JAMAIS INTERRUPTION
  DEJA="$(msg "déjà créée lors d'une installation précédente" "already created during a previous installation")"
  TITRE="$(msg "lama, clés de secours" "lama, recovery keys")"
  CONSIGNE="$(msg "À imprimer ou recopier, puis à ranger hors de l'institut" "Print or copy them, then keep them outside the institute")"
  local DATE_JOUR
  DATE_JOUR="$(date '+%d/%m/%Y')"
  SERVEUR="$(msg "Serveur $NOM_RESEAU, installé le $DATE_JOUR" "Server $NOM_RESEAU, installed on $DATE_JOUR")"
  CLE1="$(msg "1. Clé maîtresse (relit les secrets des réglages après une réinstallation)" "1. Master key (reads the settings secrets back after a reinstall)")"
  CLE2="$(msg "2. Clé privée des sauvegardes (seule capable de relire une sauvegarde)" "2. Backup private key (the only one able to read a backup)")"
  SANS="$(msg "Sans la clé 2, aucune sauvegarde ne peut être restaurée." "Without key 2, no backup can be restored.")"
  JAMAIS="$(msg "Ces clés ne seront plus jamais affichées." "These keys will never be shown again.")"
  INTERRUPTION="$(msg "Si vous interrompez avant de taper OUI, rien n'est enregistré, une relance affichera de nouvelles clés et celles-ci seront à jeter." "If you stop before typing YES, nothing is saved: running again shows new keys, and these ones must be thrown away.")"
  cat <<FIN

==============================================================================
  $TITRE
  $CONSIGNE
  $SERVEUR
==============================================================================

  $CLE1
     ${MAITRESSE:-$DEJA}

  $CLE2
     ${PRIVEE:-$DEJA}

  $SANS
  $JAMAIS
  $INTERRUPTION
==============================================================================

FIN
}

# Mode de l'installation, affiché sur la sortie standard : « auto » (réglages
# par défaut, aucune question) ou « assiste » (une question à chaque choix).
# Pris de l'option --auto ou --assiste (--assisted en anglais), sinon demandé
# par un menu sur la sortie d'erreur, réponse lue sur l'entrée standard (Entrée
# seule ou entrée fermée : automatique). Option inconnue : motif et retour 1.
# Fonction isolée pour être testée seule (src/server/deploy.test.ts).
choisir_mode() {
  local REPONSE
  case "${1:-}" in
    --auto) printf 'auto'; return 0 ;;
    --assiste|--assisted) printf 'assiste'; return 0 ;;
    "") ;;
    *) printf '%s\n' "$(msg "Option inconnue : $1 (attendu : --auto ou --assiste)." "Unknown option: $1 (expected: --auto or --assisted).")" >&2; return 1 ;;
  esac
  printf '\n%s\n  1. %s\n  2. %s\n' "$(msg "Mode d'installation" "Installation mode")" \
    "$(msg "Automatique : réglages par défaut, aucune question" "Automatic: default settings, no questions")" \
    "$(msg "Assistée : une question à chaque choix" "Assisted: one question for each choice")" >&2
  while true; do
    printf '%s' "$(msg "Votre choix, 1 ou 2 [1] : " "Your choice, 1 or 2 [1]: ")" >&2
    read -r REPONSE || REPONSE=""
    case "$REPONSE" in
      ""|1) printf 'auto'; return 0 ;;
      2) printf 'assiste'; return 0 ;;
    esac
  done
}

# Question oui ou non. En mode assisté (MODE=assiste), la pose sur la sortie
# d'erreur et lit la réponse ; Entrée seule ou entrée fermée donnent la réponse
# par défaut. En mode automatique, rend la réponse par défaut sans rien
# demander. demander "question" o|n ; retourne 0 pour oui, 1 pour non.
# Fonction isolée pour être testée seule (src/server/deploy.test.ts).
demander() {
  local QUESTION="$1" DEFAUT="$2" REPONSE INVITE
  if [ "${MODE:-auto}" != "assiste" ]; then
    [ "$DEFAUT" = o ]
    return
  fi
  if [ "$DEFAUT" = o ]; then INVITE="$(msg "[O/n]" "[Y/n]")"; else INVITE="$(msg "[o/N]" "[y/N]")"; fi
  while true; do
    printf '%s %s ' "$QUESTION" "$INVITE" >&2
    read -r REPONSE || REPONSE=""
    case "$REPONSE" in
      "") [ "$DEFAUT" = o ]; return ;;
      o|O|oui|Oui|OUI|y|Y|yes|Yes|YES) return 0 ;;
      n|N|non|Non|NON|no|No|NO) return 1 ;;
    esac
  done
}

# Texte libre en mode assisté, affiché sur la sortie standard ; Entrée seule ou
# entrée fermée donnent la valeur par défaut. demander_texte "question" défaut
demander_texte() {
  local QUESTION="$1" DEFAUT="$2" REPONSE
  printf '%s [%s]%s ' "$QUESTION" "$DEFAUT" "$(msg " :" ":")" >&2
  read -r REPONSE || REPONSE=""
  printf '%s' "${REPONSE:-$DEFAUT}"
}

# Chargé par « source » (tests de poser_temoin), le script s'arrête ici,
# avant toute vérification ou action.
[ "${BASH_SOURCE:-$0}" = "$0" ] || return 0

[ "$(id -u)" -eq 0 ] || echec "$(msg "Lancez ce script avec sudo." "Run this script with sudo.")"
grep -q -E '^VERSION_ID="(24|26)\.04"' /etc/os-release || echec "$(msg "Ce script attend Ubuntu 24.04 ou 26.04." "This script expects Ubuntu 24.04 or 26.04.")"
[ -f "$SOURCE/VERSION" ] && [ -f "$SOURCE/dist-server/main.mjs" ] || echec "$(msg "Archive incomplète, lancez le script depuis le dossier extrait." "Incomplete archive, run the script from the extracted folder.")"
VERSION="$(cat "$SOURCE/VERSION")"
version_valide "$VERSION" || echec "$(msg "VERSION invalide dans l'archive, refabriquez le paquet avec pnpm paquet." "Invalid VERSION in the archive, rebuild the package with pnpm paquet.")"
[ "$SOURCE" != "$APP/versions/$VERSION" ] || echec "$(msg "N'installez pas depuis $APP, copiez d'abord l'archive ailleurs puis relancez depuis le dossier extrait." "Do not install from $APP, copy the archive elsewhere first, then run again from the extracted folder.")"
# Relancer l'installation ne sert qu'à réinstaller la version en service (ou à
# reprendre le disque de sauvegarde). Une autre version passe par
# mettre-a-jour.sh, qui sauvegarde d'abord et revient en arrière en cas d'échec.
if [ -L "$APP/actuelle" ] && [ "$(readlink -f "$APP/actuelle")" != "$APP/versions/$VERSION" ]; then
  EN_SERVICE="$(basename "$(readlink -f "$APP/actuelle")")"
  echec "$(msg "Une autre version de lama est en service ($EN_SERVICE). Pour passer à la version $VERSION, lancez sudo ./deploy/mettre-a-jour.sh depuis ce dossier." "Another version of lama is running ($EN_SERVICE). To move to version $VERSION, run sudo ./deploy/mettre-a-jour.sh from this folder.")"
fi

if [ "${LAMA_ESSAI_SANS_TERMINAL:-0}" != "1" ]; then
  # LAMA_ESSAI_SANS_TERMINAL=1 lève cette vérification : réservé aux essais
  # automatisés en machine virtuelle (tâche 15), jamais à une installation réelle.
  [ -t 0 ] && [ -t 1 ] || echec "$(msg "Lancez l'installation dans un terminal, les clés s'affichent à l'écran une seule fois." "Run the installation in a terminal, the keys are shown on screen only once.")"
fi

# Essai automatisé sans terminal ni option : mode automatique, sans menu.
if [ -z "${1:-}" ] && [ "${LAMA_ESSAI_SANS_TERMINAL:-0}" = "1" ]; then
  MODE=auto
else
  MODE="$(choisir_mode "${1:-}")" || exit 1
fi
FUSEAU=Africa/Douala
if [ "$MODE" = "assiste" ]; then
  echo
  if demander "$(msg "Langue des messages : français. Passer en anglais ?" "Language of the messages: English. Switch to French?")" n; then
    if [ "$LANGUE" = "en" ]; then LANGUE=fr; else LANGUE=en; fi
    MOT_OUI="$(msg "OUI" "YES")"
    MOT_EFFACER="$(msg "EFFACER" "ERASE")"
  fi
  # Les scripts lancés plus bas (disque, formation, Google Drive) parlent la même langue.
  export LAMA_LANGUE="$LANGUE"
  until FUSEAU="$(demander_texte "$(msg "Fuseau horaire de l'institut" "Time zone of the institute")" "$FUSEAU")" \
    && [[ "$FUSEAU" =~ ^[A-Za-z_]+(/[A-Za-z0-9_+-]+)+$ ]] && [ -f "/usr/share/zoneinfo/$FUSEAU" ]; do
    echo "$(msg "Fuseau inconnu, par exemple Africa/Douala, Africa/Abidjan, Europe/Paris." "Unknown time zone, for example Africa/Douala, Africa/Abidjan, Europe/Paris.")"
    FUSEAU=Africa/Douala
  done
  # L'heure doit être juste avant tout le reste : paquets, certificat, factures.
  timedatectl set-timezone "$FUSEAU"
  if ! demander "$(msg "Le serveur indique $(date '+%d/%m/%Y %H:%M'). Est-ce l'heure exacte ?" "The server shows $(date '+%Y-%m-%d %H:%M'). Is this the exact time?")" o; then
    until HEURE="$(demander_texte "$(msg "Heure exacte, AAAA-MM-JJ HH:MM" "Exact time, YYYY-MM-DD HH:MM")" "$(date '+%Y-%m-%d %H:%M')")" \
      && [[ "$HEURE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}$ ]] && date -d "$HEURE" >/dev/null 2>&1; do
      echo "$(msg "Format attendu : 2026-10-19 14:30" "Expected format: 2026-10-19 14:30")"
    done
    # La synchronisation automatique empêche tout réglage à la main ; l'étape HTTPS et heure la rallume.
    timedatectl set-ntp false 2>/dev/null || true
    timedatectl set-time "$HEURE:00" || echec "$(msg "L'heure n'a pas pu être réglée." "The time could not be set.")"
    echo "$(msg "Heure réglée : $(date '+%d/%m/%Y %H:%M')." "Time set: $(date '+%Y-%m-%d %H:%M').")"
  fi
fi

etape "$(msg "Paquets du système" "System packages")"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg age rclone avahi-daemon parted openssl polkitd systemd-timesyncd
NODE_MAJEURE=0
[ -x /usr/bin/node ] && NODE_MAJEURE="$(/usr/bin/node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJEURE" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -q nodejs
fi

etape "$(msg "Compte de service et dossiers" "Service account and folders")"
creer_compte_service "$COMPTE" "$UID_SERVICE" "$DATA" || echec "$(msg "Le compte de service n'a pas pu être créé." "The service account could not be created.")"
install -d -m 0700 -o "$COMPTE" -g "$COMPTE" "$DATA"
install -d -m 0750 -o root -g "$COMPTE" "$CONF"

etape "$(msg "Clés" "Keys")"
CLE_MAITRESSE=""
[ -f "$CONF/master.key" ] || CLE_MAITRESSE="$(head -c 32 /dev/urandom | base64)"
CLE_PRIVEE=""
CLE_PUBLIQUE=""
if [ ! -f "$CONF/sauvegarde.pub" ]; then
  # La clé privée reste en mémoire, jamais sur disque : affichée juste en dessous,
  # elle n'est ni écrite ni journalisée avant la confirmation OUI (spec § 7).
  CLE_PRIVEE="$(age-keygen 2>/dev/null | grep '^AGE-SECRET-KEY-1')"
  CLE_PUBLIQUE="$(printf '%s\n' "$CLE_PRIVEE" | age-keygen -y)"
fi
if [ -n "$CLE_MAITRESSE" ] || [ -n "$CLE_PRIVEE" ]; then
  afficher_cles "$CLE_MAITRESSE" "$CLE_PRIVEE"
  REPONSE=""
  until [ "$REPONSE" = "$MOT_OUI" ]; do
    printf '%s' "$(msg "Une fois les clés recopiées, tapez OUI puis Entrée. " "Once the keys are copied, type YES then Enter. ")"
    read -r REPONSE || echec "$(msg "Confirmation attendue, relancez le script pour régénérer ces clés." "Confirmation expected, run the script again to generate new keys.")"
  done
  # Les clés ne doivent pas rester lisibles en remontant dans le terminal :
  # efface le défilement (3J), puis l'écran.
  printf '\033[3J\033[H\033[2J'
  echo "$(msg "Clés effacées de l'écran. Fermez aussi l'historique de votre session SSH s'il est enregistré (journal du terminal, enregistrement de session)." "Keys cleared from the screen. Also clear your SSH session history if it is recorded (terminal log, session recording).")"
  # Rien n'est écrit sur disque avant cette confirmation : une interruption
  # plus haut ne laisse jamais de clé à moitié enregistrée.
  if [ -n "$CLE_MAITRESSE" ]; then
    ( umask 077; printf '%s\n' "$CLE_MAITRESSE" > "$CONF/master.key" )
  fi
  if [ -n "$CLE_PUBLIQUE" ]; then
    printf '%s\n' "$CLE_PUBLIQUE" > "$CONF/sauvegarde.pub"
    chmod 0644 "$CONF/sauvegarde.pub"
  fi
fi
[ -f "$CONF/master.key" ] && chown "$COMPTE:$COMPTE" "$CONF/master.key" && chmod 0600 "$CONF/master.key"

etape "$(msg "Fuseau horaire et nom sur le réseau" "Time zone and network name")"
timedatectl set-timezone "$FUSEAU"
hostnamectl set-hostname "$NOM_RESEAU"
grep -q "^127\.0\.1\.1 $NOM_RESEAU\$" /etc/hosts || printf '127.0.1.1 %s\n' "$NOM_RESEAU" >> /etc/hosts
systemctl enable --now avahi-daemon
# Ubuntu bureau se met en veille seul après quelques minutes sans clavier ni souris :
# le serveur deviendrait injoignable. Veille et hibernation sont coupées pour de bon.
if [ "$(systemctl get-default)" = "graphical.target" ] \
  && demander "$(msg "Ubuntu bureau$ : couper la mise en veille pour que le serveur reste joignable$ ?" "Ubuntu desktop: turn sleep off so the server stays reachable?")" o; then
  systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null
  echo "$(msg "Ubuntu bureau : mise en veille coupée, le serveur reste joignable." "Ubuntu desktop: sleep turned off, the server stays reachable.")"
fi

etape "$(msg "Programme, version $VERSION" "Program, version $VERSION")"
# Créé par le compte du service lui-même : $DATA lui appartient, et un lien
# qu'il y aurait posé ne doit jamais être suivi par root (install -d -o change
# le propriétaire de la cible d'un lien existant).
( cd / && runuser -u "$COMPTE" -- install -d -m 0700 "$DATA/rclone" )
install -d -m 0755 -o root -g root "$APP" "$APP/versions" "$USB"
rm -rf "$APP/versions/$VERSION"
cp -R "$SOURCE" "$APP/versions/$VERSION"
chown -R root:root "$APP/versions/$VERSION"
chmod -R go-w "$APP/versions/$VERSION"
ln -sfn "$APP/versions/$VERSION" "$APP/actuelle"

etape "$(msg "Certificat HTTPS et heure du serveur" "HTTPS certificate and server time")"
# Autorité de l'institut et certificat du serveur (lama.local et l'adresse fixe), synchronisation
# de l'heure, règle polkit de Réglages > Heure. Sans certificat, lama démarrerait en http seul.
# lama-certificat relance lama s'il tourne déjà (réinstallation) ; au premier passage il n'y a rien à relancer.
installer_https_heure "$APP/actuelle" "$CONF" || echec "$(msg "Le certificat HTTPS n'a pas pu être fait. Corrigez la cause indiquée plus haut puis relancez sudo ./deploy/installer.sh." "The HTTPS certificate could not be made. Fix the cause shown above, then run sudo ./deploy/installer.sh again.")"

etape "$(msg "Disque de sauvegarde USB" "USB backup drive")"
grep -q '^LABEL=LAMA-SAUVEGARDE ' /etc/fstab || printf '%s\n' "$LIGNE_FSTAB" >> /etc/fstab
systemctl daemon-reload
AUTOMOUNT="$(systemd-escape --path --suffix=automount "$USB")"
systemctl restart "$AUTOMOUNT" || true
# Mode assisté : un disque USB neuf peut être préparé ici (preparer-disque.sh
# refuse le disque du système et demande EFFACER avant d'effacer quoi que ce soit).
if [ "$MODE" = "assiste" ] && ! blkid -L LAMA-SAUVEGARDE >/dev/null 2>&1; then
  DISQUES_USB="$(lsblk -d -n -o NAME,TRAN,SIZE,MODEL 2>/dev/null | awk '$2 == "usb"' || true)"
  if [ -n "$DISQUES_USB" ]; then
    echo "$(msg "Disques USB branchés$ :" "USB drives plugged in:")"
    printf '%s\n' "$DISQUES_USB" | sed 's/^/  /'
    if demander "$(msg "Préparer l'un d'eux pour les sauvegardes$ ? Tout son contenu sera effacé." "Prepare one of them for backups? Everything on it will be erased.")" n; then
      NOM_DISQUE="$(demander_texte "$(msg "Nom du disque, par exemple sdb" "Drive name, for example sdb")" "$(printf '%s\n' "$DISQUES_USB" | awk 'NR == 1 { print $1 }')")"
      if printf '%s\n' "$DISQUES_USB" | awk '{ print $1 }' | grep -xF -- "${NOM_DISQUE#/dev/}" >/dev/null; then
        "$APP/actuelle/deploy/preparer-disque.sh" "/dev/${NOM_DISQUE#/dev/}" || echo "$(msg "Le disque n'a pas été préparé, l'installation continue sans lui." "The drive was not prepared, the installation goes on without it.")"
      else
        echo "$(msg "Ce disque n'est pas dans la liste, rien n'a été effacé." "This drive is not in the list, nothing was erased.")"
      fi
    fi
  fi
fi
DISQUE_PRET=0
if blkid -L LAMA-SAUVEGARDE >/dev/null 2>&1; then
  ls "$USB" >/dev/null 2>&1 || true
  if findmnt -n -t ext4 "$USB" >/dev/null; then
    poser_temoin "$USB" "$COMPTE" || echec "$(msg "Le témoin du disque de sauvegarde n'a pas pu être posé." "The backup drive marker could not be written.")"
    DISQUE_PRET=1
    echo "$(msg "Disque LAMA-SAUVEGARDE prêt." "LAMA-SAUVEGARDE drive ready.")"
  else
    echo "$(msg "Le disque LAMA-SAUVEGARDE est branché mais ne se monte pas. Préparez-le avec $APP/actuelle/deploy/preparer-disque.sh" "The LAMA-SAUVEGARDE drive is plugged in but does not mount. Prepare it with $APP/actuelle/deploy/preparer-disque.sh")"
  fi
else
  echo "$(msg "Aucun disque étiqueté LAMA-SAUVEGARDE n'est branché. L'installation continue sans lui." "No drive labelled LAMA-SAUVEGARDE is plugged in. The installation goes on without it.")"
  echo "$(msg "Disque de sauvegarde existant (reprise après panne) : branchez-le puis relancez sudo ./deploy/installer.sh depuis la même archive, sans le préparer." "Existing backup drive (recovery after a failure): plug it in, then run sudo ./deploy/installer.sh again from the same archive, without preparing it.")"
  echo "$(msg "Disque neuf seulement : sudo $APP/actuelle/deploy/preparer-disque.sh /dev/sdX (efface tout le disque)." "New drive only: sudo $APP/actuelle/deploy/preparer-disque.sh /dev/sdX (erases the whole drive).")"
fi

etape "$(msg "Services" "Services")"
install -m 0644 "$APP/actuelle/deploy/systemd/lama.service" "$APP/actuelle/deploy/systemd/lama-sauvegarde.service" "$APP/actuelle/deploy/systemd/lama-sauvegarde.timer" \
  "$APP/actuelle/deploy/systemd/lama-certificat.service" "$APP/actuelle/deploy/systemd/lama-certificat.timer" /etc/systemd/system/
install -m 0644 "$APP/actuelle/deploy/systemd/lama-mise-a-jour.service" "$APP/actuelle/deploy/systemd/lama-mise-a-jour.path" "$APP/actuelle/deploy/systemd/lama-mise-a-jour.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable lama.service lama-sauvegarde.timer lama-certificat.timer
systemctl restart lama.service
systemctl start lama-sauvegarde.timer lama-certificat.timer
poser_mise_a_jour_reseau "$DATA" "$COMPTE" /var/cache/lama-mise-a-jour || echec "$(msg "La mise à jour depuis l'application n'a pas pu être posée. Corrigez la cause indiquée plus haut, puis relancez sudo ./deploy/installer.sh." "Updates from the application could not be set up. Fix the cause shown above, then run sudo ./deploy/installer.sh again.")"

etape "$(msg "Vérification" "Check")"
lama_repond "$CONF" || echec "$(msg "Le service ne répond pas en https. Consultez journalctl -u lama -n 50" "The service does not respond over https. See journalctl -u lama -n 50")"
curl -fsS --max-time 5 http://127.0.0.1/certificat >/dev/null 2>&1 || echec "$(msg "La page du certificat ne répond pas en http. Consultez journalctl -u lama -n 50" "The certificate page does not respond over http. See journalctl -u lama -n 50")"

etape "$(msg "WhatsApp (passerelle WAHA)" "WhatsApp (WAHA gateway)")"
# Après la vérification : la base est créée et migrée, la clé peut y être
# inscrite. Un échec ici laisse lama en service, sans envoi WhatsApp.
if demander "$(msg "Installer la passerelle WhatsApp (Docker et WAHA)$ ?" "Install the WhatsApp gateway (Docker and WAHA)?")" o; then
  installer_waha "$APP/actuelle" "$CONF" "$COMPTE" || echo "$(msg "WhatsApp n'est pas installé, lama fonctionne sans. Relancez sudo ./deploy/installer.sh une fois le problème réglé." "WhatsApp is not installed, lama works without it. Run sudo ./deploy/installer.sh again once the problem is fixed.")"
else
  echo "$(msg "WhatsApp laissé de côté, lama fonctionne sans. Pour l'ajouter plus tard, relancez sudo ./deploy/installer.sh." "WhatsApp left out, lama works without it. To add it later, run sudo ./deploy/installer.sh again.")"
fi

FORMATION=0
if demander "$(msg "Installer la base de formation (port 8443)$ ?" "Install the training database (port 8443)?")" n; then
  etape "$(msg "Base de formation" "Training database")"
  "$APP/actuelle/deploy/lama-formation.sh" --installer && FORMATION=1 || echo "$(msg "La base de formation n'est pas installée. Plus tard$ : sudo $APP/actuelle/deploy/lama-formation.sh --installer" "The training database is not installed. Later: sudo $APP/actuelle/deploy/lama-formation.sh --installer")"
fi
if demander "$(msg "Relier Google Drive aux sauvegardes maintenant$ ?" "Connect Google Drive to the backups now?")" n; then
  etape "$(msg "Google Drive" "Google Drive")"
  "$APP/actuelle/deploy/configurer-drive.sh" || echo "$(msg "Google Drive n'est pas relié. Plus tard$ : sudo $APP/actuelle/deploy/configurer-drive.sh" "Google Drive is not connected. Later: sudo $APP/actuelle/deploy/configurer-drive.sh")"
fi

echo
echo "$(msg "lama est installé, version $VERSION." "lama is installed, version $VERSION.")"
echo "$(msg "Sur chaque appareil du Wi-Fi de l'institut, ouvrez d'abord http://$NOM_RESEAU.local/certificat et approuvez le certificat, puis ouvrez https://$NOM_RESEAU.local (la première fois, pour créer le compte administrateur)." "On each device on the institute's Wi-Fi, first open http://$NOM_RESEAU.local/certificat and approve the certificate, then open https://$NOM_RESEAU.local (the first time, to create the administrator account).")"
"$APP/actuelle/deploy/lama-certificat.sh" --etat || true
[ "$DISQUE_PRET" = 1 ] || echo "$(msg "Rappel, le disque de sauvegarde USB reste à préparer." "Reminder, the USB backup drive still has to be prepared.")"
[ "$FORMATION" = 1 ] || echo "$(msg "Base de formation, facultative, sur le port 8443, sudo $APP/actuelle/deploy/lama-formation.sh --installer" "Training database, optional, on port 8443, sudo $APP/actuelle/deploy/lama-formation.sh --installer")"
