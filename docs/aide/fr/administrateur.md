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
