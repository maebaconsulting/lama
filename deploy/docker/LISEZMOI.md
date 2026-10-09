# Démonstration publique de lama avec Dokploy

Cette notice installe la démonstration publique de lama à l'adresse `https://lama-demo.mowoapp.com`, par votre instance Dokploy. Dokploy fabrique l'image depuis le dépôt public `maebaconsulting/lama` et fait le HTTPS par Traefik et Let's Encrypt. English version : [README.md](README.md).

## Ce que l'on obtient

- lama en mode démonstration publique : Institut Démo, données fictives, numéros visiblement fictifs, bandeau « Démonstration » sur chaque écran, documents marqués « DÉMONSTRATION ».
- Trois comptes publics affichés à l'écran de connexion : `gerante`, `reception`, `praticienne`. Leurs mots de passe et codes PIN ne se changent pas, ils ne se bloquent jamais.
- Un compte d'administration caché, `administration`, dont le mot de passe est le secret `LAMA_DEMO_MDP_ADMIN` (créé seulement si le secret a 10 caractères au moins).
- Rien ne sort : aucun message WhatsApp ni SMS, aucune sauvegarde, aucun envoi de fichier (logo, photos des produits).
- Remise à zéro chaque nuit à 3 h, heure de Douala.

## Créer l'application dans Dokploy

1. Dans Dokploy, créez un projet (par exemple `lama`), puis « Create Service », « Application », nom `lama-demo`.
2. Onglet « General », « Provider » : « Git », adresse `https://github.com/maebaconsulting/lama.git`, branche `main` (ou « GitHub » si Dokploy est relié à GitHub : il redéploie alors à chaque envoi).
3. « Build Type » : « Dockerfile », Docker File `Dockerfile`, Docker Context Path `.`, Docker Build Stage vide.
4. Enregistrez. Ne lancez pas encore le déploiement : réglez d'abord les variables, le volume, la mise à jour et le domaine.

## Variables

Onglet « Environment », « Environment Settings » :

```
LAMA_DEMO_PUBLIQUE=1
LAMA_PROXY_HTTPS=1
LAMA_LANGUE=fr
LAMA_DEMO_MDP_ADMIN=<mot de passe de l'administration, 10 caractères au moins>
```

- `LAMA_DEMO_MDP_ADMIN` ne va jamais dans le dépôt ni dans un message : c'est un secret de Dokploy. Pour en fabriquer un : `openssl rand -base64 18`.
- Absente, vide ou trop courte (moins de 10 caractères) : la démonstration démarre sans compte d'administration, et le journal le dit, sans jamais écrire la valeur.
- Rien dans « Build Time Arguments » ni « Build-time Secrets ». Le fichier `.env` que Dokploy écrit pendant la fabrication est exclu de l'image par `.dockerignore`.

## Volume

Onglet « Advanced », « Volumes », « Add Volume » : « Volume Mount », nom `lama-demo-donnees`, chemin `/data`. La base, la configuration et la clé maîtresse de la démonstration y vivent.

## Mise à jour : arrêter avant de démarrer

Par défaut, Dokploy démarre la nouvelle version avant d'arrêter l'ancienne. lama ne doit jamais tourner deux fois sur la même base : onglet « Advanced », « Cluster Settings », « Swarm Settings », réglez

- Update Config : `{"Parallelism": 1, "Order": "stop-first", "FailureAction": "rollback"}`
- Rollback Config : `{"Parallelism": 1, "Order": "stop-first"}`

Laissez vides « Restart Policy » et « Health Check » : Docker relance alors lama après tout arrêt (la remise de la nuit en dépend) et le contrôle de santé du `Dockerfile` s'applique. Jamais « on-failure » en « Restart Policy » : la démonstration resterait arrêtée après la remise de la nuit.

## Domaine et HTTPS

Onglet « Domains », « Add Domain » :

- Host : `lama-demo.mowoapp.com`
- Path : `/`
- Container Port : `8080`
- HTTPS : activé, certificat « Let's Encrypt »

Puis « Deploy ». La première fabrication de l'image prend quelques minutes, le certificat une ou deux de plus.

## DNS

L'adresse doit mener au serveur Dokploy. Chez `mowoapp.com`, tout sous-domaine y mène déjà, directement (« DNS seulement ») : rien à créer. Sinon, chez Cloudflare : enregistrement `A` `lama-demo` vers l'adresse IP du serveur, nuage gris d'abord (Let's Encrypt doit joindre Traefik directement). Le proxy de Cloudflare ne s'active qu'ensuite, en SSL « Full (strict) », jamais « Flexible ».

## Sécurité

- Aucun port publié : seul Traefik joint lama, par le réseau `dokploy-network`. N'ajoutez rien dans « Advanced », « Ports » : le port 8080 serait joignable sans HTTPS.
- `LAMA_PROXY_HTTPS=1` fait confiance à l'en-tête `X-Forwarded-Proto` posé par Traefik : cette variable n'a sa place que derrière un proxy, jamais sur le mini-PC d'un institut.
- Les cookies de session de la démonstration sont `__Host-`, `Secure`, `HttpOnly` et `SameSite=Strict`.
- La démonstration a sa propre base dans le volume `lama-demo-donnees` ; les mots de passe publics n'ouvrent rien d'autre.
- Un visiteur peut bloquer temporairement le compte `administration` en tapant cinq mots de passe faux de suite (blocage de 5 minutes, doublé à chaque nouvelle série, 24 heures au plus). Les comptes publics, eux, ne se bloquent jamais. Pour le débloquer aussitôt : « Restart » ou « Deploy » dans Dokploy ; au démarrage, lama rétablit le compte d'administration et le débloque. La remise de 3 h le débloque aussi.

## Autre manière : application Compose

Le fichier `deploy/docker/compose.demo.yml` fait la même démonstration en application « Compose » de Dokploy (Compose Path `deploy/docker/compose.demo.yml`, seule variable à régler : `LAMA_DEMO_MDP_ADMIN`, domaine sur le service `lama`, port `8080`). Il ne publie aucun port et relance toujours le conteneur.

## Vérifier

```bash
curl -sI https://lama-demo.mowoapp.com | head -1
curl -s https://lama-demo.mowoapp.com/api/auth/state
```

- La première commande répond `HTTP/2 200`.
- La seconde montre `"formation":true` et les trois comptes publics dans `"demo"`, jamais `administration`.
- Au navigateur : le cadenas, le bandeau « Démonstration », les trois comptes sous le formulaire ; touchez « Gérante » puis « Se connecter ».

## Remise à zéro de chaque nuit

À 3 h, heure de Douala, lama dépose sa demande de remise, annonce la maintenance et s'arrête ; Docker le relance et la démonstration repart neuve. Si le compte d'administration existe, il peut aussi la remettre à zéro à la main : Réglages, Formation, « Remettre la formation à zéro ».

## Redéployer

Après un nouvel envoi sur la branche `main` du dépôt public : « Deploy » dans Dokploy (ou automatiquement avec le fournisseur « GitHub »). Le volume `lama-demo-donnees` est gardé ; la démonstration redémarre avec ses comptes rétablis.

## Journal

Onglet « Logs » de l'application. Lignes attendues au démarrage :

```
Comptes de démonstration prêts : gerante, reception, praticienne.
Administration de la démonstration prête (administration).
lama à l'écoute sur le port 8080
```

En cas de mot de passe trop court :

```
LAMA_DEMO_MDP_ADMIN trop courte (10 caractères au moins) : la démonstration démarre sans compte d'administration. Corrigez la variable du service.
```

Après la remise de la nuit : « Remise à zéro de la nuit », puis « Démonstration remise à zéro » (aucun poste gardé) au démarrage suivant.
