# Relais de réservation en ligne

Application de référence du [contrat lama v1](../docs/reservation-en-ligne/contrat-v1.md), pour plusieurs salons : page de réservation et de suivi de chaque salon (`/<salon>/`), [API publique](../docs/reservation-en-ligne/api-publique-v1.md) pour les sites qui font leur propre interface, API que lama appelle, et interface de gestion des salons (`/gestion/`) pour l'exploitant. Le code ne dépend pas de l'hébergeur : Cloudflare Workers et D1 en service, Node et `node:sqlite` sur un serveur loué ou pour les essais.

## Organisation

- `noyau/` : schémas du contrat, signature (Web Crypto), découpage des plages, capacité « Sans préférence », fraîcheur. Ni Node ni Cloudflare.
- `noyau/coffre.ts`, `noyau/salon.ts` : chiffrement des clés des salons, règles des identifiants et des origines.
- `noyau/motifs.ts` : motifs d'identifiant et d'origine, partagés avec les pages (sans aucun import).
- `outils/` : export de la description OpenAPI (`pnpm relais:openapi`).
- `essais/` : relais et données d'essai des tests.
- `stockage/` : accès à la base (`base.ts`), réalisations D1 (`d1.ts`) et `node:sqlite` (`sqlite.ts`), migrations SQL communes (`migrations/`), données d'un salon (`depot.ts`), salons (`salons.ts`).
- `app.ts`, `routes-lama.ts`, `routes-publiques.ts`, `routes-gestion.ts` : l'application Hono (`/lama/v1` pour lama, `/api/<salon>` pour les pages, `/gestion/api` pour l'exploitant).
- `worker.ts`, `node.ts` : points d'entrée Cloudflare et Node.
- `public/` : la page de réservation et l'interface de gestion (Preact), construites dans `dist/`.

## Variables

| Variable | Rôle |
|---|---|
| `RELAIS_CLE_MAITRE` | clé générale de l'exploitant, 32 caractères au moins (obligatoire, secrète) : chiffre les clés des salons et signe les sessions de gestion. **Ne jamais la changer en service** : toutes les clés des salons deviennent illisibles, et le symptôme ressemble à « salon inconnu, signature refusée » (`401 signature`) pour tous les salons à la fois. Pour en changer, remplacer ensuite la clé de chaque salon dans la gestion et dans lama. |
| `RELAIS_ADMIN_MOT_DE_PASSE` | mot de passe de l'interface de gestion, 12 caractères au moins (obligatoire, secret) |
| `RELAIS_DEMANDES_PAR_HEURE` | dépôts de demandes par adresse, par salon et par heure (10 par défaut). Les tentatives refusées après validation comptent (corps invalide et champ piège rempli ne comptent pas). À relever si les clientes d'un même opérateur mobile, qui partagent des adresses, se bloquent entre elles. |
| `TURNSTILE_CLE_SITE`, `TURNSTILE_SECRET` | vérification anti-robot Turnstile, facultative (les deux, ou aucune). Réglage global : les noms d'hôte du widget doivent couvrir le relais et les origines déclarées de tous les salons. Recommandée en service contre le blocage massif de créneaux. |
| `RELAIS_BASE` | Node seulement : fichier de la base (`relais-donnees.db`) |
| `RELAIS_PORT` | Node seulement : port d'écoute (8790) |
| `RELAIS_HOTE` | Node seulement : adresse d'écoute (127.0.0.1) |
| `RELAIS_DIST` | Node seulement : dossier de la page construite (`relais/dist`) |
| `RELAIS_PROXY_DE_CONFIANCE` | Node seulement : `1` quand le relais est derrière un proxy inverse que l'on maîtrise. Le relais fait alors confiance à la dernière entrée de `X-Forwarded-For` (adresse de la cliente, pour les limites) et de `X-Forwarded-Proto` (cookie de gestion `Secure`) : celles que le proxy a ajoutées. Sans cette variable, c'est l'adresse de la connexion, et les en-têtes ne sont pas crus. À ne mettre que si le relais n'est joignable que par le proxy. Sur Cloudflare, l'adresse est celle que la plateforme fournit. Le proxy doit transmettre l'en-tête `Host` d'origine (nginx : `proxy_set_header Host $host;`) : les dépôts de la page du relais sont reconnus comme venant du relais lui-même par cet hôte, et refusés (`403 origine`) sinon. |

Si la clé générale ou le mot de passe manque ou est trop court, Node refuse de démarrer avec un message en français ; sur Cloudflare, le Worker échoue à chaque requête de l'application (page d'erreur de Cloudflare, pas de réponse JSON) tant que les variables ne sont pas corrigées, alors que `/assets/*` et `/integrer.js` sont toujours servis : un site qui intègre la page affiche donc un cadre en erreur, et lama voit la liaison tomber.

## Essayer en local

```bash
pnpm build:relais
RELAIS_CLE_MAITRE=$(openssl rand -hex 32) RELAIS_ADMIN_MOT_DE_PASSE=choisir-un-mot-de-passe pnpm relais
```

Ouvrir `http://127.0.0.1:8790/gestion/`, se connecter, créer un salon (par exemple `salon-essai`) et noter sa clé, montrée une seule fois. Sa page est sur `http://127.0.0.1:8790/salon-essai/`. Elle reste fermée tant que lama n'a pas publié d'offre pour ce salon.

Vérifier la conformité, après avoir passé le salon en état « Essai » dans la gestion, depuis le dossier de lama, la clé du salon sur l'entrée standard :

```bash
printf '%s\n' "$CLE" | node dist-server/cli.mjs verifier-relais http://127.0.0.1:8790 salon-essai
```

L'outil s'arrête sans rien écrire si le salon n'est pas en essai. **Toujours utiliser un salon d'essai dédié** (comme `salon-essai` ici) : ne jamais passer en essai un salon en service, même un instant, car l'outil refuse toutes ses demandes en attente et publie une offre d'essai à la place de la sienne. Un salon en essai est aussi servi au public comme un salon actif. Voir le [contrat](../docs/reservation-en-ligne/contrat-v1.md#mode-essai-et-outil-de-vérification) pour les codes de sortie.

## Gérer les salons

L'interface `/gestion/` (mot de passe `RELAIS_ADMIN_MOT_DE_PASSE`) liste les salons avec l'état de leur liaison avec lama, et permet de créer un salon, remplacer sa clé, le suspendre, le passer en essai, déclarer les origines autorisées pour l'API publique, ou le supprimer avec toutes ses données.

- Il y a **un seul compte d'exploitant**. Une connexion ouvre une session de 12 heures (cookie `relais_gestion`, `HttpOnly`, `SameSite=Strict`, `Secure` en https). Changer le mot de passe ou la clé générale ferme les sessions.
- La déconnexion ferme **toutes** les sessions, pas seulement celle du navigateur utilisé.
- Au plus 5 essais de connexion par adresse et par quart d'heure (`429 trop_d_essais` ensuite).
- Toute action de l'API de gestion exige l'en-tête `X-Relais-Gestion: 1` (l'interface l'ajoute), en plus de la session.

## Intégrer la page dans le site d'un salon

Une ligne, à l'endroit voulu de la page du site :

```html
<script src="https://reserver.exemple.com/integrer.js" data-salon="eclat" async></script>
```

`data-salon` est obligatoire. Attributs facultatifs : `data-lang="fr"` ou `"en"`, `data-titre="…"`, et `data-prestation="s12"` pour ouvrir la page sur une prestation déjà choisie (bouton « Réserver » d'une prestation sur le site ; identifiant de la vitrine, ignoré s'il est mal formé, et la page montre la liste si la prestation n'est plus proposée). Le script place un cadre (`iframe`) à cet endroit, qui prend la hauteur de la page de réservation : il grandit et rétrécit selon l'étape, et fait défiler la page du site jusqu'au haut du cadre à chaque changement d'étape quand celui-ci est au-dessus de l'écran. Aucune origine n'est à déclarer pour cette intégration : le cadre affiche la page du relais elle-même. On peut aussi faire un simple lien vers `https://reserver.exemple.com/eclat/`, ou construire sa propre interface avec l'API publique (il faut alors déclarer l'origine du site dans la gestion).

## Fichiers servis et purge

- **Node.** Les fichiers statiques ne sont servis que sous `/assets/*` et pour `/integrer.js`. Les pages (`/<salon>/`, `/gestion/`) passent par l'application, qui vérifie le salon et envoie `cache-control: no-cache`. La base est migrée au démarrage.
- **Purge.** Les demandes jamais relevées ou décidées depuis 30 jours, celles relevées mais jamais décidées dont le créneau (ou, pour un rappel, la réception) date de plus de 30 jours, les demandes abandonnées avant contrôle et les vieux compteurs sont effacés au démarrage puis chaque jour (Node) ; sur Cloudflare, par la tâche planifiée.

## Mise en service sur Cloudflare

Le relais tourne sur le compte Cloudflare de l'exploitant (l'éditeur qui le sert aux salons), sur le forfait gratuit. Le script `deploy/cloudflare.sh` fait tout ce qui se commande : il reçoit le compte, le nom du Worker et le nom de la base, n'en écrit aucun dans un fichier versionné, et ne touche jamais aux secrets, que `wrangler secret put` demande à l'invite.

### Ce qu'il faut

- Un compte Cloudflare au nom de l'exploitant, avec son identifiant (32 caractères hexadécimaux, page d'accueil du compte dans le tableau de bord).
- Un domaine de l'exploitant en zone dans ce même compte (`exemple.com`), pour l'adresse du relais (`rdv.exemple.com`) : c'est le cas principal. Sans domaine, le relais répond sur le sous-domaine `workers.dev` du compte, à créer une fois dans le tableau de bord (Workers et Pages).
- Un sous-domaine `workers.dev` pour le compte, même quand le relais est servi par un domaine personnalisé : Cloudflare refuse la purge quotidienne (cron, code 10063) tant que le compte n'en a pas, même avec `workers_dev = false`. Deux façons de le créer, une seule fois : ouvrir la page Workers et Pages du tableau de bord, ou `PUT /accounts/<compte>/workers/subdomain` avec `{"subdomain":"<nom>"}`. Avec le jeton, le script lit `GET /accounts/<compte>/workers/subdomain` et s'arrête avant toute écriture s'il n'y en a pas.
- Un jeton d'API du compte, rangé hors du dépôt dans un fichier lisible par l'exploitant seul (`~/.config/lama/cloudflare.env`, droits `600`), qui pose `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID`. Droits du jeton :
  - sur le compte : Workers Scripts et D1, en modification ; Account Settings, en lecture ;
  - sur la zone du domaine, pour rattacher le Worker comme domaine personnalisé : Zone (lecture au moins), Workers Routes et DNS, en modification. Si le droit DNS ne peut pas être accordé au jeton, voir `--sans-controle-dns` plus bas.

  Création du jeton : tableau de bord Cloudflare, Mon profil, Jetons d'API, Créer un jeton, Créer un jeton personnalisé ; y cocher les droits ci-dessus, limiter les ressources au compte et à la zone du relais, puis copier la valeur, montrée une seule fois. Le fichier lu par le script contient deux lignes, sans espace autour du signe égal : `CLOUDFLARE_API_TOKEN=<valeur du jeton>` et `CLOUDFLARE_ACCOUNT_ID=<identifiant du compte>` ; le créer, puis `chmod 600 ~/.config/lama/cloudflare.env`. Ne jamais coller le jeton dans un message, un ticket ou un dépôt ; en cas de doute, le révoquer et en créer un autre.

  À défaut de jeton, `npx wrangler@4.142.0 login` ouvre une session dans le navigateur.
- Un widget Turnstile (tableau de bord, Turnstile), en mode géré, dont les noms d'hôte couvrent l'hôte du relais et les origines des sites des salons. Il donne une clé de site (publique) et une clé secrète.
- Sur le poste de l'exploitant : Node 24 au moins, pnpm et le dépôt de lama, dépendances installées (`pnpm install`). wrangler n'est pas une dépendance du dépôt : le script l'appelle par `npx wrangler@4.142.0`, version figée.

### Se connecter

```bash
set -a; . ~/.config/lama/cloudflare.env; set +a
```

Le jeton reste dans l'environnement du terminal : jamais dans le dépôt, jamais en argument. Le script commence par afficher le compte visé (`Compte visé : <identifiant>`) mais ne fait aucune pause : relire cette ligne dans la sortie du mode à blanc avant le vrai déploiement, ou interrompre avec Ctrl-C si le compte n'est pas le bon. Avec le jeton, il vérifie ensuite en lecture, avant d'agir :

- que le jeton voit le compte (D1) ;
- pour un domaine, que le jeton voit la zone, que cette zone est à l'état Active (sinon le script s'arrête, « pas encore active », et il faut attendre la bascule des serveurs de noms), puis ses routes Workers et son DNS ;
- que le compte a un sous-domaine `workers.dev` (voir « Ce qu'il faut ») ;
- que le domaine n'est pas déjà pris (voir « Adresse du relais »).

Il s'arrête en nommant le droit qui manque, ou la raison du refus. Les droits d'écriture ne se vérifient qu'en agissant : un refus au déploiement vient d'un droit resté en lecture seule. Sans jeton, le script exige une session `wrangler login` ; si le poste est connecté à un autre compte (celui du site d'un salon, par exemple), `npx wrangler@4.142.0 logout` d'abord. Dans les deux cas, le script exporte `CLOUDFLARE_ACCOUNT_ID` et écrit `account_id` dans le fichier produit : wrangler refuse alors de déployer sur un autre compte.

### Essayer à blanc, puis déployer

```bash
deploy/cloudflare.sh --a-blanc --compte "$CLOUDFLARE_ACCOUNT_ID" --worker lama-relais --base lama-relais --domaine rdv.exemple.com --cle-site-turnstile <clé de site>
deploy/cloudflare.sh --compte "$CLOUDFLARE_ACCOUNT_ID" --worker lama-relais --base lama-relais --domaine rdv.exemple.com --cle-site-turnstile <clé de site>
```

Si le jeton ne peut pas lire le DNS, le script s'arrête sur « Le jeton ne lit pas le DNS » et cite `--sans-controle-dns`. Cette option saute alors ce seul contrôle : le script affiche « Contrôle DNS sauté » et continue. Vérifier soi-même qu'aucun enregistrement n'existe pour l'hôte (par exemple `dig rdv.exemple.com`, qui doit répondre `NXDOMAIN`). Le contrôle des domaines des Workers (hôte déjà rattaché à un autre Worker) reste obligatoire, et un enregistrement DNS lisible arrête toujours le script, option ou non.

```bash
deploy/cloudflare.sh --sans-controle-dns --compte "$CLOUDFLARE_ACCOUNT_ID" --worker lama-relais --base lama-relais --domaine rdv.exemple.com --cle-site-turnstile <clé de site>
```

`--a-blanc` affiche les vérifications (y compris la lecture des domaines des Workers), les commandes et le fichier de configuration sans rien appeler, exécuter ni écrire (il ne sait donc pas si la base existe déjà : il montre les deux commandes). Le script refuse une option inconnue (`Option inconnue`) et l'outil `relais/outils/config-wrangler.ts`, qui remplit le modèle, refuse de même toute option inconnue ou répétée plutôt que de l'ignorer : une faute de frappe sur `--domaine` ne donne donc jamais un relais sans domaine. Sans `--a-blanc`, le script :

1. vérifie les réglages (noms en minuscules, chiffres et tirets, domaine dans sa zone), affiche le compte visé, puis vérifie le jeton ou la session ;
2. construit la page (`pnpm build:relais`) avant toute écriture chez Cloudflare : un build cassé s'arrête ici, sans base créée ni migration appliquée ;
3. crée la base D1 si elle manque (région `weur` par défaut, `--region` pour une autre), et la garde sinon ;
4. écrit `relais/wrangler.deploiement.toml` à partir du modèle versionné `relais/wrangler.modele.toml` (jamais versionné lui-même) ;
5. applique les migrations (`wrangler d1 migrations apply --remote`), puis déploie le Worker, rattaché au domaine personnalisé (Cloudflare crée l'enregistrement DNS et le certificat) ;
6. lit la liste des secrets posés (illisible, elle arrête le script, qui montre l'erreur de wrangler), puis nomme les secrets manquants et donne la commande pour chacun (ou les pose avec `--secrets`).

Les options ont leurs variables : `CLOUDFLARE_ACCOUNT_ID`, `RELAIS_WORKER`, `RELAIS_BASE_D1`, `RELAIS_DOMAINE`, `RELAIS_ZONE` (le domaine sans son premier mot par défaut), `RELAIS_D1_REGION`, et `RELAIS_DEMANDES_PAR_HEURE` (30 par défaut au déploiement : les clientes d'un même opérateur mobile partagent souvent une adresse) et `TURNSTILE_CLE_SITE`, posées comme variables du Worker. Sans clé de site, Turnstile reste désactivé et le script le rappelle.

Le script se relance sans risque : base gardée, seules les migrations nouvelles sont appliquées, Worker remplacé, domaine déjà rattaché à ce même Worker toléré. C'est aussi la façon de mettre à jour le relais.

### Poser les secrets

```bash
deploy/cloudflare.sh --secrets --compte "$CLOUDFLARE_ACCOUNT_ID" --worker lama-relais --base lama-relais --domaine rdv.exemple.com --cle-site-turnstile <clé de site>
```

`--secrets` relance d'abord tout le déploiement (fichier de configuration régénéré, migrations, Worker remplacé), puis lance `wrangler secret put` pour chaque secret manquant (`RELAIS_CLE_MAITRE`, `RELAIS_ADMIN_MOT_DE_PASSE`, `TURNSTILE_SECRET`) ; la valeur se saisit à l'invite, jamais en argument (elle resterait dans l'historique du terminal) ni dans un fichier. **Toute relance reprend les mêmes options** que la première : le fichier est régénéré à chaque fois, et sans `--cle-site-turnstile` le relais repart sans Turnstile (de même pour `--demandes-par-heure`, qui retombe à 30). Pour ne pas les répéter, les fixer dans l'environnement : `CLOUDFLARE_ACCOUNT_ID`, `RELAIS_WORKER`, `RELAIS_BASE_D1`, `RELAIS_DOMAINE`, `RELAIS_ZONE`, `RELAIS_D1_REGION`, `RELAIS_DEMANDES_PAR_HEURE` et `TURNSTILE_CLE_SITE` (la clé de site est publique, elle peut figurer dans `~/.config/lama/cloudflare.env`). Garde-fous du script :

- `--secrets` est refusé dès le début sans terminal (entrée standard non interactive : tâche planifiée, intégration continue, commande alimentée par un tube) : la valeur ne pourrait pas être saisie. À blanc, l'option est acceptée et ne pose rien.
- Il ne repose jamais un secret déjà posé : seuls les manquants sont demandés. Pour en changer un exprès, lancer soi-même `npx wrangler@4.142.0 secret put <nom> --config relais/wrangler.deploiement.toml`.
- Si la liste des secrets ne se lit pas (Cloudflare ne répond pas, droit refusé, réponse illisible), le script s'arrête avec « Liste des secrets illisible » et ne pose rien : une liste illisible n'est pas une liste vide. Relancer le script quand Cloudflare répond. Le Worker est alors déjà déployé : seuls les secrets restent à faire.

**Ne jamais remplacer `RELAIS_CLE_MAITRE` une fois le relais en service.** Changer cette clé rend illisibles les données déjà scellées : les clés des salons, chiffrées avec elle, ne se déchiffrent plus, et le relais refuse tous les salons à la fois (`401 signature`) ; les sessions de gestion sont perdues. Le seul remède est de remplacer la clé de chaque salon dans la gestion et dans lama. La clé se tire avec `openssl rand -hex 32` et se range dans le gestionnaire de mots de passe de l'exploitant avant d'être collée : Cloudflare ne la rend jamais, et la perdre revient à la changer. Tant que `RELAIS_CLE_MAITRE` ou `RELAIS_ADMIN_MOT_DE_PASSE` manque, le Worker répond par une page d'erreur de Cloudflare.

### Adresse du relais

- **Domaine personnalisé** (cas principal) : `--domaine rdv.exemple.com`. Le domaine doit être dans une zone du même compte ; le script ajoute la route `custom_domain` et coupe l'adresse `workers.dev`, pour qu'il n'y en ait qu'une. Avant d'agir, avec le jeton, il demande à Cloudflare ce qui est déjà rattaché à cet hôte (`workers/domains?hostname=…`) :
  - hôte déjà rattaché au même Worker : c'est une relance, elle continue ;
  - hôte déjà rattaché à un autre Worker : le script s'arrête, « déjà rattaché au Worker … », sans rien faire. Détacher le domaine dans le tableau de bord, ou en choisir un autre ;
  - hôte sans Worker mais avec un enregistrement DNS existant : le script s'arrête, « Un enregistrement DNS existe déjà », car le domaine personnalisé ne remplace pas un enregistrement sans que l'exploitant le sache. Le supprimer dans le tableau de bord, ou choisir un autre hôte ;
  - réponse refusée ou illisible : le script s'arrête aussi, car il ne sait pas ce qui est rattaché.
- **Sans domaine** : `https://<worker>.<sous-domaine>.workers.dev`, affichée par le déploiement, une fois le sous-domaine `workers.dev` du compte créé. Les vérifications de domaine ne s'appliquent pas.

Après un changement d'adresse, mettre à jour les noms d'hôte du widget Turnstile, l'adresse du relais dans le lama de chaque salon et le code d'intégration de chaque site.

### Réglages du fichier wrangler

- **Liaisons.** La base D1 s'appelle `BASE`, les fichiers de `dist/` sont servis par Workers Static Assets sous la liaison `ASSETS`, les secrets (`RELAIS_CLE_MAITRE`, `RELAIS_ADMIN_MOT_DE_PASSE`, `TURNSTILE_SECRET`) sont des secrets du Worker et les autres variables (`RELAIS_DEMANDES_PAR_HEURE`, `TURNSTILE_CLE_SITE`) des variables.
- **`assets.html_handling = "none"`.** Sans ce réglage, la lecture d'une page par le Worker (`ASSETS.fetch("/index.html")`) reçoit une redirection (307) au lieu du fichier, et aucune page n'est servie. Le Worker le détecte et le dit dans ses journaux.
- **`assets.run_worker_first = true`.** Sans ce réglage, `/` et `/gestion` seraient servis directement par les fichiers, sans passer par le Worker : le salon ne serait pas vérifié et la page serait mise en cache. Toute requête arrive donc au Worker, qui renvoie lui-même `/assets/*` et `/integrer.js` aux fichiers statiques.
- **Migrations D1.** Le Worker ne migre pas la base lui-même. Appliquer les migrations avec `wrangler d1 migrations apply` depuis le dossier `relais/stockage/migrations/` (réglage `migrations_dir` de la liaison D1), à chaque version qui en apporte une : le script le fait.
- **Purge.** Un Cron Trigger quotidien (03:17 UTC) appelle le gestionnaire `scheduled` du Worker, qui efface les données périmées de tous les salons.
- **Dernier appel de lama.** Il n'est écrit qu'une fois par minute au plus et par salon, quel que soit le nombre d'appels.

### Budget du forfait gratuit

Limites du forfait gratuit de Cloudflare relevées en octobre 2026, à revérifier sur la page des tarifs le jour du déploiement :

| Ressource | Forfait gratuit | Un salon, chaque jour |
|---|---|---|
| Requêtes du Worker | 100 000 par jour | environ 3 000 de lama (deux appels par minute, plus les plages toutes les 15 minutes), plus une dizaine par visite d'une cliente (page, API et fichiers, qui passent tous par le Worker) |
| Temps de calcul | 10 ms par requête | moins de 1 ms pour les jours libres d'un salon de 8 praticiennes sur 30 jours (essai `relais/budget.test.ts`, seuil de 5 ms) |
| Lignes écrites dans D1 | 100 000 par jour | environ 14 000 : 2 par appel de lama (compteur contre le rejeu et son index), autant pour leur purge, et 1 440 au plus pour le dernier appel |
| Lignes lues dans D1 | 5 millions par jour | quelques dizaines par appel |
| Stockage D1 | 5 Go | quelques mégaoctets |
| Cron Triggers | 5 par compte | 1 |

Le forfait gratuit sert donc un relais de six salons environ, la limite étant les lignes écrites. Au-delà, ou dès que le tableau de bord montre plus de 80 % du quota d'écritures, passer au forfait payant Workers.

### Essai local (wrangler dev)

La même configuration se lance sur le poste, base D1 simulée par Miniflare, sans rien envoyer à Cloudflare. Garder `--local` sur chaque commande wrangler : sans lui, `d1 migrations apply` s'adresserait à la vraie base du compte connecté. Sans jeton dans l'environnement :

```bash
pnpm build:relais
node --experimental-strip-types relais/outils/config-wrangler.ts config --compte 00000000000000000000000000000000 --worker relais-essai --base relais-essai --id-base 00000000-0000-0000-0000-000000000000 > relais/wrangler.essai-local.toml
npx wrangler@4.142.0 d1 migrations apply relais-essai --local --config relais/wrangler.essai-local.toml
npx wrangler@4.142.0 dev --local --test-scheduled --config relais/wrangler.essai-local.toml --port 8791 --var RELAIS_CLE_MAITRE:$(openssl rand -hex 32) --var RELAIS_ADMIN_MOT_DE_PASSE:choisir-un-mot-de-passe
```

Puis, comme pour Node : créer un salon d'essai dans `http://127.0.0.1:8791/gestion/`, le passer en essai, lancer `verifier-relais` contre `http://127.0.0.1:8791`, et déclencher la purge avec `curl "http://127.0.0.1:8791/__scheduled?cron=17+3+*+*+*"`. Effacer ensuite `relais/wrangler.essai-local.toml` et `relais/.wrangler/`.

### Mettre à jour

Mettre le relais à jour avant les lama des instituts. Dans l'autre ordre, un relais ancien ne transmet pas le prénom saisi à part : tant que l'écart dure, les nouvelles demandes reçoivent des messages qui commencent par « Bonjour, » sans prénom. L'inverse (relais neuf, lama ancien) reste compatible : le lama ancien tire encore le prénom du nom complet.

### Ouvrir un salon

1. Dans `/gestion/`, créer le salon (identifiant court, nom de l'institut) ; noter la clé, montrée une seule fois, et la transmettre à l'administrateur de l'institut par un canal sûr.
2. Déclarer les origines du site du salon (`https://www.exemple.com`) s'il appelle l'API publique ; l'intégration par `integrer.js` n'en demande pas.
3. Avant la première ouverture, et après chaque mise à jour du relais, vérifier la conformité sur un salon d'essai dédié (jamais celui du salon) : créer pour cela un salon d'essai sur le relais en service (par exemple `salon-essai`), le passer en essai, lancer `verifier-relais` contre l'adresse du relais comme dans « Essayer en local », puis le supprimer ou le suspendre dans la gestion.
4. Dans le lama de l'institut : l'administrateur colle l'identifiant du salon et la clé (Réglages, Réservation en ligne) ; la gérante règle l'adresse du relais, le thème et les horaires, coche les prestations et les praticiennes réservables en ligne, active la réservation en ligne et teste la liaison.
5. Sur le site du salon : le code d'intégration que lama affiche, ou un lien vers `https://<relais>/<salon>/`. Les identifiants des prestations, pour `data-prestation`, se lisent dans la vitrine : `curl -s https://<relais>/api/<salon>/vitrine`.
