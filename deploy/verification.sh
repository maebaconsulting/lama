#!/usr/bin/env bash
# Versions et signature des archives de lama (spec du 21/10/2026, M-1, M-4 à M-6) : forme et
# ordre des versions, signature Ed25519 de SHA256SUMS (openssl pkeyutl -rawin), empreintes,
# dossier extrait conforme à l'archive signée. Chargé par « source » depuis installer.sh,
# mettre-a-jour.sh, mise-a-jour-reseau.sh, fabriquer-paquet.sh et l'outil de publication ;
# chaque fonction est essayée seule (src/server/deploy-verification.test.ts).
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/langue.sh"

# openssl 3 (pkeyutl -rawin, Ed25519) ; LAMA_OPENSSL en désigne un autre (essais sur un Mac,
# dont l'openssl du système est LibreSSL).
OPENSSL="${LAMA_OPENSSL:-openssl}"

# Version publiée : X.Y.Z, nombres sans zéro de tête, quatre chiffres au plus. Même règle
# que VERSION_PUBLIEE (src/server/mise-a-jour/version.ts).
version_publiee() {
  local MOTIF='^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$'
  [[ "${1:-}" =~ $MOTIF ]]
}

# Paquet de développement (pnpm paquet) : AAAAMMJJ-HHMM-empreinte du commit.
version_developpement() {
  local MOTIF='^[0-9]{8}-[0-9]{4}-[0-9a-f]+$'
  [[ "${1:-}" =~ $MOTIF ]]
}

# L'une ou l'autre forme : seules acceptées dans le fichier VERSION d'une archive.
version_valide() {
  version_publiee "${1:-}" || version_developpement "${1:-}"
}

# Vrai si A est strictement plus récente que B, toutes deux publiées, comparées nombre par
# nombre (1.10.0 après 1.9.3). Une version de développement n'est jamais plus récente qu'une
# autre, ni l'inverse : la comparaison est refusée.
plus_recente() {
  local A="${1:-}" B="${2:-}" A1 A2 A3 B1 B2 B3
  version_publiee "$A" && version_publiee "$B" || return 1
  IFS=. read -r A1 A2 A3 <<<"$A"
  IFS=. read -r B1 B2 B3 <<<"$B"
  if [ "$A1" -ne "$B1" ]; then [ "$A1" -gt "$B1" ]; return; fi
  if [ "$A2" -ne "$B2" ]; then [ "$A2" -gt "$B2" ]; return; fi
  [ "$A3" -gt "$B3" ]
}

# Vrai si SHA256SUMS.sig, dans DOSSIER, est la signature Ed25519 de SHA256SUMS par la clé
# publique CLE (PEM). Un fichier absent, ou un lien, fait refuser.
verifier_signature() {
  local DOSSIER="$1" CLE="$2" FICHIER
  for FICHIER in "$CLE" "$DOSSIER/SHA256SUMS" "$DOSSIER/SHA256SUMS.sig"; do
    [ -f "$FICHIER" ] && [ ! -L "$FICHIER" ] || return 1
  done
  "$OPENSSL" pkeyutl -verify -rawin -pubin -inkey "$CLE" -in "$DOSSIER/SHA256SUMS" -sigfile "$DOSSIER/SHA256SUMS.sig" >/dev/null 2>&1
}

# Vrai si SHA256SUMS (déjà vérifié par sa signature) liste l'archive ARCHIVE (nom seul) et si
# chaque fichier qu'il liste, dans DOSSIER, a l'empreinte annoncée.
verifier_empreintes() {
  local DOSSIER="$1" ARCHIVE="$2"
  awk -v nom="$ARCHIVE" '$2 == nom && length($1) == 64 && $1 ~ /^[0-9a-f]+$/ { trouve = 1 } END { exit !trouve }' "$DOSSIER/SHA256SUMS" || return 1
  ( cd "$DOSSIER" && sha256sum --strict --quiet -c SHA256SUMS ) >/dev/null 2>&1
}

# Vrai si le dossier SOURCE est identique au dossier NOM de l'archive ARCHIVE : l'archive est
# extraite à part, puis comparée fichier par fichier (un fichier ajouté, retiré ou modifié
# dans le dossier extrait suffit à refuser, comme tout lien symbolique).
arbre_conforme() {
  local ARCHIVE="$1" NOM="$2" SOURCE="$3" TEMP RESULTAT=0
  TEMP="$(mktemp -d)"
  if [ -n "$(find "$SOURCE" -type l 2>/dev/null)" ]; then
    RESULTAT=1
  elif tar --no-same-owner -xzf "$ARCHIVE" -C "$TEMP" 2>/dev/null && [ -d "$TEMP/$NOM" ]; then
    diff -r "$TEMP/$NOM" "$SOURCE" >/dev/null 2>&1 || RESULTAT=1
  else
    RESULTAT=1
  fi
  rm -rf "$TEMP"
  return "$RESULTAT"
}

# Phrase d'un refus de vérification, dans la langue des scripts.
motif_refus() {
  case "${1:-}" in
    signature) msg "Signature refusée : l'archive n'a pas été signée par la clé de la version en service." "Signature refused: the archive was not signed with the key of the running version." ;;
    empreinte) msg "Empreinte refusée : l'archive ou sa note ne correspond pas à SHA256SUMS." "Checksum refused: the archive or its notes do not match SHA256SUMS." ;;
    arbre) msg "Le dossier extrait ne correspond pas à l'archive signée : extrayez-la de nouveau, puis relancez." "The extracted folder does not match the signed archive: extract it again, then run again." ;;
    *) msg "Vérification refusée." "Check refused." ;;
  esac
}
