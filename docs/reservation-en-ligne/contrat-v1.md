# Contrat d'interface lama v1 : réservation en ligne

Ce document décrit ce qu'une application de réservation doit faire pour recevoir les demandes de rendez-vous des instituts qui utilisent lama. Une même application peut servir plusieurs salons : chacun a son identifiant, sa clé partagée et ses données, et ne voit jamais celles des autres. Il s'adresse au prestataire qui écrit cette application. Le relais de référence (dossier `relais/` du dépôt) le respecte, et l'outil `cli verifier-relais` dit si une autre application le respecte aussi.

La description OpenAPI des mêmes routes est dans [contrat-v1.openapi.json](contrat-v1.openapi.json). En cas de doute, ce document fait foi pour les règles, la description OpenAPI pour la forme des données.

## Principe

Le serveur de lama tourne dans l'institut, sur un réseau qui sort sur internet mais n'est pas joignable depuis internet. **Lama appelle toujours l'application, l'application n'appelle jamais lama.**

- Lama publie l'offre (institut, prestations, praticiennes) et les plages libres de chaque praticienne.
- L'application montre les créneaux à la cliente et reçoit ses demandes.
- Lama relève les demandes, les enregistre, les accuse, puis rend la décision de la réception.

Une demande n'est jamais un rendez-vous confirmé tant que la réception de l'institut ne l'a pas acceptée.

## Règles communes

- **Préfixe :** toutes les routes sont sous `https://<application>/lama/v1/`. Un changement incompatible sera une `v2`, sous un autre préfixe.
- **Évolution :** chaque côté ignore les champs qu'il ne connaît pas. Des champs peuvent être ajoutés dans la `v1`.
- **Corps :** JSON en UTF-8, 1 Mo au plus (au-delà : `413 corps_trop_gros`).
- **Montants :** entiers en unités mineures, comme dans lama (`1550` en EUR vaut 15,50 € ; `15000` en XAF vaut 15 000 F). La devise et son nombre de décimales sont publiés avec l'offre.
- **Dates et heures :** dates `AAAA-MM-JJ` et heures `hh:mm` dans le fuseau de l'institut, publié avec l'offre (`Africa/Douala` par exemple). Les instants sont en millisecondes depuis 1970. Attention : une application hébergée en UTC doit calculer « aujourd'hui » et le délai minimal dans le fuseau de l'institut.

### Signature

Chaque appel de lama porte trois en-têtes :

| En-tête | Contenu |
|---|---|
| `X-Lama-Institut` | identifiant du salon sur l'application |
| `X-Lama-Horodatage` | instant de l'appel, en millisecondes depuis 1970 |
| `X-Lama-Signature` | HMAC-SHA256, en hexadécimal minuscule, de la chaîne à signer |

La clé du HMAC est la clé partagée **de ce salon**, prise telle quelle (ses octets UTF-8). C'est une suite de 32 octets aléatoires écrite en 64 caractères hexadécimaux minuscules, générée par l'application quand elle inscrit le salon, puis remise à l'institut, qui la saisit dans lama. L'application la garde chiffrée. La clé d'exemple ci-dessous ne sert qu'à vérifier un calcul : `cli verifier-relais` refuse toute clé d'un autre format. La chaîne à signer est faite de quatre lignes séparées par un retour à la ligne (`\n`), sans retour final :

```
<horodatage>
<MÉTHODE en majuscules>
<chemin avec sa requête, tel qu'envoyé, par exemple /lama/v1/demandes?apres=000000000012&limite=50>
<SHA-256 hexadécimal minuscule du corps, celui d'une chaîne vide pour un GET>
```

Exemple, avec la clé `cle-d-exemple-a-remplacer-0123456789abcdef`, l'horodatage `1792170000000` et l'appel `PUT /lama/v1/offre` de corps `{"version":12}` :

```
empreinte du corps : cd7600cf4edfe7e057e81cf99f830b7f8c2f4cc6d0935994f6590d4989e5e4d9
X-Lama-Signature   : 04ebbcbf7bd45784e0ab0e07b96d80b8cb6e5afcb1da2b88ce2964321f3a0a31
```

Ce que l'application contrôle, dans cet ordre :

1. **Horodatage.** Absent, mal formé ou écarté de plus de 5 minutes de l'heure de l'application : `401` `horodatage`. Ce contrôle précède la recherche du salon, donc il rend la même réponse pour tout salon, connu ou non.
2. **Signature.** Salon inconnu, signature absente ou fausse, y compris signée avec la clé d'un autre salon : `401` `signature`. Un salon inconnu et une mauvaise clé reçoivent exactement la même réponse : l'appelant n'apprend pas quels salons existent. La comparaison des signatures se fait en temps constant.
3. **Une signature, un seul usage.** Une signature déjà acceptée est refusée comme une fausse (`401` `signature`) : un appel intercepté ne peut pas être rejoué. Conséquences pour lama :
   - deux appels identiques (même méthode, même chemin, même corps) ne doivent pas porter le même horodatage, sans quoi leur signature serait la même et le second serait refusé ; l'horodatage est en millisecondes, et le plus simple est de le faire strictement croissant pour un même client (le maximum entre l'heure et le dernier horodatage utilisé plus un) ;
   - un nouvel essai après un échec est **signé à nouveau**, avec un nouvel horodatage, jamais renvoyé tel quel.
4. **Salon suspendu.** Un appel bien signé d'un salon suspendu par l'exploitant reçoit `403` `suspendu`. Seul un appel bien signé l'apprend.

Toutes les routes ne lisent et n'écrivent que les données du salon qui signe.

### Erreurs

Corps d'erreur : `{ "erreur": { "code": "...", "message": "..." } }`. Le message est libre ; lama ne lit que le code.

| Statut | Codes |
|---|---|
| 401 | `signature`, `horodatage` |
| 403 | `suspendu` |
| 404 | `introuvable` (demande inconnue, route inconnue, ou route d'essai sur un salon qui n'est pas en essai) |
| 409 | `version_ancienne` ; sur la route d'essai : `ferme`, `inconnue`, `rappel_seulement`, `indisponible` |
| 413 | `corps_trop_gros` |
| 422 | `donnees_invalides` |
| 500 | `interne` (erreur de l'application, sans détail) |

## Les échanges

| Appel | Rôle |
|---|---|
| `GET /etat` | Vérifier la liaison. Réponse : `contrat` (`"v1"`), `application` (`nom` et `version`, libres), `version_offre` et `version_disponibilites` (`null` tant que rien n'est publié), `demandes_en_attente` (demandes contrôlées et non accusées), `mode_essai` (booléen, vrai si ce salon est en mode essai). |
| `PUT /offre` | Publier l'offre. Réponse : `{ "version": … }`. |
| `PUT /disponibilites` | Publier les plages libres. Réponse : `{ "version": … }`. |
| `GET /demandes?apres=<curseur>&limite=<n>` | Relever les demandes non accusées arrivées après le curseur, dans l'ordre d'arrivée (`limite` 50 par défaut, 200 au plus). Sans `apres` : toutes les demandes non accusées. Réponse : `demandes` et `curseur` (celui de la dernière demande rendue, sinon celui reçu, sinon `null`). |
| `POST /demandes/{id}/accuse` | Lama a enregistré la demande. Réponse : `{ "id": … }`. |
| `POST /demandes/{id}/decision` | Décision de la réception. Réponse : `{ "id": …, "decision": … }`. |
| `POST /essai/demande` | Mode essai seulement : déposer une demande comme une cliente. |
| `GET /essai/demande/{id}` | Mode essai seulement : état brut d'une demande. |

### Offre (`PUT /offre`)

```json
{
  "version": 12,
  "institut": { "nom": "Institut Éclat", "fuseau": "Africa/Douala", "telephone": "+237600000000", "logo": null,
                "devise": { "code": "XAF", "decimales": 0, "symbole": "F", "position": "apres" },
                "langues": ["fr", "en"],
                "texte_donnees": { "fr": "Vos données servent à traiter votre demande.", "en": "Your data is used to handle your request." } },
  "prestations": [ { "id": "s12", "nom": { "fr": "Soin visage éclat", "en": "Radiance facial" },
                     "categorie": { "fr": "Visage", "en": "Face" }, "description": { "fr": "", "en": "" },
                     "duree": 60, "prix": 25000 } ],
  "praticiennes": [ { "id": "p3", "prenom": "Awa", "photo": null, "prestations": ["s12"] } ]
}
```

- `version` ne fait qu'augmenter. Une version plus ancienne que celle en place est refusée (`409 version_ancienne`) ; la même version est acceptée à nouveau.
- Les identifiants sont opaques pour l'application. Une praticienne ne cite que des prestations de l'offre.
- `logo` et `photo` sont facultatifs : image `data:image/png|jpeg|webp;base64,…` de 200 ko au plus. Ces images comptent dans la limite de 1 Mo du corps de `PUT /offre` : cela fait environ quatre images de taille maximale. Lama réduit donc les photos avant de les publier (étape 3).
- `duree` en minutes (5 à 720), `prix` en unités mineures (1 au moins).
- **Offre vide** (aucune prestation) : la réservation en ligne est momentanément fermée. L'application l'affiche et refuse toute demande (`ferme`). Les demandes déjà faites restent.
- Une prestation retirée de l'offre n'est plus réservable ; les demandes déjà faites restent, avec le nom qu'elle avait.
- **Thème et horaires** (facultatifs, ajoutés le 18/10/2026) : une application qui les ignore reste conforme, et `cli verifier-relais` passe avec et sans eux.

```json
"institut": {
  "theme": { "fond": "#F3EDE3", "accent": "#141312", "police": "elegante" },
  "horaires": { "lun": [["09:00", "20:00"]], "mar": [["09:00", "20:00"]], "mer": [["09:00", "20:00"]], "jeu": [["09:00", "20:00"]],
                "ven": [["09:30", "22:00"]], "sam": [["09:30", "22:00"]], "dim": [] }
}
```

- `theme` : `fond` et `accent` en `#RRGGBB` ; `police` parmi `lama` (charte de lama, par défaut), `classique` (EB Garamond et Jost), `elegante` (Cinzel pour les titres, EB Garamond pour le texte) et `moderne` (Jost). La couleur du texte se déduit du fond : noir ou blanc, le plus contrasté. Refusé (`422 donnees_invalides`) : couleur mal formée, police inconnue, contraste du texte sur le fond inférieur à 4,5:1, contraste de l'accent sur le fond inférieur à 3:1 (rapports de contraste WCAG 2.1). Sans `theme`, la page garde la charte de lama. Le relais de référence pose le thème dans la page du salon avant tout script et sert lui-même ses polices.
- `horaires` : pour chaque jour (`lun` à `dim`), zéro à deux plages `hh:mm`, fin exclusive, dans le fuseau de l'institut ; même forme que les horaires de l'institut réglés dans lama. Ils ne servent qu'à dire à la cliente qui dépose sa demande pendant la fermeture que l'institut lui répondra dès l'ouverture ; les créneaux restent calculés depuis les plages libres publiées.

### Plages libres (`PUT /disponibilites`)

```json
{
  "version": 3481, "genere_le": 1792170000000,
  "du": "2026-10-16", "au": "2026-11-15", "pas": 15, "delai_minimal": 120,
  "plages": { "p3": { "2026-10-20": [["09:00", "12:30"], ["14:00", "19:00"]] } }
}
```

Lama publie les **plages libres** de chaque praticienne, pas la liste des créneaux. Une plage libre est une portion des heures de travail de la praticienne sans rendez-vous, sans créneau bloqué et sans demande à confirmer. Les heures de fin sont exclusives. Une nouvelle publication remplace entièrement la précédente ; une version plus ancienne est refusée (`409 version_ancienne`). `genere_le` est l'instant où lama a calculé ces plages, après avoir enregistré toutes les demandes qu'il avait accusées. L'horizon va de `du` à `au`, 92 jours au plus (`au` au plus tard 92 jours après `du`), sinon `422 donnees_invalides`.

#### Règle de découpage

L'application doit l'appliquer à la lettre, sur la page qu'elle montre comme sur chaque demande reçue.

1. **Créneau.** Un créneau de la prestation `s` avec la praticienne `p` commence à une heure `h`, multiple de `pas` minutes depuis minuit, telle que `[h, h + durée(s))` tient entièrement dans une plage de `p`, et `p` pratique `s` (elle la cite dans l'offre).
2. **Délai et horizon.** Le début est au moins `delai_minimal` minutes après l'instant présent, la minute entamée comptant comme écoulée, dans le fuseau de l'institut. La date est entre `du` et `au`.
3. **Demandes reçues.** L'application tient compte de ses propres demandes de créneau :
   - une demande est **intégrée** si lama l'a accusée au plus tard à `genere_le` : les plages en tiennent déjà compte ;
   - une demande non intégrée, sans décision ou acceptée, **retire aussitôt** son intervalle des plages de sa praticienne ;
   - une demande intégrée avec praticienne, puis refusée ou déplacée (`refusee`, `autre_horaire`) après `genere_le`, **rend** son intervalle à sa praticienne, jusqu'à la publication suivante. Une demande « sans préférence » intégrée puis refusée ne rend rien avant la publication suivante (l'application ne sait pas quelle praticienne lama avait retenue).
4. **Capacité « Sans préférence ».** Les demandes « sans préférence » non intégrées, sans décision ou acceptées, ne retirent rien d'une plage précise mais occupent une praticienne. Pour examiner un créneau `[h, h + durée)`, on forme sa **composante connexe** : la nouvelle demande, les demandes « sans préférence » retenues du même jour qui la chevauchent, celles qui chevauchent ces dernières, et ainsi de suite. Le créneau est proposé (avec ou sans praticienne) seulement s'il existe une **affectation** de chaque demande de cette composante à une praticienne qui pratique sa prestation et est libre sur tout son intervalle, deux demandes affectées à la même praticienne ne se chevauchant jamais. Le relais de référence cherche cette affectation exactement, par retour arrière. Une composante de plus de 12 demandes, ou une recherche qui épuise son budget d'essais, fait refuser le créneau. Une demande retenue qui n'a plus aucune praticienne possible (plages republiées sans elle) est ignorée : lama arbitre. Dans le doute, le créneau est refusé : la règle ne réserve jamais deux fois la même praticienne.
5. **Fraîcheur.** Si les plages ont été générées il y a plus de 2 heures (`genere_le`), ou s'il n'y en a pas, l'application ne propose plus aucun créneau et passe en mode « rappel seulement » : seules les demandes de rappel sont reçues.

### Demandes

L'application reçoit les demandes des clientes par ses propres moyens (page, formulaire). Avant d'en enregistrer une, elle la contrôle et la refuse avec l'un de ces codes :

| Code | Cas |
|---|---|
| `ferme` | offre absente ou vide |
| `inconnue` | prestation absente de l'offre, ou praticienne absente ou qui ne pratique pas la prestation |
| `rappel_seulement` | demande de créneau alors que les plages sont absentes ou de plus de 2 heures |
| `indisponible` | créneau qui ne respecte pas la règle de découpage ou la capacité |

Forme d'une demande relevée par lama (`GET /demandes`) :

```json
{
  "id": "d_7Kq2…", "curseur": "000000000123", "type": "creneau", "recue_le": 1792170060000,
  "prestation": "s12", "praticienne": "p3", "date": "2026-10-20", "heure": "10:00",
  "souhait": null,
  "cliente": { "prenom": "Mireille", "nom": "Mireille Ngo", "telephone": "+237699123456", "langue": "fr" },
  "note": "", "acompte": null
}
```

- `id` est unique et stable : lama ne crée jamais deux fois la même demande.
- `curseur` est opaque pour lama, croissant dans l'ordre d'arrivée. Il est numéroté sur tout le relais, tous salons confondus : les trous entre deux curseurs d'un salon trahissent le volume des autres salons, ce qui est sans conséquence. Lama ne lit jamais un curseur comme un compte.
- `type` : `creneau` (date et heure demandées) ou `rappel` (date et heure nulles, `souhait` rempli).
- `praticienne` vaut `null` pour « Sans préférence ».
- `souhait` (rappel seulement) : `{ "jours": ["lun", "sam"], "moments": ["matin", "apres_midi", "soir"], "precision": "texte libre" }`.
- `telephone` au format international E.164 ; `langue` vaut `fr` ou `en`.
- `cliente.prenom` (facultatif, ajout du 18/10/2026) : prénom saisi à part, 60 caractères au plus, d'une seule ligne (lettres, espaces simples, apostrophe, trait d'union, point en fin de mot ; trois mots au plus). Le relais refuse une autre forme ; lama l'ignore sans refuser la demande (le message commence alors par « Bonjour, »). `cliente.nom` reste le nom complet, prénom compris. Sans `prenom` (application plus ancienne, ou demande déposée avant la mise à jour), lama ne devine aucun prénom et écrit ses messages sans lui (« Bonjour, »).
- `cliente.nom` (précision du 18/10/2026) : une seule ligne de 120 caractères au plus, de 1 à 8 mots séparés par une espace simple, faits de lettres, d'apostrophe, de trait d'union et d'un point en fin de mot (ni chiffre, ni adresse web, ni caractère de contrôle). Le relais refuse une autre forme par un 422. lama ne refuse jamais une demande pour son nom : il le nettoie (espaces et sauts de ligne ramenés à une espace, caractères cachés retirés, 120 caractères) et, s'il sort de la forme, laisse `{nom}` vide dans les messages de l'institut.
- `acompte` est réservé, toujours `null` en `v1`.

**Relevé.** Une demande n'est listée qu'une fois contrôlée par l'application (créneau revérifié après enregistrement, pour que deux envois simultanés ne prennent pas le même créneau). Tant qu'une demande très récente n'est pas contrôlée, `GET /demandes` peut retenir aussi les demandes arrivées après elle : elles viennent au relevé suivant, dans l'ordre. Lama ne saute donc jamais de curseur : il repasse le curseur de la dernière demande reçue, et rien d'autre.

**Accusé.** Après `POST /demandes/{id}/accuse`, l'application ne renvoie plus la demande et **efface le nom, le téléphone et la note** de la cliente : il ne reste que l'état, pour la page de suivi. L'accusé est idempotent. Un accusé ou une décision sur un identifiant inconnu, ou sur une demande que l'application a retirée entre-temps, rend `404 introuvable` : ce n'est pas une erreur fatale pour lama, qui passe à la demande suivante.

### Décision (`POST /demandes/{id}/decision`)

```json
{ "decision": "autre_horaire", "horaire": { "date": "2026-10-21", "heure": "11:00", "praticienne": "Awa" },
  "message": { "fr": "Nous vous proposons mercredi à 11:00.", "en": "We can offer Wednesday at 11:00." } }
```

- `decision` : `acceptee`, `autre_horaire` (`horaire` obligatoire), `refusee` ou `traitee` (demande de rappel close).
- `horaire` et `message` sont facultatifs dans les autres cas.
- `issue` (facultatif, ajout du 18/10/2026, avec `traitee`) : `rdv_pris`, `injoignable` ou `sans_suite`. Avec `sans_suite`, la page de suivi dit « Votre demande est close » ; avec les autres issues, ou sans `issue` (lama plus ancien), elle dit « L'institut vous a contactée ». Une application qui ne connaît pas ce champ l'ignore.
- La même décision rendue deux fois ne change rien ; une décision différente remplace la précédente.
- La cliente voit la décision sur sa page de suivi. `refusee` et `autre_horaire` rendent le créneau d'origine (règle 3).
- Le champ `annulation` est réservé pour une version future.

## Données personnelles

- Nom, téléphone et note de la cliente sont effacés dès l'accusé de lama.
- Une demande jamais relevée est effacée au bout de 30 jours ; une demande décidée, 30 jours après la décision ; une demande relevée mais jamais décidée, 30 jours après la date de son créneau (pour un rappel, après sa réception).
- La page de suivi n'affiche que la prestation, l'horaire demandé et l'état, jamais le nom ni le téléphone, derrière un lien impossible à deviner.

## Mode essai et outil de vérification

Un salon est en mode essai quand l'exploitant de l'application l'a réglé ainsi (`mode_essai` vaut alors vrai dans `GET /etat`). Pour un salon en mode essai seulement, deux routes signées sont ouvertes ; pour un salon en service, elles rendent `404 introuvable` :

- `POST /essai/demande` : dépose une demande comme le ferait une cliente (même forme que ci-dessus, sans `id`, `curseur`, `recue_le` ni `acompte`). Réponse : `201 { "id": …, "jeton": … }`, ou `409` avec le code de refus.
- `GET /essai/demande/{id}` : `{ "id", "cliente", "note", "accusee_le", "decision" }`, pour contrôler l'effacement.

Un salon en mode essai est aussi servi au public comme un salon actif, ce qui permet d'essayer sa page. **Toujours vérifier sur un salon d'essai dédié**, créé pour cela : ne jamais passer en mode essai un salon en service, même un instant. L'outil de vérification refuse toutes ses demandes en attente et publie une offre d'essai à la place de la sienne.

L'outil de lama joue tout le contrat contre un salon en mode essai et s'arrête au premier écart :

```
cli verifier-relais https://reserver.exemple.com salon-essai < fichier-de-la-cle
```

- **Clé.** La clé partagée du salon est lue sur l'entrée standard, jamais en argument (elle se verrait dans la liste des processus). Elle doit être de 64 caractères hexadécimaux minuscules.
- **Déroulement.** 28 points, chacun affiché avec son résultat. Le deuxième point exige `mode_essai` vrai : si le salon n'est pas en mode essai, l'outil s'arrête là, sans avoir rien écrit (ni offre, ni plages, ni décision). L'outil contrôle ensuite le refus d'une signature fausse, d'un horodatage décalé et d'une signature rejouée (le même appel envoyé deux fois), solde les demandes en attente de ce salon, publie une offre d'essai puis la même avec un thème et des horaires, rejoue les règles, puis termine par une offre vide. Il ne touche jamais aux autres salons de l'application.
- **Délai.** Chaque appel est abandonné au bout de 15 secondes : l'application qui ne répond pas fait échouer le point en cours.
- **Langue.** Les messages sont en français ou en anglais selon `LAMA_LANGUE` (`fr` ou `en`), à défaut selon `LANG`.
- **Codes de sortie.**

| Code | Sens |
|---|---|
| 0 | conforme au contrat v1 |
| 1 | clé absente ou invalide (ni 64 caractères hexadécimaux minuscules), mauvais usage de la commande (nombre d'arguments) ou erreur inattendue |
| 2 | non conforme (un point a échoué, ou le salon n'est pas en mode essai) |
| 3 | adresse invalide (une adresse `http` ou `https` est attendue) |
