#!/usr/bin/env bash
# Fabrique l'archive d'une version de lama, à copier sur le serveur de l'institut.
# Sur le poste de développement : pnpm paquet, paquet de développement (VERSION
# AAAAMMJJ-HHMM-empreinte), installable à la main, jamais proposé par l'application.
# Version publiée (travail GitHub « Publier une version », spec du 21/10/2026, M-1) :
# --publiee, VERSION et nom de l'archive pris dans package.json (X.Y.Z).
set -euo pipefail

# Messages dans la langue de LANG ou de LAMA_LANGUE (msg "texte" "text").
source "$(dirname "${BASH_SOURCE[0]}")/langue.sh"
# Forme des versions (version_publiee).
source "$(dirname "${BASH_SOURCE[0]}")/verification.sh"

# Version écrite dans VERSION : celle de package.json pour une version publiée (PUBLIEE=1,
# refusée si elle n'est pas X.Y.Z), sinon AAAAMMJJ-HHMM-empreinte du commit en cours.
version_a_fabriquer() {
  local RACINE_ARG="$1" PUBLIEE_ARG="$2" LUE
  if [ "$PUBLIEE_ARG" = 1 ]; then
    LUE="$(node -p 'require(process.argv[1]).version' "$RACINE_ARG/package.json")" || return 1
    version_publiee "$LUE" || return 1
    printf '%s' "$LUE"
  else
    printf '%s-%s' "$(date +%Y%m%d-%H%M)" "$(git -C "$RACINE_ARG" rev-parse --short HEAD)"
  fi
}

# Chargé par « source » (essai de version_a_fabriquer), le script s'arrête ici.
[ "${BASH_SOURCE:-$0}" = "$0" ] || return 0

PUBLIEE=0
case "${1:-}" in
  --publiee) PUBLIEE=1 ;;
  "") ;;
  *) echo "$(msg "Option inconnue : $1 (attendu : --publiee, ou rien)." "Unknown option: $1 (expected: --publiee, or nothing).")" >&2; exit 1 ;;
esac

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"

if [ -n "$(git status --porcelain)" ]; then
  echo "$(msg "Des modifications ne sont pas enregistrées dans git. Enregistrez-les avant de fabriquer un paquet." "Some changes are not committed to git. Commit them before building a package.")" >&2
  exit 1
fi

VERSION="$(version_a_fabriquer "$RACINE" "$PUBLIEE")" || { echo "$(msg "Version de package.json invalide, X.Y.Z attendu." "Invalid version in package.json, X.Y.Z expected.")" >&2; exit 1; }
NOM="lama-$VERSION"

pnpm run build

ETAPE="$(mktemp -d)"
trap 'rm -rf "$ETAPE"' EXIT
mkdir -p "$ETAPE/$NOM"
cp -R dist dist-server deploy "$ETAPE/$NOM/"
printf '%s\n' "$VERSION" > "$ETAPE/$NOM/VERSION"

mkdir -p paquets
# COPYFILE_DISABLE évite les fichiers ._* du Mac dans l'archive, --no-xattrs
# ses attributs étendus (com.apple.provenance), que le tar d'Ubuntu signale
# par une avalanche d'avertissements à l'extraction.
COPYFILE_DISABLE=1 tar --no-xattrs -C "$ETAPE" -czf "paquets/$NOM.tar.gz" "$NOM"
echo "$(msg "Paquet prêt dans paquets/$NOM.tar.gz" "Package ready in paquets/$NOM.tar.gz")"
