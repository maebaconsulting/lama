# Publier une version de lama

Guide de l'éditeur de lama. Une version publiée porte un numéro `X.Y.Z`, est fabriquée et signée par le travail GitHub « Publier une version » du dépôt public, puis proposée à chaque institut dans Réglages, « Mise à jour ».

## Avant la première version

1. Clé de signature Ed25519, faite une fois sur le poste de l'éditeur, hors de tout dépôt :

```bash
install -d -m 0700 ~/.config/lama/signature
openssl genpkey -algorithm ed25519 -out ~/.config/lama/signature/lama-signature-privee.pem
chmod 0600 ~/.config/lama/signature/lama-signature-privee.pem
openssl pkey -in ~/.config/lama/signature/lama-signature-privee.pem -pubout -out deploy/cle-publique.pem
```

2. Garder deux copies de la clé privée hors ligne (deux clés USB rangées à deux endroits). Elle n'entre jamais dans un dépôt, un courriel ou une messagerie. Seule `deploy/cle-publique.pem` est enregistrée dans le dépôt, avec `deploy/cle-publique-precedente.pem` le temps d'un changement de clé (plus bas).
3. Sur le dépôt public, dans les réglages GitHub : secret `LAMA_CLE_SIGNATURE` (tout le contenu du fichier de la clé privée, lignes `BEGIN` et `END` comprises) et variable `LAMA_PUBLICATION` à `oui`. Sans cette variable, le travail ne fait rien.

## Publier

1. Dans `package.json`, passer `version` au nouveau numéro (`1.4.0` par exemple), enregistrer, puis exporter le dépôt public comme d'habitude.
2. Écrire la note « Ce qui change » : le français, une ligne `---en---`, puis l'anglais. Phrases courtes, pour l'institut.

```text
Agenda plus rapide sur tablette.
---en---
Faster calendar on tablets.
```

3. Dans le dépôt public, poser une étiquette annotée avec cette note, puis l'envoyer :

```bash
git tag -a v1.4.0 -F note.txt
git push origin v1.4.0
```

4. Le travail contrôle l'étiquette (`vX.Y.Z`, égale à `package.json`) et la note, lance les essais et tsc, fabrique l'archive, écrit `SHA256SUMS` (archive et note), le signe, vérifie la signature avec `deploy/cle-publique.pem` (avec `deploy/cle-publique-precedente.pem` quand ce fichier est présent, pendant un changement de clé) et publie la release avec `lama-X.Y.Z.tar.gz`, `NOTES.md`, `SHA256SUMS` et `SHA256SUMS.sig`. Au moindre écart, il s'arrête sans rien publier.
5. En cas d'échec, corriger la cause, puis supprimer l'étiquette avant de la reposer : `git push --delete origin v1.4.0` et `git tag -d v1.4.0`.

L'étiquette `v0.0.1-essai` sert d'essai à blanc : elle ne correspond pas à `package.json`, le travail échoue à son premier contrôle et rien n'est publié.

## Changer de clé

1. Faire une nouvelle paire comme plus haut, sans toucher au secret.
2. Copier la clé publique actuelle `deploy/cle-publique.pem` vers `deploy/cle-publique-precedente.pem`, mettre la nouvelle clé publique dans `deploy/cle-publique.pem`, puis publier une version N, encore signée par l'ancienne clé privée (le secret n'a pas changé). La présence de `deploy/cle-publique-precedente.pem` dit au travail de vérifier la signature avec l'ancienne clé ; les instituts, eux, reçoivent la nouvelle clé avec la version N.
3. Tant que `deploy/cle-publique-precedente.pem` est dans le dépôt et que le secret est l'ancienne clé, ne rien publier d'autre que cette version N. Une version N+1 publiée ainsi serait signée par l'ancienne clé, et les instituts déjà passés à N (qui ne connaissent plus que la nouvelle) la refuseraient.
4. Attendre que chaque institut soit passé à la version N (Réglages, « Mise à jour », version installée). Un institut resté avant N refuserait une version signée par la nouvelle clé.
5. Un serveur sans clé en service (installé avant la mise à jour par le réseau) et mis à jour à la main vers N prend la clé de l'archive, la nouvelle, alors que N est signée par l'ancienne : `mettre-a-jour.sh` la refuse. Le technicien passe alors par l'empreinte de l'archive donnée par l'éditeur par un autre canal que GitHub et `sudo ./deploy/mettre-a-jour.sh --sans-signature`, comme pour une clé perdue (plus bas).
6. Remplacer alors le secret `LAMA_CLE_SIGNATURE` par la nouvelle clé privée et supprimer `deploy/cle-publique-precedente.pem` du dépôt, avant de publier la version suivante, signée par la nouvelle clé.

## Clé perdue

Sans la clé privée, plus aucune version ne peut être proposée par l'application. Faire une nouvelle paire et publier la version suivante signée par elle. Chez chaque institut, le technicien l'installe à la main avec `sudo ./deploy/mettre-a-jour.sh --sans-signature`, mais seulement après avoir reçu de l'éditeur l'empreinte de l'archive par un autre canal que GitHub (téléphone, message à chaque technicien) et l'avoir comparée au résultat de `sha256sum lama-X.Y.Z.tar.gz`. Comparer avec le `SHA256SUMS` de la release n'authentifie rien : il vient de la même source que l'archive. La version installée porte la nouvelle clé ; les suivantes repassent par l'application.
