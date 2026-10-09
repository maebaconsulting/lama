#!/usr/bin/env bash
# Langue des scripts d'installation (spec du sous-projet 3, § 8.1) : anglais si
# LANG commence par « en », français sinon ; LAMA_LANGUE=fr ou LAMA_LANGUE=en la
# force (toute autre valeur est ignorée). sudo garde LANG sur Ubuntu.
# Chaque message est écrit dans les deux langues au même endroit : msg "texte" "text".
# Chargé par « source » en tête de chaque script de deploy/.
set -euo pipefail

langue_des_scripts() {
  case "${LAMA_LANGUE:-}" in
    fr|en) printf '%s' "$LAMA_LANGUE"; return 0 ;;
  esac
  case "${LANG:-}" in
    en*) printf 'en' ;;
    *) printf 'fr' ;;
  esac
}

LANGUE="$(langue_des_scripts)"

# Texte dans la langue des scripts.
msg() {
  if [ "$LANGUE" = "en" ]; then printf '%s' "$2"; else printf '%s' "$1"; fi
}

# Mots à taper pour confirmer, dans la langue des scripts.
MOT_OUI="$(msg "OUI" "YES")"
MOT_EFFACER="$(msg "EFFACER" "ERASE")"
