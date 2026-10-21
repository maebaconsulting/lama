#!/usr/bin/env bash
# Mise à jour de lama par le réseau (spec du 21/10/2026, M-7 à M-11), lancée en root par
# lama-mise-a-jour.service : sur une demande de l'application (fichier demande.json, surveillé
# par lama-mise-a-jour.path) ou chaque nuit à 3 h 30 en mode automatique (lama-mise-a-jour.timer).
# Seul ce script télécharge, vérifie et installe ; le service lama ne fait que demander.
# Tout ce qui vient du dossier d'échange (écrit par le compte lama) est traité comme hostile :
# lu sous le compte du service, fichiers ordinaires seulement, taille plafonnée.
# Exécuté depuis la version en service (/opt/lama/actuelle) : c'est sa clé publique qui vérifie.
# Journal : journalctl -u lama-mise-a-jour, sans secret.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/langue.sh"
# Versions et signature (version_publiee, plus_recente, verifier_signature, verifier_empreintes).
source "$(dirname "${BASH_SOURCE[0]}")/verification.sh"

# Racine des chemins : vide en service ; un dossier d'essai seulement pour les essais
# automatisés (src/server/deploy-reseau.test.ts), jamais posée par systemd.
RACINE="${LAMA_ESSAI_RACINE:-}"
APP="$RACINE/opt/lama"
ECHANGE="$RACINE/var/lib/lama/mise-a-jour"
CACHE="$RACINE/var/cache/lama-mise-a-jour"
CONF_RESEAU="$RACINE/etc/lama/mise-a-jour.conf"
VERROU="$RACINE/run/lama-mise-a-jour.verrou"
COMPTE=lama
DEPOT_DEFAUT=maebaconsulting/lama
TAILLE_MAX_ARCHIVE=$((200 * 1024 * 1024))
# SHA256SUMS, sa signature et la note.
TAILLE_MAX_PETIT=$((1024 * 1024))
TAILLE_MAX_DEMANDE=1024
# Pause entre deux essais de téléchargement (secondes, multipliée par le rang de l'essai).
PAUSE_ESSAIS="${LAMA_ESSAI_PAUSE:-5}"
# Attente du verrou tenu par une autre opération (secondes).
ATTENTE_VERROU="${LAMA_ESSAI_ATTENTE_VERROU:-3600}"
# Délai maximal de lecture d'un fichier du dossier d'échange (secondes).
DELAI_LECTURE="${LAMA_ESSAI_DELAI_LECTURE:-10}"

# Lance une commande sous le compte du service, depuis un dossier qu'il peut lire (comme
# mettre-a-jour.sh) : un lien posé dans le dossier d'échange n'atteint que ce qu'il atteint déjà.
comme_service() { ( cd / && runuser -u "$COMPTE" -- "$@" ); }

# Contenu d'un fichier du dossier d'échange, lu sous le compte du service, s'il est un fichier
# ordinaire (jamais un lien) d'au plus MAX octets ; sinon rien et retour 1.
lire_petit_fichier() {
  local FICHIER="$1" MAX="$2" CONTENU TAILLE
  [ -f "$FICHIER" ] && [ ! -L "$FICHIER" ] || return 1
  # timeout : un tube posé par lama après le contrôle ci-dessus ne doit pas bloquer le service
  # (qui tient le verrou) ; la lecture est abandonnée.
  CONTENU="$(comme_service timeout "$DELAI_LECTURE" head -c "$((MAX + 1))" "$FICHIER")" || return 1
  TAILLE="$(printf '%s' "$CONTENU" | LC_ALL=C wc -c | tr -d ' ')"
  [ "$TAILLE" -le "$MAX" ] || return 1
  printf '%s' "$CONTENU"
}

# Version demandée par l'application : demande.json doit être exactement {"version":"X.Y.Z"}
# (espaces permis), rien d'autre ; sinon retour 1.
lire_demande() {
  local CONTENU MOTIF='^[[:space:]]*[{][[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]*)"[[:space:]]*[}][[:space:]]*$' LUE
  CONTENU="$(lire_petit_fichier "$1" "$TAILLE_MAX_DEMANDE")" || return 1
  [[ "$CONTENU" =~ $MOTIF ]] || return 1
  LUE="${BASH_REMATCH[1]}"
  version_publiee "$LUE" || return 1
  printf '%s' "$LUE"
}

# Mode réglé par l'administrateur : « automatique » seulement si le fichier le dit exactement ;
# absent, illisible, lien ou autre contenu : « manuel ».
lire_mode() {
  local CONTENU
  CONTENU="$(lire_petit_fichier "$1" 64 2>/dev/null)" || { printf 'manuel'; return 0; }
  if [ "$CONTENU" = automatique ]; then printf 'automatique'; else printf 'manuel'; fi
}

# Dépôt GitHub des versions : maebaconsulting/lama, sauf une ligne DEPOT=propriétaire/nom dans
# le fichier de root FICHIER (/etc/lama/mise-a-jour.conf, recette seulement, absent par défaut).
depot_des_versions() {
  local FICHIER="$1" LIGNE=""
  if [ -f "$FICHIER" ] && [ ! -L "$FICHIER" ]; then
    LIGNE="$(grep -E '^DEPOT=[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' "$FICHIER" | head -n 1 || true)"
  fi
  if [ -n "$LIGNE" ]; then printf '%s' "${LIGNE#DEPOT=}"; else printf '%s' "$DEPOT_DEFAUT"; fi
}

# Dossier de téléchargement d'une version : adresse fixe de GitHub, jamais lue dans la demande.
url_versions() { printf 'https://github.com/%s/releases/download/v%s/' "$1" "$2"; }

# Phrase du journal du service pour un motif d'échec (M-17 ; l'écran a les siennes).
dire_motif() {
  case "${1:-}" in
    demande_invalide) msg "Demande illisible (fichier absent, lien, trop gros ou autre contenu que la version)." "Unreadable request (missing file, link, too large, or content other than the version)." ;;
    version_non_recente) msg "La version demandée n'est pas plus récente que la version en service." "The requested version is not newer than the running version." ;;
    telechargement) msg "Téléchargement impossible après trois essais." "Download failed after three attempts." ;;
    signature) msg "Signature refusée par la clé de la version en service." "Signature refused by the key of the running version." ;;
    empreinte) msg "Empreinte refusée : l'archive téléchargée ne correspond pas à SHA256SUMS." "Checksum refused: the downloaded archive does not match SHA256SUMS." ;;
    version_incoherente) msg "L'archive ne contient pas la version demandée." "The archive does not contain the requested version." ;;
    sauvegarde) msg "La sauvegarde d'avant la mise à jour a échoué, rien n'a été changé." "The backup before the update failed, nothing was changed." ;;
    demarrage) msg "La nouvelle version n'a pas démarré, retour à la version précédente fait." "The new version did not start, the previous version is back." ;;
    *) msg "L'installation a échoué, voir les lignes de mettre-a-jour.sh plus haut." "The installation failed, see the mettre-a-jour.sh lines above." ;;
  esac
}

# Instant en millisecondes (seconde près), comme les dates de lama.
maintenant_ms() { printf '%s000' "$(date +%s)"; }

# Valeur JSON d'un texte déjà validé : null s'il est vide.
json_texte() { if [ -z "${1:-}" ]; then printf 'null'; else printf '"%s"' "$1"; fi; }

# Écrit etat.json dans DOSSIER, sous le compte du service, par un fichier temporaire renommé
# ensuite (lama ne lit jamais un état à moitié écrit). Chaque valeur est contrôlée ici ; une
# valeur hors format n'est jamais écrite (retour 1). RESULTAT, MOTIF, FIN, CIBLE et PRECEDENTE
# vides donnent null.
ecrire_etat() {
  local DOSSIER="$1" OPERATION="$2" CIBLE="$3" ETAPE="$4" RESULTAT="$5" MOTIF="$6" DEBUT="$7" FIN="$8" PRECEDENTE="$9" JSON
  [[ "$OPERATION" =~ ^[0-9]+-[0-9]+$ ]] || return 1
  [[ "$DEBUT" =~ ^[0-9]+$ ]] || return 1
  [ -z "$FIN" ] || [[ "$FIN" =~ ^[0-9]+$ ]] || return 1
  [ -z "$CIBLE" ] || version_valide "$CIBLE" || return 1
  [ -z "$PRECEDENTE" ] || version_valide "$PRECEDENTE" || return 1
  case "$ETAPE" in telechargement|verification|sauvegarde|installation|controle|termine) ;; *) return 1 ;; esac
  case "$RESULTAT" in ""|reussie|echec) ;; *) return 1 ;; esac
  case "$MOTIF" in ""|demande_invalide|version_non_recente|telechargement|signature|empreinte|version_incoherente|sauvegarde|installation|demarrage) ;; *) return 1 ;; esac
  JSON="$(printf '{"operation":"%s","version_cible":%s,"etape":"%s","resultat":%s,"motif":%s,"debut":%s,"fin":%s,"version_precedente":%s}' \
    "$OPERATION" "$(json_texte "$CIBLE")" "$ETAPE" "$(json_texte "$RESULTAT")" "$(json_texte "$MOTIF")" "$DEBUT" "${FIN:-null}" "$(json_texte "$PRECEDENTE")")"
  printf '%s\n' "$JSON" | comme_service timeout "$DELAI_LECTURE" sh -c 'cat > "$1.tmp" && mv -f "$1.tmp" "$1"' etat "$DOSSIER/etat.json"
}

# Lit la sortie de mettre-a-jour.sh : chaque ligne « @etape sauvegarde|installation|controle »
# appelle FONCTION avec l'étape (mise à jour de etat.json) ; les autres lignes passent telles
# quelles au journal du service.
suivre_etapes() {
  local FONCTION="$1" LIGNE
  while IFS= read -r LIGNE || [ -n "$LIGNE" ]; do
    case "$LIGNE" in
      "@etape sauvegarde"|"@etape installation"|"@etape controle") "$FONCTION" "${LIGNE#@etape }" ;;
      *) printf '%s\n' "$LIGNE" ;;
    esac
  done
}

# Motif d'un échec de mettre-a-jour.sh d'après son code de sortie (voir ses SORTIE_…).
motif_de_sortie() {
  case "${1:-}" in
    3) printf 'sauvegarde' ;;
    4) printf 'demarrage' ;;
    5) printf 'signature' ;;
    *) printf 'installation' ;;
  esac
}

# Dernière version publiée du dépôt DEPOT, lue dans la redirection de /releases/latest
# (…/releases/tag/vX.Y.Z), sans compte ni JSON ; rien et retour 1 sinon.
derniere_version() {
  local DEPOT="$1" ADRESSE LUE
  ADRESSE="$(curl --fail --silent --show-error --location --proto =https --proto-redir =https --tlsv1.2 --max-time 30 \
    --output /dev/null --write-out '%{url_effective}' "https://github.com/$DEPOT/releases/latest")" || return 1
  LUE="${ADRESSE##*/releases/tag/v}"
  [ "$LUE" != "$ADRESSE" ] && version_publiee "$LUE" || return 1
  printf '%s' "$LUE"
}

# Télécharge NOM depuis le dossier ADRESSE dans DOSSIER : https seulement (redirections
# comprises), reprise d'un essai à l'autre, trois essais, au plus MAX octets (au-delà, le
# fichier est retiré).
telecharger() {
  local ADRESSE="$1" NOM="$2" DOSSIER="$3" MAX="$4" ESSAI TAILLE
  for ESSAI in 1 2 3; do
    if curl --fail --silent --show-error --location --proto =https --proto-redir =https --tlsv1.2 \
      --max-filesize "$MAX" --connect-timeout 20 --max-time 1800 --continue-at - \
      --output "$DOSSIER/$NOM" "$ADRESSE$NOM"; then
      TAILLE="$(LC_ALL=C wc -c < "$DOSSIER/$NOM" | tr -d ' ')"
      [ "$TAILLE" -le "$MAX" ] && return 0
      rm -f "$DOSSIER/$NOM"
      return 1
    fi
    [ "$ESSAI" -lt 3 ] && sleep $((ESSAI * PAUSE_ESSAIS))
  done
  return 1
}

# Contrôle, dans DOSSIER, la version VERSION téléchargée : signature de SHA256SUMS par la clé
# en service CLE (jamais celle de l'archive), empreintes, extraction, puis VERSION de l'archive
# égale à la version demandée. Sur un refus : motif (signature, empreinte, version_incoherente)
# sur la sortie et retour 1.
controler_archive() {
  local DOSSIER="$1" VERSION_ARG="$2" CLE="$3" LUE=""
  verifier_signature "$DOSSIER" "$CLE" || { printf 'signature'; return 1; }
  verifier_empreintes "$DOSSIER" "lama-$VERSION_ARG.tar.gz" || { printf 'empreinte'; return 1; }
  tar --no-same-owner -xzf "$DOSSIER/lama-$VERSION_ARG.tar.gz" -C "$DOSSIER" 2>/dev/null || { printf 'empreinte'; return 1; }
  if [ -f "$DOSSIER/lama-$VERSION_ARG/VERSION" ]; then LUE="$(head -c 64 "$DOSSIER/lama-$VERSION_ARG/VERSION" | tr -d '\n')"; fi
  [ "$LUE" = "$VERSION_ARG" ] || { printf 'version_incoherente'; return 1; }
}

# La suite ne s'exécute que si le script est lancé directement (systemd), jamais quand il est
# chargé par « source » (essais des fonctions). Tout le bloc est lu avant d'être exécuté : le
# lien /opt/lama/actuelle peut changer pendant la mise à jour sans toucher au script en cours.
if [ "${BASH_SOURCE:-$0}" = "$0" ]; then

  [ -n "$RACINE" ] || [ "$(id -u)" -eq 0 ] || { echo "$(msg "Ce service tourne en root, lancé par systemd." "This service runs as root, started by systemd.")" >&2; exit 1; }

  # Demande et cache effacés quoi qu'il arrive : une demande laissée relancerait le service
  # sans fin (lama-mise-a-jour.path). CIBLE est connue plus bas.
  # Opération commencée (premier état écrit) mais jamais terminée : service arrêté (SIGTERM de
  # systemd) ou erreur imprévue. Son état final est écrit ici, sinon lama la croirait en cours
  # pour toujours. Rien n'est écrit si aucune opération n'a commencé.
  CIBLE=""
  COMMENCEE=0
  FINIE=0
  nettoyer() {
    if [ "$COMMENCEE" = 1 ] && [ "$FINIE" = 0 ]; then
      ecrire_etat "$ECHANGE" "$OPERATION" "$CIBLE" termine echec installation "$DEBUT" "$(maintenant_ms)" "$EN_SERVICE" 2>/dev/null || true
    fi
    comme_service rm -rf -- "$ECHANGE/demande.json" 2>/dev/null || true
    if [ -n "$CIBLE" ]; then rm -rf "$CACHE/$CIBLE"; fi
  }
  trap nettoyer EXIT

  # Une seule opération à la fois (M-9), avec mettre-a-jour.sh lancé à la main.
  # Fichier en 0600 (créé sous umask 077, remis en 0600 s'il existait) : un compte lama
  # compromis ne peut pas l'ouvrir pour tenir le verrou à la place de root.
  ( umask 077 && : >> "$VERROU" )
  chmod 0600 "$VERROU"
  exec 9>"$VERROU"
  if ! flock -w "$ATTENTE_VERROU" 9; then
    echo "$(msg "Une autre mise à jour est en cours depuis trop longtemps : cette demande est abandonnée." "Another update has been running for too long: this request is dropped.")"
    exit 0
  fi

  OPERATION="$(date +%s)-$$"
  DEBUT="$(maintenant_ms)"
  EN_SERVICE=""
  if [ -f "$APP/actuelle/VERSION" ]; then EN_SERVICE="$(head -c 64 "$APP/actuelle/VERSION" | tr -d '\n')"; fi
  version_valide "$EN_SERVICE" || EN_SERVICE=""
  CLE="$APP/actuelle/deploy/cle-publique.pem"
  DEPOT="$(depot_des_versions "$CONF_RESEAU")"

  etat() { COMMENCEE=1; ecrire_etat "$ECHANGE" "$OPERATION" "$CIBLE" "$1" "" "" "$DEBUT" "" "$EN_SERVICE"; }
  # État final, phrase au journal, puis sortie (0 réussie, 1 échec).
  terminer() {
    local RESULTAT="$1" MOTIF="${2:-}" MOTIF_TEXTE
    # Avant l'écriture : un état final jamais remplacé par « echec installation » au nettoyage.
    FINIE=1
    ecrire_etat "$ECHANGE" "$OPERATION" "$CIBLE" termine "$RESULTAT" "$MOTIF" "$DEBUT" "$(maintenant_ms)" "$EN_SERVICE" || true
    if [ "$RESULTAT" = reussie ]; then
      echo "$(msg "lama est à jour, version $CIBLE." "lama is up to date, version $CIBLE.")"
      exit 0
    fi
    MOTIF_TEXTE="$(dire_motif "$MOTIF")"
    echo "$(msg "Mise à jour en échec ($MOTIF) : $MOTIF_TEXTE" "Update failed ($MOTIF): $MOTIF_TEXTE")" >&2
    exit 1
  }

  if [ -e "$ECHANGE/demande.json" ] || [ -L "$ECHANGE/demande.json" ]; then
    # Demande de l'application (lama-mise-a-jour.path).
    CIBLE="$(lire_demande "$ECHANGE/demande.json")" || { CIBLE=""; terminer echec demande_invalide; }
  else
    # Nuit (lama-mise-a-jour.timer) : seulement en mode automatique, et s'il y a plus récent.
    if [ "$(lire_mode "$ECHANGE/mode")" != automatique ]; then
      echo "$(msg "Mode manuel : rien à faire cette nuit." "Manual mode: nothing to do tonight.")"
      exit 0
    fi
    CIBLE="$(derniere_version "$DEPOT")" || { CIBLE=""; echo "$(msg "Serveur des versions injoignable : nouvel essai la nuit prochaine." "Version server unreachable: next attempt tomorrow night.")"; exit 0; }
    if ! plus_recente "$CIBLE" "$EN_SERVICE"; then
      echo "$(msg "lama est déjà à la dernière version." "lama is already on the latest version.")"
      CIBLE=""
      exit 0
    fi
  fi
  plus_recente "$CIBLE" "$EN_SERVICE" || terminer echec version_non_recente
  echo "$(msg "Mise à jour de $EN_SERVICE vers $CIBLE (dépôt $DEPOT)." "Update from $EN_SERVICE to $CIBLE (repository $DEPOT).")"

  etat telechargement
  rm -rf "$CACHE/$CIBLE"
  install -d -m 0700 "$CACHE" "$CACHE/$CIBLE"
  ADRESSE="$(url_versions "$DEPOT" "$CIBLE")"
  for NOM in SHA256SUMS SHA256SUMS.sig NOTES.md; do
    telecharger "$ADRESSE" "$NOM" "$CACHE/$CIBLE" "$TAILLE_MAX_PETIT" || terminer echec telechargement
  done
  telecharger "$ADRESSE" "lama-$CIBLE.tar.gz" "$CACHE/$CIBLE" "$TAILLE_MAX_ARCHIVE" || terminer echec telechargement

  etat verification
  MOTIF="$(controler_archive "$CACHE/$CIBLE" "$CIBLE" "$CLE")" || terminer echec "$MOTIF"

  # mettre-a-jour.sh de la version téléchargée (déjà vérifiée) : sauvegarde, installation,
  # redémarrage, contrôle, retour arrière. Ses lignes « @etape » tiennent etat.json à jour.
  etat sauvegarde
  set +e
  ( cd "$CACHE/$CIBLE/lama-$CIBLE" && LAMA_MARQUES_ETAPES=1 LAMA_VERROU_TENU=1 ./deploy/mettre-a-jour.sh 2>&1 ) | suivre_etapes etat
  CODE="${PIPESTATUS[0]}"
  set -e
  [ "$CODE" -eq 0 ] || terminer echec "$(motif_de_sortie "$CODE")"
  terminer reussie

fi
