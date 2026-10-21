#!/usr/bin/env bash
# Installe lama sur un mini-PC Ubuntu 24.04 ou 26.04 depuis le dépôt public, en deux commandes :
#   curl -fsSL https://raw.githubusercontent.com/maebaconsulting/lama/main/deploy/installer-en-ligne.sh -o installer-en-ligne.sh
#   sudo bash installer-en-ligne.sh            (ou --auto, --assiste : options de installer.sh)
# Jamais « curl … | sudo bash » : sudo-rs d'Ubuntu 26.04 ne transmet alors plus le clavier
# et la première question attend sans fin (vu le 21/10/2026) ; le script le refuse.
# Pose Git et Node 24, clone le dépôt, fabrique le paquet (pnpm paquet), puis lance
# deploy/installer.sh depuis le dossier extrait, dans le même terminal (questions et
# clés de secours). LAMA_DEPOT (propriétaire/nom) et
# LAMA_REF (branche ou étiquette) désignent une autre source, pour une recette.
set -euo pipefail

DEPOT_DEFAUT=maebaconsulting/lama
REF_DEFAUT=main
# Version de pnpm du poste de développement, compatible avec pnpm-lock.yaml.
PNPM_VERSION=10.23.0
# Sous /var/lib, où seul root écrit : jamais /tmp ni /var/tmp, où un autre compte pourrait
# créer le dossier d'avance et y glisser son propre installer.sh avant qu'il soit lancé en root.
TRAVAIL=/var/lib/lama-installation

# Messages en anglais si LAMA_LANGUE=en ou LANG commence par en, en français sinon
# (deploy/langue.sh n'existe pas encore sur la machine à ce stade).
msg() {
  case "${LAMA_LANGUE:-${LANG:-}}" in
    en*) printf '%s' "$2" ;;
    *) printf '%s' "$1" ;;
  esac
}
echec() { echo "$1" >&2; exit 1; }
etape() { printf '\n== %s ==\n' "$1"; }

# Source désignée : propriétaire/nom et branche ou étiquette, sans caractère inattendu.
source_valide() {
  [[ "$1" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] && [[ "$2" =~ ^[A-Za-z0-9_./-]+$ ]] && [[ "$2" != *..* ]] && [[ "$2" != -* ]]
}

# Tout le travail est dans cette fonction, appelée à la dernière ligne : un
# fichier téléchargé à moitié n'exécute rien.
principal() {
  local DEPOT="${LAMA_DEPOT:-$DEPOT_DEFAUT}" REF="${LAMA_REF:-$REF_DEFAUT}" DOSSIER SOURCE ARCHIVE NODE_MAJEURE

  [ "$(id -u)" -eq 0 ] || echec "$(msg "Lancez ce script avec sudo bash installer-en-ligne.sh." "Run this script with sudo bash installer-en-ligne.sh.")"
  # Les questions et les clés de secours passent par le terminal : le script doit le recevoir
  # en entrée, ce qui exclut « curl … | sudo bash ».
  [ -t 0 ] && [ -t 1 ] || echec "$(msg "Téléchargez le script puis lancez-le dans un terminal : curl -fsSL https://raw.githubusercontent.com/maebaconsulting/lama/main/deploy/installer-en-ligne.sh -o installer-en-ligne.sh puis sudo bash installer-en-ligne.sh" "Download the script, then run it in a terminal: curl -fsSL https://raw.githubusercontent.com/maebaconsulting/lama/main/deploy/installer-en-ligne.sh -o installer-en-ligne.sh then sudo bash installer-en-ligne.sh")"
  grep -q -E '^VERSION_ID="(24|26)\.04"' /etc/os-release || echec "$(msg "Ce script attend Ubuntu 24.04 ou 26.04." "This script expects Ubuntu 24.04 or 26.04.")"
  source_valide "$DEPOT" "$REF" || echec "$(msg "Source invalide : LAMA_DEPOT=propriétaire/nom, LAMA_REF=branche ou étiquette." "Invalid source: LAMA_DEPOT=owner/name, LAMA_REF=branch or tag.")"

  etape "$(msg "Git et Node 24" "Git and Node 24")"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q ca-certificates curl git
  NODE_MAJEURE=0
  [ -x /usr/bin/node ] && NODE_MAJEURE="$(/usr/bin/node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$NODE_MAJEURE" -lt 24 ]; then
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
    apt-get install -y -q nodejs
  fi
  npm install -g --no-fund --no-audit "pnpm@$PNPM_VERSION"

  etape "$(msg "Programme, depuis github.com/$DEPOT ($REF)" "Program, from github.com/$DEPOT ($REF)")"
  install -d -m 0700 -o root -g root "$TRAVAIL"
  [ ! -L "$TRAVAIL" ] && [ "$(stat -c %u "$TRAVAIL")" = 0 ] || echec "$(msg "$TRAVAIL doit être un dossier de root." "$TRAVAIL must be a folder owned by root.")"
  DOSSIER="$(mktemp -d "$TRAVAIL/$(date +%Y%m%d-%H%M%S)-XXXX")"
  SOURCE="$DOSSIER/source"
  git clone --quiet --depth 1 --branch "$REF" "https://github.com/$DEPOT.git" "$SOURCE" \
    || echec "$(msg "Le dépôt n'a pas pu être téléchargé, vérifiez la connexion à internet." "The repository could not be downloaded, check the internet connection.")"
  (cd "$SOURCE" && CI=true pnpm install --frozen-lockfile && pnpm paquet) \
    || echec "$(msg "Le paquet n'a pas pu être fabriqué." "The package could not be built.")"
  ARCHIVE="$(ls "$SOURCE"/paquets/lama-*.tar.gz)"
  tar -xzf "$ARCHIVE" -C "$DOSSIER"
  # Le dépôt et ses dépendances ne servent plus : seul le dossier extrait reste, pour relancer l'installation.
  rm -rf "$SOURCE"

  etape "$(msg "Installation" "Installation")"
  cd "$DOSSIER"/lama-*/
  echo "$(msg "Dossier de la version : $PWD" "Version folder: $PWD")"
  # La fabrication du paquet peut laisser le terminal sans conversion du retour chariot :
  # Entrée n'y termine plus la ligne et chaque question attend sans fin (vu le 21/10/2026).
  stty sane 2>/dev/null || true
  ./deploy/installer.sh "$@"
}

# Chargé par « source » (essais), le script s'arrête ici.
[ "${BASH_SOURCE:-$0}" = "$0" ] || return 0

principal "$@"
