# API publique v1 du relais de réservation

Cette API est celle que la page de réservation du relais utilise. Elle est ouverte aux sites qui préfèrent construire leur propre interface de réservation, appelée depuis le navigateur de la cliente. Le relais y applique toutes les règles du [contrat lama v1](contrat-v1.md) et toutes ses protections, quel que soit l'appelant.

Pour un site qui ne veut rien programmer, une ligne suffit à intégrer la page du relais :

```html
<script src="https://reserver.exemple.com/integrer.js" data-salon="eclat" async></script>
```

## Principes

- **Adresses :** toutes les routes sont sous `https://<relais>/api/<salon>/`, où `<salon>` est l'identifiant du salon sur le relais (`eclat`). Un salon inconnu rend `404 introuvable`.
- **Origines autorisées (CORS) :** le navigateur n'autorise un site à appeler l'API que si son origine (`https://www.eclat.cm`) est déclarée pour le salon dans l'interface de gestion du relais. Seules les origines déclarées reçoivent `Access-Control-Allow-Origin` (avec les méthodes `GET` et `POST` et l'en-tête `content-type`, y compris à la requête préalable `OPTIONS`) ; toute autre origine n'en reçoit pas, et son navigateur refuse la réponse. La page du relais elle-même n'a besoin d'aucune déclaration.
- **Aucune donnée de cliente n'en sort.** Les réponses ne contiennent que l'offre du salon, ses créneaux libres et l'état d'une demande.
- **Dépôts protégés des autres sites.** Les deux routes `POST` exigent un corps `content-type: application/json` (les paramètres comme `charset` sont acceptés) : sinon `415 type_contenu`. Une requête qui porte un en-tête `Origin` doit venir du relais lui-même (même hôte) ou d'une origine déclarée du salon : sinon `403 origine`. Un formulaire ou une requête « simple » d'un site quelconque, que le navigateur envoie sans requête préalable, est donc refusé. Sans en-tête `Origin` (outil, serveur), la requête passe.
- **Pas de cache :** toutes les réponses, erreurs comprises, portent `cache-control: no-store` et `Vary: Origin`.
- **Erreurs :** corps `{ "erreur": { "code": "...", "message": "..." } }`, comme le contrat.
- **Aucun jeton dans une adresse.** Le jeton de suivi voyage dans le corps d'une requête `POST`, jamais dans une adresse, pour qu'il ne figure dans aucun journal de serveur ou d'hébergeur.
- **Salon suspendu.** La vitrine est `ferme` (aucune prestation ni praticienne, `du` et `au` nuls) mais garde le nom de l'institut, et tout dépôt est refusé.
- **Salon en essai.** Il est servi au public comme un salon actif, ce qui permet d'essayer sa page. Un vrai salon ne doit jamais rester en essai.

## Routes

| Route | Réponse |
|---|---|
| `GET /api/<salon>/vitrine` | `etat` (`ouvert`, `rappel` si les créneaux ne sont plus à jour, `ferme`), `institut` (`nom`, `telephone`, `logo`, `devise`, `langues`, `texte_donnees`, `theme`, `affichage` et `horaires` ou `null` chacun, ou `null` pour tout l'institut), `prestations`, `praticiennes`, `aujourdhui` (date du jour dans le fuseau de l'institut), `du` et `au` (horizon), `turnstile` (clé de site Turnstile, ou `null`) |
| `GET /api/<salon>/jours?prestation=<id>&praticienne=<id>` | `jours` (dates qui ont au moins un créneau) et `prochains` (les trois premiers créneaux, `{ date, heure }`). `praticienne` est facultatif. |
| `GET /api/<salon>/creneaux?prestation=<id>&date=<AAAA-MM-JJ>&praticienne=<id>` | `creneaux` : `{ heure, praticiennes }` pour chaque heure libre, avec les praticiennes qui peuvent l'accueillir. `422 donnees_invalides` si la date est mal formée. |
| `POST /api/<salon>/demandes` | Dépôt d'une demande (ci-dessous). `201 { "jeton": …, "hors_horaires": … }` : `hors_horaires` vaut vrai quand l'institut est fermé à l'instant du dépôt d'après ses horaires publiés (la page dit alors « Dès l'ouverture, nous vérifions la disponibilité… »), faux sinon ou sans horaires publiés |
| `POST /api/<salon>/suivi` | Suivi d'une demande, corps `{ "jeton": "…" }` (1 Ko au plus, sinon `413 corps_trop_gros`). Réponse : `type`, `prestation` (nom en français et en anglais), `date`, `heure`, `souhait`, `etat` (`en_attente`, `confirmee`, `autre_horaire`, `refusee`, `traitee`), `horaire` (horaire proposé), `message` (message de l'institut), `issue` (pour un rappel clos : `rdv_pris`, `injoignable` ou `sans_suite` ; sinon `null`). `404 introuvable` si le jeton est inconnu ou expiré. |

Les adresses `/` et `/<salon>/` d'un salon inconnu ne sont pas des routes de l'API : elles affichent la page du relais avec le message « Adresse de prise de rendez-vous incomplète ou inconnue », en statut `404`.

### Dépôt d'une demande

```json
{
  "type": "creneau", "prestation": "s12", "praticienne": null, "date": "2026-10-20", "heure": "10:00", "souhait": null,
  "cliente": { "prenom": "Mireille", "nom": "Mireille Ngo", "telephone": "+237699123456", "langue": "fr" },
  "note": "", "accord": true, "piege": "", "turnstile": "…"
}
```

- `type` : `creneau` (avec `date` et `heure`) ou `rappel` (avec `souhait` : `{ "jours": ["lun", "sam"], "moments": ["matin", "apres_midi", "soir"], "precision": "" }`).
- `praticienne` : `null` pour « Sans préférence ».
- `cliente.prenom` (`prenom` dans l'objet `cliente`) : facultatif, 60 caractères au plus, d'une seule ligne (lettres, espaces simples, apostrophe, trait d'union, point en fin de mot ; trois mots au plus). Les chiffres et les adresses web sont refusés par un 422. La page du relais le demande à part et envoie dans `cliente.nom` le nom complet (« Mireille Ngo ») ; une interface propre fait de même.
- `cliente.nom` : obligatoire, nom complet (« Mireille Ngo »), d'une seule ligne de 120 caractères au plus et de 1 à 8 mots (lettres, espaces simples, apostrophe, trait d'union, point en fin de mot). Les chiffres, les adresses web et les caractères de contrôle sont refusés par un 422.
- `telephone` au format international E.164. `accord` doit valoir `true` (case d'accord sur l'usage des données, texte `texte_donnees` de la vitrine).
- `piege` : champ caché, toujours vide pour une personne. S'il est rempli, la réponse est un faux `201` et rien n'est gardé.
- `turnstile` : jeton du widget Turnstile, exigé seulement si la vitrine publie une clé de site.

#### Protections

- **Taille.** Le corps d'un dépôt fait 16 Ko au plus (`413 corps_trop_gros` au-delà).
- **Limite par adresse.** Au plus `RELAIS_DEMANDES_PAR_HEURE` dépôts par adresse et par salon et par heure (10 par défaut) ; au-delà, `429 trop_de_demandes`. Les tentatives refusées après validation comptent aussi (corps invalide et champ piège rempli ne comptent pas). L'adresse n'est gardée que sous forme d'empreinte. Les opérateurs mobiles font partager une même adresse à beaucoup de clientes : si les clientes d'un même opérateur se bloquent entre elles, relever cette limite.
- **Limite par numéro.** Au plus 3 demandes en attente (sans décision) par numéro de téléphone et par salon ; au-delà, `429 trop_de_demandes_telephone`. Une demande de créneau dont la date est passée (dans le fuseau de l'institut) ne compte plus, même si l'institut ne l'a jamais décidée. Cette limite peut être dépassée par des envois simultanés ; l'excès est borné par la limite par adresse.
- **Champ piège** (`piege`), voir plus haut.
- **Turnstile.** Si le relais a une clé de site et un secret Turnstile, tout dépôt doit porter un jeton valable (`422 verification` sinon). Le réglage est global au relais : les noms d'hôte du widget doivent couvrir le relais et les origines déclarées de tous les salons. Il est recommandé en service : c'est la vraie réponse au blocage massif de créneaux par des robots, que les autres protections ne font que ralentir.

#### Réponses d'erreur

| Statut | Code | Cas, et ce qu'une interface doit faire |
|---|---|---|
| 409 | `indisponible` | le créneau vient d'être pris ou ne respecte pas les règles : revenir au choix de l'horaire |
| 409 | `rappel_seulement` | les créneaux ne sont plus à jour : proposer « Être rappelée » |
| 409 | `ferme` | réservation en ligne fermée pour ce salon (offre vide ou salon suspendu) |
| 409 | `inconnue` | prestation ou praticienne retirée de l'offre : revenir au choix de la prestation |
| 413 | `corps_trop_gros` | corps de plus de 16 Ko (dépôt) ou de 1 Ko (suivi) |
| 422 | `donnees_invalides` | champ manquant ou mal formé |
| 422 | `verification` | jeton Turnstile refusé |
| 429 | `trop_de_demandes` | trop de demandes depuis cette adresse dans l'heure |
| 429 | `trop_de_demandes_telephone` | trois demandes déjà en attente pour ce numéro |
| 404 | `introuvable` | salon inconnu, ou jeton de suivi inconnu ou expiré |
| 403 | `origine` | dépôt ou suivi envoyé depuis une origine qui n'est ni le relais ni une origine déclarée du salon : déclarer l'origine dans la gestion |
| 415 | `type_contenu` | corps d'un dépôt ou d'un suivi qui n'est pas `application/json` |

La page de suivi d'une demande est à `https://<relais>/<salon>/#suivi=<jeton>` : le jeton reste dans le navigateur de la cliente (la partie après `#` n'est jamais envoyée au serveur). Une interface propre peut y renvoyer la cliente, ou afficher elle-même le résultat de `POST /api/<salon>/suivi`.
