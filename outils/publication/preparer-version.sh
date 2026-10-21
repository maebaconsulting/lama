#!/usr/bin/env bash
# Prépare une version publiée de lama (spec du 21/10/2026, M-3, M-4), pour le travail GitHub
# « Publier une version » lancé par une étiquette annotée vX.Y.Z :
#   preparer-version.sh --verifier <étiquette> <note>
#   preparer-version.sh <étiquette> <note> <clé privée PEM> <dossier de sortie>
# Refuse une étiquette qui n'est pas vX.Y.Z ou ne correspond pas à package.json, une note sans
# ses deux langues ; puis fabrique l'archive (fabriquer-paquet.sh --publiee), NOTES.md,
# SHA256SUMS (archive et note), SHA256SUMS.sig, et vérifie la signature avec
# deploy/cle-publique.pem (ou cle-publique-precedente.pem, version de changement de clé) : une clé privée qui ne lui correspond pas arrête tout.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../deploy/langue.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../../deploy/verification.sh"

echec() { printf '%s\n' "$1" >&2; exit 1; }

# Vrai si ETIQUETTE vaut vVERSION, VERSION étant une version publiée X.Y.Z.
etiquette_conforme() {
  version_publiee "${2:-}" && [ "${1:-}" = "v$2" ]
}

# Vrai si la note a une seule ligne ---en---, du texte avant (français) et du texte après (anglais).
note_conforme() {
  local FICHIER="$1"
  [ "$(grep -cx -- '---en---' "$FICHIER")" = 1 ] || return 1
  awk '/^---en---$/ { anglais = 1; next } NF { if (anglais) en = 1; else fr = 1 } END { exit !(fr && en) }' "$FICHIER"
}

# Clé publique qui vérifie la signature : celle de la version précédente quand l'arbre la livre
# (deploy/cle-publique-precedente.pem marque la version de changement de clé, encore signée par
# l'ancienne clé), sinon deploy/cle-publique.pem.
cle_de_verification() {
  if [ -f "$1/deploy/cle-publique-precedente.pem" ]; then echo "$1/deploy/cle-publique-precedente.pem"; else echo "$1/deploy/cle-publique.pem"; fi
}

# Écrit SHA256SUMS (archive ARCHIVE et NOTES.md) dans DOSSIER, puis le signe avec la clé privée CLE.
signer_version() {
  local DOSSIER="$1" ARCHIVE="$2" CLE="$3"
  ( cd "$DOSSIER" && sha256sum "$ARCHIVE" NOTES.md > SHA256SUMS )
  "$OPENSSL" pkeyutl -sign -rawin -inkey "$CLE" -in "$DOSSIER/SHA256SUMS" -out "$DOSSIER/SHA256SUMS.sig"
}

if [ "${BASH_SOURCE:-$0}" = "$0" ]; then
  RACINE="$(cd "$(dirname "$0")/../.." && pwd)"
  VERIFIER=0
  if [ "${1:-}" = --verifier ]; then VERIFIER=1; shift; fi
  if [ "$VERIFIER" = 1 ]; then [ $# -eq 2 ] || echec "$(msg "Usage : preparer-version.sh --verifier ÉTIQUETTE NOTE" "Usage: preparer-version.sh --verifier TAG NOTES")"
  else [ $# -eq 4 ] || echec "$(msg "Usage : preparer-version.sh ÉTIQUETTE NOTE CLÉ_PRIVÉE SORTIE" "Usage: preparer-version.sh TAG NOTES PRIVATE_KEY OUTPUT")"; fi
  ETIQUETTE="$1"
  NOTE="$2"
  VERSION="$(node -p 'require(process.argv[1]).version' "$RACINE/package.json")"
  etiquette_conforme "$ETIQUETTE" "$VERSION" || echec "$(msg "L'étiquette $ETIQUETTE ne correspond pas à package.json ($VERSION) : rien n'est publié." "Tag $ETIQUETTE does not match package.json ($VERSION): nothing is published.")"
  note_conforme "$NOTE" || echec "$(msg "Note de l'étiquette incomplète : le français, une ligne ---en---, puis l'anglais. Rien n'est publié." "Tag notes incomplete: French, a ---en--- line, then English. Nothing is published.")"
  [ "$VERIFIER" = 1 ] && exit 0
  CLE="$3"
  SORTIE="$4"
  bash "$RACINE/deploy/fabriquer-paquet.sh" --publiee
  mkdir -p "$SORTIE"
  cp "$RACINE/paquets/lama-$VERSION.tar.gz" "$SORTIE/"
  cp "$NOTE" "$SORTIE/NOTES.md"
  signer_version "$SORTIE" "lama-$VERSION.tar.gz" "$CLE"
  PUBLIQUE="$(cle_de_verification "$RACINE")"
  verifier_signature "$SORTIE" "$PUBLIQUE" || echec "$(msg "La clé de signature ne correspond pas à ${PUBLIQUE#"$RACINE"/} : rien n'est publié." "The signing key does not match ${PUBLIQUE#"$RACINE"/}: nothing is published.")"
  verifier_empreintes "$SORTIE" "lama-$VERSION.tar.gz" || echec "$(msg "SHA256SUMS ne correspond pas aux fichiers : rien n'est publié." "SHA256SUMS does not match the files: nothing is published.")"
  echo "$(msg "Version $VERSION prête dans $SORTIE." "Version $VERSION ready in $SORTIE.")"
fi
