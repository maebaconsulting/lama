#!/usr/bin/env bash
# Fabrique l'archive d'une version de lama, à copier sur le serveur de l'institut.
# À lancer sur le poste de développement, avec pnpm paquet.
set -euo pipefail

# Messages dans la langue de LANG ou de LAMA_LANGUE (msg "texte" "text").
source "$(dirname "${BASH_SOURCE[0]}")/langue.sh"

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"

if [ -n "$(git status --porcelain)" ]; then
  echo "$(msg "Des modifications ne sont pas enregistrées dans git. Enregistrez-les avant de fabriquer un paquet." "Some changes are not committed to git. Commit them before building a package.")" >&2
  exit 1
fi

VERSION="$(date +%Y%m%d-%H%M)-$(git rev-parse --short HEAD)"
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
