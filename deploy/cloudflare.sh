#!/usr/bin/env bash
# Mise en service du relais de réservation en ligne sur Cloudflare (Workers, D1, Static Assets, Cron Triggers),
# pour tout éditeur qui exploite un relais. Rien n'est écrit en dur : compte, Worker et base viennent des options
# ou des variables. Notice : relais/LISEZMOI.md, « Mise en service sur Cloudflare ».
#
#   deploy/cloudflare.sh [--a-blanc] [--secrets] [--sans-controle-dns] --compte <id> --worker <nom> --base <nom> --domaine <hôte>
#                        [--zone <zone>] [--demandes-par-heure <n>] [--cle-site-turnstile <clé>] [--region <code>]
#
# --sans-controle-dns : si le jeton ne peut pas lire le DNS, avertit au lieu de s'arrêter (le conflit DNS d'un DNS lisible
# et le rattachement à un autre Worker arrêtent toujours).
# Variables équivalentes : CLOUDFLARE_ACCOUNT_ID, RELAIS_WORKER, RELAIS_BASE_D1, RELAIS_DOMAINE, RELAIS_ZONE
# (le domaine sans son premier mot), RELAIS_DEMANDES_PAR_HEURE (30), TURNSTILE_CLE_SITE, RELAIS_D1_REGION (weur).
# Le domaine personnalisé (Custom Domain du Worker, dans une zone du compte) est le cas principal ; sans --domaine,
# le relais répond sur le sous-domaine workers.dev du compte.
# Avec CLOUDFLARE_API_TOKEN (jeton d'API, jamais passé en argument), les droits du jeton sont vérifiés en lecture avant
# d'agir ; sans lui, la connexion de wrangler login.
# Les secrets du Worker ne passent jamais par ce script : wrangler secret put les demande à l'invite.
# Essayé avec un wrangler simulé (src/server/deploy-cloudflare.test.ts) : RELAIS_WRANGLER remplace la commande
# wrangler, RELAIS_CONFIG_DEPLOIEMENT le fichier produit, et un curl simulé est placé en tête du PATH.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/langue.sh"

WRANGLER_VERSION=4.142.0
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTIL="$RACINE/relais/outils/config-wrangler.ts"
CONFIG="${RELAIS_CONFIG_DEPLOIEMENT:-$RACINE/relais/wrangler.deploiement.toml}"
SECRETS=(RELAIS_CLE_MAITRE RELAIS_ADMIN_MOT_DE_PASSE TURNSTILE_SECRET)
ID_FICTIF=00000000-0000-0000-0000-000000000000

echec() { printf '%s\n' "$1" >&2; exit 1; }
etape() { printf '\n== %s\n' "$1"; }

usage() {
  echo "$(msg "Usage : deploy/cloudflare.sh [--a-blanc] [--secrets] [--sans-controle-dns] --compte ID --worker NOM --base NOM --domaine HOTE [--zone ZONE] [--demandes-par-heure N] [--cle-site-turnstile CLE] [--region CODE]" "Usage: deploy/cloudflare.sh [--a-blanc] [--secrets] [--sans-controle-dns] --compte ID --worker NOM --base NOM --domaine HOTE [--zone ZONE] [--demandes-par-heure N] [--cle-site-turnstile CLE] [--region CODE]")"
  echo "$(msg "--a-blanc affiche les commandes sans rien exécuter ni écrire. --secrets pose les secrets manquants, saisis à l'invite. --sans-controle-dns saute le contrôle du DNS quand le jeton ne peut pas le lire." "--a-blanc shows the commands without running or writing anything. --secrets sets the missing secrets, typed at the prompt. --sans-controle-dns skips the DNS check when the token cannot read the DNS.")"
}

A_BLANC=0
POSER_SECRETS=0
SANS_CONTROLE_DNS=0
COMPTE="${CLOUDFLARE_ACCOUNT_ID:-}"
WORKER="${RELAIS_WORKER:-}"
BASE="${RELAIS_BASE_D1:-}"
DOMAINE="${RELAIS_DOMAINE:-}"
DEMANDES="${RELAIS_DEMANDES_PAR_HEURE:-30}"
CLE_SITE="${TURNSTILE_CLE_SITE:-}"
ZONE="${RELAIS_ZONE:-}"
REGION="${RELAIS_D1_REGION:-weur}"

while [ $# -gt 0 ]; do
  case "$1" in
    --a-blanc) A_BLANC=1 ;;
    --secrets) POSER_SECRETS=1 ;;
    --sans-controle-dns) SANS_CONTROLE_DNS=1 ;;
    -h|--help) usage; exit 0 ;;
    --compte|--worker|--base|--domaine|--zone|--demandes-par-heure|--cle-site-turnstile|--region)
      [ $# -ge 2 ] || echec "$(msg "Valeur manquante après $1." "Missing value after $1.")"
      case "$1" in
        --compte) COMPTE="$2" ;;
        --worker) WORKER="$2" ;;
        --base) BASE="$2" ;;
        --domaine) DOMAINE="$2" ;;
        --zone) ZONE="$2" ;;
        --demandes-par-heure) DEMANDES="$2" ;;
        --cle-site-turnstile) CLE_SITE="$2" ;;
        --region) REGION="$2" ;;
      esac
      shift ;;
    *) usage >&2; echec "$(msg "Option inconnue : $1" "Unknown option: $1")" ;;
  esac
  shift
done

# Les secrets se saisissent à l'invite : refus dès le début, pas après le déploiement.
if [ "$POSER_SECRETS" = 1 ] && [ "$A_BLANC" = 0 ] && [ ! -t 0 ]; then
  echec "$(msg "--secrets demande un terminal (la valeur est saisie à l'invite)." "--secrets needs a terminal (the value is typed at the prompt).")"
fi

if [ -z "$COMPTE" ] || [ -z "$WORKER" ] || [ -z "$BASE" ]; then
  usage >&2
  echec "$(msg "Identifiant du compte, nom du Worker et nom de la base obligatoires (--compte, --worker, --base)." "Account ID, Worker name and database name are required (--compte, --worker, --base).")"
fi
# Indication de région de D1 (weur, enam, apac…) : wrangler refuse une région qu'il ne connaît pas.
[[ "$REGION" =~ ^[a-z]{2,8}$ ]] || echec "$(msg "Région D1 mal formée : $REGION (par exemple weur)." "Malformed D1 region: $REGION (for example weur).")"
if [ -n "$DOMAINE" ]; then
  [ -n "$ZONE" ] || ZONE="${DOMAINE#*.}"
  case "$DOMAINE" in
    "$ZONE"|*."$ZONE") ;;
    *) echec "$(msg "Le domaine $DOMAINE n'est pas dans la zone $ZONE." "Domain $DOMAINE is not in zone $ZONE.")" ;;
  esac
  [[ "$ZONE" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || echec "$(msg "Zone mal formée : $ZONE." "Malformed zone: $ZONE.")"
fi
[ -f "$RACINE/relais/worker.ts" ] && [ -f "$OUTIL" ] || echec "$(msg "Lancer ce script depuis un dépôt de lama complet (relais/ introuvable)." "Run this script from a complete lama repository (relais/ not found).")"
command -v node > /dev/null || echec "$(msg "Node est requis." "Node is required.")"

# wrangler à la version figée ; RELAIS_WRANGLER le remplace (essais).
wr() {
  if [ -n "${RELAIS_WRANGLER:-}" ]; then "$RELAIS_WRANGLER" "$@"; else npx --yes "wrangler@$WRANGLER_VERSION" "$@"; fi
}

# Affiche la commande, puis l'exécute, sauf à blanc.
faire() {
  local affichee
  if [ "$1" = wr ]; then affichee="npx wrangler@$WRANGLER_VERSION $(printf '%q ' "${@:2}")"; else affichee="$(printf '%q ' "$@")"; fi
  printf '+ %s\n' "${affichee% }"
  [ "$A_BLANC" = 1 ] || "$@"
}

# Lecture de l'API de Cloudflare avec le jeton de l'environnement, passé à curl par l'entrée standard (jamais en argument).
api() {
  printf 'header = "Authorization: Bearer %s"\n' "$CLOUDFLARE_API_TOKEN" | curl -sS --max-time 20 --config - "https://api.cloudflare.com/client/v4$1"
}

# Droits du jeton, vérifiés en lecture avant d'agir ; l'écriture ne se vérifie qu'en agissant, d'où la liste des droits.
verifier_jeton() {
  local ZONE_ID DNS DNS_LU EXISTANT RATTACHE SERVICE SOUS
  api "/accounts/$COMPTE/d1/database?per_page=1" | outil succes \
    || echec "$(msg "Jeton refusé pour le compte $COMPTE. Droits du compte nécessaires : Workers Scripts et D1, en modification." "Token refused for account $COMPTE. Account permissions needed: Workers Scripts and D1, edit.")"
  # Le cron de purge exige un sous-domaine workers.dev, même avec workers_dev = false (Cloudflare, code 10063) : arrêt avant toute écriture.
  SOUS="$(api "/accounts/$COMPTE/workers/subdomain" | outil sous-domaine)"
  [ "$SOUS" != absent ] || echec "$(msg "Le compte $COMPTE n'a pas de sous-domaine workers.dev, que la purge quotidienne exige : rien n'a été fait. Le créer en ouvrant une fois la page Workers & Pages du tableau de bord, ou par PUT /accounts/$COMPTE/workers/subdomain avec {\"subdomain\":\"<nom>\"}." "Account $COMPTE has no workers.dev subdomain, which the daily purge requires: nothing was done. Create it by opening the Workers & Pages page of the dashboard once, or with PUT /accounts/$COMPTE/workers/subdomain and {\"subdomain\":\"<name>\"}.")"
  [ -n "$DOMAINE" ] || return 0
  # Zone pas encore active : l'outil nomme l'état sur la sortie d'erreur, l'arrêt est ici (avant toute action).
  ZONE_ID="$(api "/zones?name=$ZONE&account.id=$COMPTE" | outil zone "$ZONE")" || exit 1
  [ -n "$ZONE_ID" ] || echec "$(msg "Zone $ZONE introuvable avec ce jeton. Il faut la zone dans le compte $COMPTE et le droit Zone en lecture sur elle." "Zone $ZONE not found with this token. The zone must be in account $COMPTE, with Zone read permission on it.")"
  api "/zones/$ZONE_ID/workers/routes" | outil succes \
    || echec "$(msg "Le jeton ne lit pas les routes Workers de $ZONE. Droit nécessaire : Workers Routes, en modification, sur la zone." "The token cannot read the Workers routes of $ZONE. Permission needed: Workers Routes, edit, on the zone.")"
  # Hôte déjà rattaché à un Worker : Cloudflare a créé lui-même son enregistrement DNS. Au même Worker, c'est une relance.
  RATTACHE="$(api "/accounts/$COMPTE/workers/domains?hostname=$DOMAINE")"
  printf '%s' "$RATTACHE" | outil succes \
    || echec "$(msg "Réponse illisible ou refusée pour les domaines des Workers du compte $COMPTE : rien n'a été fait. Droit nécessaire : Workers Scripts, en lecture." "Unreadable or refused answer for the Workers domains of account $COMPTE: nothing was done. Permission needed: Workers Scripts, read.")"
  SERVICE="$(printf '%s' "$RATTACHE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=(JSON.parse(s).result||[]).find((d)=>d.hostname===process.argv[1]);if(r)process.stdout.write(String(r.service))})' "$DOMAINE")"
  if [ -n "$SERVICE" ] && [ "$SERVICE" != "$WORKER" ]; then
    echec "$(msg "Le domaine $DOMAINE est déjà rattaché au Worker $SERVICE : rien n'a été fait. Le détacher dans le tableau de bord, ou choisir un autre domaine." "Domain $DOMAINE is already attached to Worker $SERVICE: nothing was done. Detach it in the dashboard, or choose another domain.")"
  fi
  DNS="$(api "/zones/$ZONE_ID/dns_records?name=$DOMAINE")"
  if printf '%s' "$DNS" | outil succes; then
    DNS_LU=1
  elif [ "$SANS_CONTROLE_DNS" = 1 ]; then
    DNS_LU=0
    echo "$(msg "Contrôle DNS sauté : vérifier soi-même qu'aucun enregistrement n'existe pour $DOMAINE (par exemple dig $DOMAINE)." "DNS check skipped: check yourself that no record exists for $DOMAINE (for example dig $DOMAINE).")" >&2
  else
    echec "$(msg "Le jeton ne lit pas le DNS de $ZONE. Droit nécessaire : DNS, en modification, sur la zone. À défaut, --sans-controle-dns saute ce contrôle (vérifier alors soi-même, par exemple dig $DOMAINE)." "The token cannot read the DNS of $ZONE. Permission needed: DNS, edit, on the zone. Otherwise, --sans-controle-dns skips this check (then check yourself, for example dig $DOMAINE).")"
  fi
  # Un enregistrement déjà là pour cet hôte (même d'un autre usage) : le Custom Domain ne s'y substituerait pas sans que l'exploitant le sache.
  EXISTANT=""
  { [ -n "$SERVICE" ] || [ "$DNS_LU" = 0 ]; } || EXISTANT="$(printf '%s' "$DNS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).result||[];if(r.length)process.stdout.write(r[0].type+" "+r[0].content)})')"
  [ -z "$EXISTANT" ] || echec "$(msg "Un enregistrement DNS existe déjà pour $DOMAINE ($EXISTANT) : rien n'a été fait. Le supprimer dans le tableau de bord, ou choisir un autre domaine." "A DNS record already exists for $DOMAINE ($EXISTANT): nothing was done. Delete it in the dashboard, or choose another domain.")"
  echo "$(msg "Jeton vérifié pour le compte $COMPTE et la zone $ZONE." "Token checked for account $COMPTE and zone $ZONE.")"
}

# Fichier wrangler rempli pour l'identifiant de base donné, sur la sortie standard (réglages refusés : sortie 2).
generer() {
  local args=(config --compte "$COMPTE" --worker "$WORKER" --base "$BASE" --id-base "$1" --demandes-par-heure "$DEMANDES")
  [ -z "$DOMAINE" ] || args+=(--domaine "$DOMAINE")
  [ -z "$CLE_SITE" ] || args+=(--cle-site-turnstile "$CLE_SITE")
  LAMA_LANGUE="$LANGUE" node --experimental-strip-types "$OUTIL" "${args[@]}"
}

outil() { LAMA_LANGUE="$LANGUE" node --experimental-strip-types "$OUTIL" "$@"; }

# Tous les réglages sont contrôlés avant le premier appel à Cloudflare.
generer "$ID_FICTIF" > /dev/null || echec "$(msg "Réglages refusés, rien n'a été fait." "Settings refused, nothing was done.")"
export CLOUDFLARE_ACCOUNT_ID="$COMPTE"

if [ "$A_BLANC" = 1 ]; then
  echo "$(msg "Mode à blanc : les commandes sont affichées, rien n'est exécuté ni écrit." "Dry run: the commands are shown, nothing is run or written.")"
fi

etape "$(msg "Connexion à Cloudflare" "Cloudflare login")"
echo "$(msg "Compte visé : $COMPTE" "Target account: $COMPTE")"
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  if [ "$A_BLANC" = 1 ]; then
    echo "$(msg "Droits du jeton vérifiés en lecture :" "Token permissions checked by reading:")"
    printf '+ GET %s\n' "/accounts/$COMPTE/d1/database" "/accounts/$COMPTE/workers/subdomain"
    [ -z "$DOMAINE" ] || printf '+ GET %s\n' "/zones?name=$ZONE" "/zones/<zone>/workers/routes" "/accounts/$COMPTE/workers/domains?hostname=$DOMAINE" "/zones/<zone>/dns_records?name=$DOMAINE"
  else
    verifier_jeton
  fi
elif [ "$A_BLANC" = 1 ]; then
  faire wr whoami --json
elif ! wr whoami --json > /dev/null 2>&1; then
  echec "$(msg "Pas de connexion à Cloudflare. Poser CLOUDFLARE_API_TOKEN, ou lancer npx wrangler@$WRANGLER_VERSION login avec le compte de l'exploitant, puis relancer." "Not logged in to Cloudflare. Set CLOUDFLARE_API_TOKEN, or run npx wrangler@$WRANGLER_VERSION login with the operator account, then run again.")"
fi

# Un build cassé échoue ici, avant la première écriture chez Cloudflare (base, migrations).
etape "$(msg "Construction de la page" "Page build")"
faire pnpm --dir "$RACINE" build:relais

etape "$(msg "Base D1 $BASE" "D1 database $BASE")"
if [ "$A_BLANC" = 1 ]; then
  faire wr d1 list --json
  echo "$(msg "Si la base manque :" "If the database is missing:")"
  faire wr d1 create "$BASE" --location "$REGION"
  ID="$ID_FICTIF"
else
  ID="$(wr d1 list --json | outil id-base "$BASE")"
  if [ -z "$ID" ]; then
    faire wr d1 create "$BASE" --location "$REGION"
    ID="$(wr d1 list --json | outil id-base "$BASE")"
    [ -n "$ID" ] || echec "$(msg "Base $BASE introuvable après sa création." "Database $BASE not found after its creation.")"
  else
    echo "$(msg "Base déjà créée, gardée : $ID" "Database already created, kept: $ID")"
  fi
fi

etape "$(msg "Fichier de configuration" "Configuration file")"
if [ "$A_BLANC" = 1 ]; then
  echo "$(msg "Contenu de $CONFIG (non écrit) :" "Content of $CONFIG (not written):")"
  generer "$ID"
else
  generer "$ID" > "$CONFIG"
  echo "$(msg "Écrit : $CONFIG" "Written: $CONFIG")"
fi

etape "$(msg "Migrations de la base" "Database migrations")"
faire wr d1 migrations apply "$BASE" --remote --config "$CONFIG"

etape "$(msg "Déploiement du Worker" "Worker deployment")"
faire wr deploy --config "$CONFIG"

etape "$(msg "Secrets" "Secrets")"
POSES=""
if [ "$A_BLANC" = 0 ]; then
  # Liste illisible n'est pas « aucun secret » : sans liste lue, rien n'est reposé (RELAIS_CLE_MAITRE scelle les données).
  LISTE="$(wr secret list --config "$CONFIG")" && POSES="$(printf '%s' "$LISTE" | outil secrets 2> /dev/null)" \
    || echec "$(msg "Liste des secrets illisible : aucun secret n'est reposé. Relancer le script quand Cloudflare répond." "Secret list unreadable: no secret is set again. Run the script again when Cloudflare answers.")"
fi
MANQUANTS=()
for S in "${SECRETS[@]}"; do
  printf '%s\n' "$POSES" | grep -qx "$S" || MANQUANTS+=("$S")
done
if [ "${#MANQUANTS[@]}" -eq 0 ]; then
  echo "$(msg "Les trois secrets sont posés." "The three secrets are set.")"
elif [ "$POSER_SECRETS" = 1 ] && [ "$A_BLANC" = 0 ]; then
  for S in "${MANQUANTS[@]}"; do faire wr secret put "$S" --config "$CONFIG"; done
else
  echo "$(msg "À poser, la valeur saisie à l'invite (jamais en argument ni dans un fichier) :" "To set, the value typed at the prompt (never as an argument or in a file):")"
  for S in "${MANQUANTS[@]}"; do printf '  npx wrangler@%s secret put %s --config %q\n' "$WRANGLER_VERSION" "$S" "$CONFIG"; done
  echo "$(msg "RELAIS_CLE_MAITRE : openssl rand -hex 32, rangée dans le gestionnaire de mots de passe avant d'être collée. RELAIS_ADMIN_MOT_DE_PASSE : 12 caractères au moins. TURNSTILE_SECRET : clé secrète du widget Turnstile." "RELAIS_CLE_MAITRE: openssl rand -hex 32, stored in the password manager before pasting it. RELAIS_ADMIN_MOT_DE_PASSE: 12 characters at least. TURNSTILE_SECRET: secret key of the Turnstile widget.")"
fi
[ -n "$DOMAINE" ] || echo "$(msg "Sans --domaine, le relais répond sur le sous-domaine workers.dev du compte, qui doit être créé dans le tableau de bord." "Without --domaine, the relay answers on the workers.dev subdomain of the account, which must be created in the dashboard.")"
[ -n "$CLE_SITE" ] || echo "$(msg "Attention : sans --cle-site-turnstile, Turnstile reste désactivé." "Warning: without --cle-site-turnstile, Turnstile stays disabled.")"

etape "$(msg "Adresse du relais" "Relay address")"
if [ -n "$DOMAINE" ]; then
  printf 'https://%s\n' "$DOMAINE"
else
  echo "$(msg "https://$WORKER.<sous-domaine workers.dev du compte>.workers.dev (affichée par le déploiement ci-dessus)" "https://$WORKER.<account workers.dev subdomain>.workers.dev (shown by the deployment above)")"
fi
echo "$(msg "Gestion des salons : <adresse du relais>/gestion/" "Salon management: <relay address>/gestion/")"
