#!/usr/bin/env bash
# Pose de la mise à jour par le réseau (spec du 21/10/2026, M-11), par installer.sh et
# mettre-a-jour.sh, les unités étant déjà copiées dans /etc/systemd/system : dossier d'échange
# créé par le compte du service lui-même (un lien qu'il y aurait posé n'est jamais suivi par
# root), cache de root en 0700, surveillance du fichier de demande et minuterie de nuit en
# marche. Fonction essayée seule (src/server/deploy-reseau.test.ts).
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/langue.sh"

poser_mise_a_jour_reseau() {
  local DATA_ARG="$1" COMPTE_ARG="$2" CACHE_ARG="$3"
  ( cd / && runuser -u "$COMPTE_ARG" -- install -d -m 0700 "$DATA_ARG/mise-a-jour" ) || return 1
  install -d -m 0700 -o root -g root "$CACHE_ARG" || return 1
  systemctl enable --now lama-mise-a-jour.path lama-mise-a-jour.timer || return 1
  echo "$(msg "Mise à jour depuis l'application posée (Réglages, Mise à jour)." "Updates from the application are set up (Settings, Updates).")"
}
