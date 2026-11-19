# Guide de l'administrateur

Ce guide se complète rubrique par rubrique. Les gestes du technicien (installation, disque de sauvegarde, mise à jour à la main) sont dans `deploy/LISEZMOI.md`.

## Mise à jour

Réglages, « Mise à jour ».

- Version installée : la version de lama du serveur de l'institut et sa date d'installation.
- Version disponible : la dernière version publiée, sa date et « Ce qui change » ; sinon « lama est à jour. ». lama vérifie seul une fois par jour ; « Vérifier maintenant » le fait tout de suite. Sans internet, la rubrique affiche « Impossible de joindre le serveur des versions » et rien ne change.
- « Mettre à jour vers X.Y.Z » : de préférence hors des heures d'ouverture. Cocher la case, appuyer sur le bouton, retaper son mot de passe. Une sauvegarde est faite d'abord ; tous les écrans affichent « Maintenance en cours » quelques minutes, puis se rechargent sur la nouvelle version. En cas d'échec, lama revient seul à la version installée, base comprise, et la rubrique dit le motif et ce qu'il faut faire.
- Mode : « Manuel » (par défaut, une pastille rouge sur Réglages signale une nouvelle version) ou « Automatique la nuit (3 h 30) ».
- Dernière opération : date, version, résultat et motif. Chaque demande, réussite, échec et changement de mode est inscrit au journal des accès.

La gérante voit la version installée et la version disponible, sans rien pouvoir changer. Les autres comptes ne voient pas la rubrique.

Bouton absent avec la phrase « La mise à jour depuis l'application n'est pas encore posée sur ce serveur » : le technicien fait une première mise à jour à la main. « Version de développement » : les mises à jour se font à la main.

## Import

Réglages, « Import ». Gérante et administrateur. Quatre imports : « Catalogue des prestations », « Clientes », « Produits et stock », « Rendez-vous à venir ».

1. « Télécharger le modèle » : un fichier avec les bonnes colonnes et une ligne d'exemple. Il s'ouvre dans Excel.
2. Remplir une ligne par prestation, cliente, produit ou rendez-vous, puis supprimer la ligne d'exemple (lama la refuse).
3. Enregistrer le fichier. Deux formats sont acceptés :
   - classeur Excel (.xlsx), déposé tel quel : seule la première feuille est lue ; les dates et les heures sont reconnues, et un montant affiché « 15 000 FCFA » est lu 15000 ;
   - « CSV UTF-8 », pour un autre tableur.
   Un ancien classeur .xls s'enregistre d'abord en .xlsx : « Fichier », « Enregistrer sous », « Classeur Excel (.xlsx) ».
4. « Choisir un fichier » : lama affiche l'aperçu, « Aperçu, rien n'est encore écrit » : lignes lues, ajouts, mises à jour, lignes refusées avec leur numéro dans le tableur et le motif.
5. Corriger les lignes refusées dans le fichier, l'enregistrer, puis le déposer de nouveau. « Importer » reste grisé tant qu'une ligne est refusée.
6. « Importer » : tout est écrit d'un coup, ou rien. Chaque import est inscrit au journal des accès.

Les colonnes se reconnaissent à leur nom sur la première ligne, dans n'importe quel ordre, sans tenir compte des accents ni des majuscules. Ce que fait chaque import :

- Catalogue : une prestation est reconnue par son univers et son nom, mise à jour ou ajoutée. La case « Désactiver les prestations absentes du fichier » les désactive sans les supprimer.
- Clientes : reconnues par leur téléphone. Une fiche existante est seulement complétée, jamais écrasée. L'anniversaire s'écrit JJ-MM ; une date complète (date de naissance, ou « 14-02 » changé en date par Excel) est réduite au jour et au mois.
- Produits : reconnus par leur référence, sinon par leur nom. Un stock renseigné remplace le stock, et chaque changement est noté au journal.
- Rendez-vous : seulement à venir, confirmés, sans message à la cliente ; une cliente inconnue est créée avec le nom et le téléphone de la ligne.

Montants sans espace ni symbole dans un CSV (15000). Pour une devise à centimes (euro), les montants s'écrivent en centimes : 1500 pour 15,00 €.
