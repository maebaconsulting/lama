# lama, procédures du serveur

Ce document s'adresse au technicien (compte administrateur). Le serveur est un mini-PC sous Ubuntu Server 24.04, posé dans l'institut, relié au Wi-Fi par câble. L'équipe ouvre l'application à l'adresse https://lama.local depuis n'importe quel appareil du Wi-Fi, une fois le certificat de l'institut approuvé sur cet appareil (voir « Certificat HTTPS »). English version : [README.md](README.md).

## Langue des scripts

Les scripts parlent la langue du terminal : anglais si la variable `LANG` commence par `en`, français sinon (`sudo` garde `LANG` sur Ubuntu). Pour la forcer, la placer devant la commande, par exemple `sudo LAMA_LANGUE=en ./deploy/installer.sh` ou `sudo LAMA_LANGUE=fr ./deploy/installer.sh`. Les mots à taper pour confirmer suivent la langue : `OUI` et `EFFACER` en français, `YES` et `ERASE` en anglais.

L'application, elle, suit la langue de chaque compte : chacun la choisit avec le bouton FR / EN en bas du menu latéral, ou dans Réglages, Mon compte.

## Installer

1. Installer Ubuntu Server 24.04, ou Ubuntu 24.04 ou 26.04 en version bureau, sur le mini-PC (compte de maintenance au choix, SSH activé : sur la version bureau, `sudo apt install openssh-server`). Le brancher au routeur par câble. Sur la version bureau, l'installation coupe la mise en veille.
2. **En une commande, depuis le dépôt public** (le mini-PC doit avoir accès à internet). Sur le serveur, dans un terminal (une session SSH interactive convient) :

```bash
curl -fsSL https://raw.githubusercontent.com/maebaconsulting/lama/main/deploy/installer-en-ligne.sh -o installer-en-ligne.sh
sudo bash installer-en-ligne.sh
```

   Le script pose Git et Node 24, télécharge le dépôt, fabrique le paquet, puis lance `deploy/installer.sh` depuis le dossier extrait, gardé dans `/var/lib/lama-installation`. Pour choisir le mode d'emblée : `sudo bash installer-en-ligne.sh --auto` ou `--assiste`. Ne pas envoyer le script à sudo par un tube (`curl … | sudo bash`) : sur Ubuntu 26.04, le clavier ne lui parvient plus et il le refuse. Passer ensuite directement au point 4.

   **Ou, à partir d'une archive.** Sur le poste de développement, fabriquer l'archive avec `pnpm paquet`, puis la copier sur le serveur (`scp paquets/lama-….tar.gz technicien@adresse:`).
3. Sur le serveur, dans un terminal (une session SSH interactive convient) :

```bash
tar -xzf lama-*.tar.gz
cd lama-*/
sudo ./deploy/installer.sh
```

Au lancement, le script propose deux modes :

- **Automatique** (`sudo ./deploy/installer.sh --auto`) : réglages par défaut, aucune question. Fuseau Africa/Douala, WhatsApp installé, mise en veille coupée sur Ubuntu bureau, disque de sauvegarde pris seulement s'il est déjà préparé, base de formation et Google Drive laissés pour plus tard.
- **Assistée** (`sudo ./deploy/installer.sh --assiste`) : une question à chaque choix (langue, fuseau horaire, heure exacte, mise en veille, préparation d'un disque USB neuf, WhatsApp, base de formation, Google Drive). La réponse par défaut est entre crochets ; Entrée seule la prend.

Dans les deux modes, l'installation s'arrête sur les clés de secours et attend OUI.

L'installation doit se lancer dans un vrai terminal : le script refuse de continuer sinon, car les clés de secours (voir plus bas) ne s'affichent qu'à l'écran, une seule fois.

4. Le script installe d'abord les paquets du système (Node 24, age, rclone, avahi, openssl, polkit, systemd-timesyncd) et crée le compte de service `lama`. Il affiche ensuite les clés de secours et attend la confirmation OUI avant d'écrire quoi que ce soit sur le disque : ce n'est qu'après cette confirmation qu'il installe le programme dans `/opt/lama`, fabrique le certificat HTTPS pour `lama.local` et l'adresse IP actuelle du serveur (voir « Certificat HTTPS »), prépare le disque de sauvegarde s'il est branché, puis installe et démarre les services. L'horloge du serveur doit être juste avant de lancer l'installation : vérifier avec `date`, corriger au besoin avec `sudo timedatectl set-time 'AAAA-MM-JJ HH:MM:SS'`.
5. Depuis un appareil du Wi-Fi, ouvrir http://lama.local/certificat, approuver le certificat, puis ouvrir https://lama.local : l'écran d'installation crée le compte administrateur et choisit la devise ; elle reste modifiable dans Réglages, Caisse, rubrique Devise, jusqu'à la première vente. Se connecter, puis créer le compte de la gérante dans Réglages, Équipe et comptes. La gérante saisit ensuite le nom de l'institut dans Réglages, Institut : il figure en tête des tickets et des clôtures (laissé vide, il n'est pas imprimé).

Le script peut être relancé sans risque avec la même version, depuis une archive fraîchement extraite ailleurs que dans `/opt/lama` : il garde les données, les clés et les réglages déjà en place, et n'affiche pas de nouvelles clés. Avec une archive d'une autre version, il refuse et renvoie vers `mettre-a-jour.sh` (voir « Mettre à jour »), qui sauvegarde d'abord et revient en arrière en cas d'échec. Il refuse aussi de se relancer depuis `/opt/lama` lui-même ; copier l'archive ailleurs avant de relancer.

## Clés de secours

L'installation affiche deux clés, une seule fois, avant d'installer le programme et les services : rien n'est enregistré tant que OUI n'a pas été tapé. Les imprimer ou les recopier, puis les ranger hors de l'institut. Après OUI, le script efface l'écran et son défilement ; si le terminal ou le logiciel SSH enregistre la session (journal, historique de défilement sauvegardé), effacer aussi cet enregistrement.

- La clé maîtresse chiffre les secrets des réglages (jetons WhatsApp, paiements). Elle reste aussi sur le serveur, dans `/etc/lama/master.key`.
- La clé privée des sauvegardes est la seule à pouvoir relire une sauvegarde. Elle n'est jamais écrite sur le serveur : un voleur du mini-PC ou du disque USB ne peut rien relire.

Sans la clé privée, aucune sauvegarde ne peut être restaurée. Si l'installation est interrompue avant d'avoir tapé OUI, rien n'a été enregistré : il faut relancer le script, qui affichera de nouvelles clés, et jeter celles qui viennent d'être affichées.

## Certificat HTTPS

lama sert l'application en https avec un certificat propre à l'institut. L'installation fabrique une autorité de certification (valable 10 ans, clé privée dans `/etc/lama/tls/autorite.key`, lisible par root seul) et le certificat du serveur pour `lama.local` et l'adresse IP fixe (valable 397 jours). L'autorité ne vaut que pour `lama.local` et les adresses des réseaux locaux : même copiée, elle ne permet d'imiter aucun autre site.

1. Réserver dans la box l'adresse IP du serveur, affichée par l'installation : elle figure dans le certificat.
2. Sur chaque appareil (tablette, téléphone, ordinateur), ouvrir http://lama.local/certificat (ou http://192.168.x.y/certificat). La page reconnaît l'appareil, propose le bon fichier (profil pour iPhone et iPad, certificat pour Android, Windows et Mac) et donne les étapes. Comparer l'empreinte de l'autorité affichée sur l'appareil à celle qu'a imprimée l'installateur (ou que donne `sudo lama-certificat --etat` sur le serveur) : l'autorité est distribuée en http simple, et seule cette comparaison prouve qu'elle n'a pas été remplacée en route.
3. Toucher « Vérifier la connexion sécurisée » : la page confirme. Ouvrir ensuite https://lama.local, puis installer lama sur l'écran d'accueil de l'appareil (voir « Installer lama sur l'écran d'accueil »).

Sur le serveur lui-même (Ubuntu bureau), rien à faire : l'installation et la mise à jour y approuvent l'autorité, pour le système et pour Firefox (règle `/etc/firefox/policies/policies.json`, complétée sans être écrasée). Firefox déjà ouvert doit être relancé une fois.

Le port 80 ne sert que cette page et ses fichiers : toute autre adresse en http renvoie vers https. Le certificat du serveur se renouvelle seul (tâche `lama-certificat.timer`, le 1er de chaque mois, quand il reste moins de 90 jours), sans redémarrer lama et sans rien refaire sur les appareils.

Les appareils qui passent au https gardent leur session et leur déclaration seulement dans les 30 jours suivant le premier démarrage en https : passé ce délai, il faut se reconnecter et déclarer de nouveau l'appareil.

- Adresse IP du serveur changée : `sudo lama-certificat --adresse 192.168.1.60` (même autorité, les appareils n'ont rien à refaire).
- État : `sudo lama-certificat --etat`. Renouvellement immédiat : `sudo lama-certificat --renouveler --forcer` (par exemple après avoir corrigé une horloge fausse au moment de l'installation).
- Sans certificat lisible, lama démarre en http seul et le journal le dit (`journalctl -u lama -n 50`).

## Installer lama sur l'écran d'accueil

Une fois le certificat approuvé, installer lama sur l'écran d'accueil de chaque tablette et de chaque téléphone de l'institut : il s'ouvre alors en plein écran, sans barre du navigateur, et démarre plus vite. Serveur coupé, il s'ouvre encore et dit « Serveur injoignable » ; rien n'est saisi ni enregistré hors ligne.

- iPhone et iPad : dans Safari, ouvrir https://lama.local, toucher « Partager » (le carré d'où sort une flèche), puis « Sur l'écran d'accueil », puis « Ajouter ».
- Android : dans Chrome, ouvrir https://lama.local, puis toucher « Installer » dans le bandeau de lama (ou, dans le menu de Chrome, « Installer l'application »).
- Ordinateur (Chrome ou Edge) : icône d'installation au bout de la barre d'adresse.

Sur iPhone et iPad, l'application installée garde sa propre connexion, séparée de Safari : il faut s'y reconnecter, et un poste partagé déclaré dans Safari doit être déclaré à nouveau dans l'application installée.

Dans lama, l'entrée « Installer lama sur cet appareil » (dans le rail, ou dans « Plus » sur téléphone) fait la même chose, pour tous les rôles ; elle disparaît une fois lama installé, et n'est pas proposée tant que le certificat n'est pas approuvé.

Après une mise à jour du serveur, lama affiche « Nouvelle version disponible : Recharger » : toucher « Recharger » quand aucune saisie n'est en cours. Sans cela, la nouvelle version est prise au prochain lancement.

## Heure du serveur

L'heure du serveur date les factures, les avoirs et les reçus. `systemd-timesyncd` la règle seul quand internet passe. L'écran de l'administrateur et de la gérante signale un écart de plus de 2 minutes avec l'appareil. L'administrateur la corrige dans Réglages, Heure (mot de passe demandé) : « Mettre le serveur à l'heure de cet appareil », ou heure saisie. Si l'heure du serveur est antérieure de plus d'une minute à la dernière facture, ventes, avoirs et acomptes sont refusés jusqu'à la correction.

La règle `/etc/polkit-1/rules.d/50-lama-heure.rules`, posée par l'installation, permet ce réglage au compte `lama`, et à lui seul. Sans elle, l'écran dit que l'autorisation manque : relancer `sudo ./deploy/installer.sh`, ou régler l'heure avec `sudo timedatectl set-time 'AAAA-MM-JJ HH:MM:SS'`.

## Disque de sauvegarde

Un disque USB dédié reçoit une sauvegarde chiffrée chaque nuit à 2 h : 30 quotidiennes et 12 mensuelles.

Pour le préparer (le disque est effacé) :

```bash
lsblk                      # repérer le disque USB, par exemple /dev/sdb
sudo /opt/lama/actuelle/deploy/preparer-disque.sh /dev/sdb
```

Le script refuse tout disque qui porte le système (y compris un volume géré par LVM ou un disque chiffré), toute partition indiquée à la place d'un disque entier, et abandonne par précaution si le disque système n'a pas pu être identifié ; il demande ensuite de taper EFFACER. Le disque est ensuite monté seul à chaque branchement. S'il est débranché la nuit de la sauvegarde, l'échec est enregistré, un bandeau d'alerte apparaît après 36 heures, et la copie vers Google Drive part quand même.

## Google Drive

Une copie de chaque sauvegarde part vers Google Drive, avec un nouvel essai automatique tant qu'internet manque. Les quotidiennes de moins de 15 jours et les mensuelles de moins de 366 jours y sont gardées, les plus anciennes sont purgées automatiquement.

1. Sur le serveur :

```bash
sudo /opt/lama/actuelle/deploy/configurer-drive.sh
```

2. Suivre les instructions : sur un ordinateur qui a un navigateur et rclone, lancer `rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"` (portée limitée aux fichiers créés par l'application), se connecter avec le compte Google de l'institut, puis coller sur le serveur tout le bloc de texte affiché entre les deux lignes de flèches (il ne s'affiche pas pendant la saisie). Le script vérifie l'autorisation auprès de Google ; en cas de refus, le relancer et refaire `rclone authorize`.
3. Dans l'application, Réglages, Connexions : enregistrer la destination `gdrive:lama`.

## WhatsApp

L'installation pose aussi la passerelle WhatsApp WAHA : Docker d'Ubuntu, puis un conteneur `lama-waha` (moteur GOWS) joignable seulement depuis le serveur (127.0.0.1, port 3000), relancé automatiquement, avec la session du téléphone gardée dans le volume `lama-waha-sessions`. Sa clé est créée dans `/etc/lama/waha.env` (lisible par root seul), gardée d'une installation à l'autre et inscrite dans les réglages de l'application. La version de WAHA est celle de `deploy/waha.version` dans l'archive : `mettre-a-jour.sh` passe à la version de la nouvelle archive, une fois celle-ci en service.

1. Dans l'application, Réglages, WhatsApp : choisir WAHA comme fournisseur.
2. Scanner le QR code avec le téléphone de l'institut (WhatsApp, Appareils connectés).

Si l'étape WhatsApp échoue (pas d'internet, image introuvable), l'application reste en service sans envoi automatique : régler le problème puis relancer `sudo ./deploy/installer.sh` depuis le dossier de la version en service. État du conteneur : `sudo docker ps`, journal : `sudo docker logs lama-waha`.

## Imprimante de tickets

lama imprime directement les tickets sur une imprimante thermique de 80 mm branchée au réseau de l'institut (ESC/POS, port 9100), par exemple une NETUM NS-8360LW.

1. Brancher l'imprimante au routeur par un câble réseau. Pour connaître son adresse, l'allumer en tenant le bouton FEED : elle imprime sa page de configuration.
2. Dans le routeur, réserver cette adresse à l'imprimante (réservation DHCP), pour qu'elle ne change pas.
3. Dans l'application, Réglages, Caisse, bloc « Imprimante de tickets » : saisir l'adresse, enregistrer, puis « Imprimer un test ».

Le tiroir-caisse se branche sur l'imprimante ; il ne s'ouvre que par le bouton « Ouvrir le tiroir » de la caisse du jour.

## Téléphone passerelle SMS

lama envoie les SMS par un téléphone Android de l'institut (Android 5.0 ou plus), avec l'application libre SMS Gateway for Android. Le téléphone envoie par le réseau mobile : les SMS partent même sans internet.

1. Téléphone dédié, avec une carte SIM qui a un forfait SMS. Le laisser branché sur son chargeur en permanence.
2. Installer l'application SMS Gateway for Android (https://github.com/capcom6/android-sms-gateway, ou sa page sur le Play Store) et lui donner le droit d'envoyer des SMS.
3. Dans l'application, activer le « serveur local » (Local server) et noter l'adresse affichée (par exemple 192.168.1.60:8080), l'identifiant et le mot de passe.
4. Dans la box, réserver cette adresse IP au téléphone, pour qu'elle ne change pas.
5. Dans les réglages d'Android, exclure l'application de l'économie de batterie (sinon Android l'endort et les SMS ne partent plus).
6. Dans lama, en administrateur : Réglages, Connexions, bloc SMS. Choisir « Téléphone Android de l'institut », saisir l'adresse, l'identifiant et le mot de passe, enregistrer. L'état doit dire « Passerelle joignable ».
7. Envoyer un SMS d'essai vers votre propre numéro.

Si l'état dit « Passerelle injoignable » : téléphone éteint, application arrêtée ou endormie, ou adresse changée. S'il dit « Identifiant ou mot de passe refusé » : ressaisir ceux de l'application.

## Base de formation

Une base d'entraînement, facultative, sur le même mini-PC : même programme, même certificat, port 8443, données à part (`/var/lib/lama-formation`). On y apprend sans risque : rien n'en sort (aucun message WhatsApp ni SMS, aucune sauvegarde, heure du serveur jamais réglée), chaque écran porte le bandeau bleu « Base de formation » et chaque ticket, papier ou PDF, porte « FORMATION » (« TRAINING » pour un document en anglais). Dans Réglages, les rubriques Heure et Sauvegardes et la session WhatsApp affichent « Coupé dans la base de formation ». L'imprimante de l'institut reste permise.

1. Installer lama d'abord (sections précédentes, certificat compris), puis lancer la première commande ci-dessous. Elle demande les mots de passe des quatre comptes de formation, deux fois chacun, 10 caractères au moins, différents de ceux de la vraie base : `formation.admin`, `formation.gerante`, `formation.reception` et `formation.praticienne` (reliée à la fiche de Solange Ekambi).
2. Sur chaque appareil dont le certificat est déjà approuvé, ouvrir https://lama.local:8443 (ou https://192.168.1.50:8443, avec l'adresse fixe du serveur) et se connecter avec un compte de formation. On peut l'installer sur l'écran d'accueil à côté de lama : elle s'appelle « lama formation ».

```bash
sudo /opt/lama/actuelle/deploy/lama-formation.sh --installer   # la première fois
sudo lama-formation --etat              # service, adresse et comptes
sudo lama-formation --comptes           # changer les mots de passe, comptes débloqués
sudo lama-formation --remettre-a-zero   # démonstration recréée à neuf, comptes gardés
sudo systemctl disable --now lama-formation   # arrêter la formation, ses données restent
```

Si l'écran de connexion de la formation affiche « Aucun compte de formation », les comptes n'ont pas été créés : lancer `sudo lama-formation --comptes`.

La formation prend la devise de la vraie base (avec la position et l'affichage de son symbole) : `--installer` et `--comptes` la lisent sous le compte `lama`, sans rien y écrire, et la démonstration est semée dans cette devise. Une base de formation qui a déjà des ventes garde la sienne.

La remise à zéro se fait aussi dans l'application : compte `formation.admin`, Réglages, Formation, « Remettre la formation à zéro » (case à cocher, puis mot de passe redemandé). Elle s'applique au redémarrage du service, que systemd relance de lui-même ; chacun se reconnecte. Les quatre comptes de formation sont rétablis (rôle, fiche, nom) et les postes déclarés sont gardés ; tout le reste, comptes créés en séance compris (rendez-vous, ventes, fiches, réglages), est effacé et la démonstration « Institut Démo » revient, avec six mois d'historique. Si la commande annonce qu'aucun compte n'a été gardé, lancer `sudo lama-formation --comptes`. `mettre-a-jour.sh` relance la formation sur la nouvelle version ; elle n'a ni sauvegarde ni clé de secours, ses données sont fictives.

## Mettre à jour

### Depuis l'application

Une fois le mécanisme posé (installation, ou première mise à jour faite à la main ci-dessous sur un serveur installé avant), l'administrateur met lama à jour sans terminal : Réglages, « Mise à jour », « Vérifier maintenant », puis « Mettre à jour vers X.Y.Z » (case à cocher, mot de passe redemandé). Le mode « Automatique la nuit (3 h 30) » fait la même chose chaque nuit, sans personne.

Seules les versions publiées et signées par l'éditeur de lama sont proposées. Le service `lama-mise-a-jour` (root, lancé par l'application ou par la minuterie de nuit) télécharge la version depuis GitHub, vérifie sa signature avec la clé de la version en service puis ses empreintes, et lance `mettre-a-jour.sh` de la nouvelle version : sauvegarde, installation, redémarrage, contrôle et retour arrière, comme à la main. Pendant le redémarrage, tous les écrans affichent « Maintenance en cours ». La rubrique dit l'étape en cours, puis le résultat et, en cas d'échec, son motif. Le service s'arrête de lui-même au bout de 4 h au plus.

Journal du service : `journalctl -u lama-mise-a-jour -n 100`. État de la dernière opération : `/var/lib/lama/mise-a-jour/etat.json`.

Recette sur un dépôt d'essai seulement : le fichier de root `/etc/lama/mise-a-jour.conf`, absent en temps normal, désigne un autre dépôt GitHub par une ligne `DEPOT=propriétaire/nom` ; l'application et le service le lisent tous deux.

### À la main

Pour la première mise à jour d'un serveur installé avant la mise à jour par l'application (elle pose le mécanisme), pour un serveur sans internet, ou pour un paquet de développement.

1. Copier dans un même dossier du serveur les quatre fichiers de la version, pris sur la page des versions de lama sur GitHub : `lama-X.Y.Z.tar.gz`, `NOTES.md`, `SHA256SUMS` et `SHA256SUMS.sig`. Paquet de développement : `pnpm paquet` sur le poste de développement, puis copier l'archive.
2. Sur le serveur, dans ce dossier :

Lancer la mise à jour dans `tmux` (ou `screen`) : si la session SSH est coupée en cours de route, le script continue et l'on retrouve son affichage avec `tmux attach`. Installer `tmux` une fois pour toutes avec `sudo apt-get install -y tmux` s'il manque.

```bash
tmux
tar -xzf lama-NOUVELLE.tar.gz
cd lama-NOUVELLE/
sudo ./deploy/mettre-a-jour.sh
```

Le script vérifie d'abord l'archive : signature de `SHA256SUMS` par la clé de la version en service, empreintes de l'archive et de la note, puis dossier extrait identique à l'archive (tout lien symbolique dans ce dossier est refusé). Une version X.Y.Z sans ces fichiers est refusée ; un paquet de développement passe avec un avertissement. Un serveur installé avant les versions signées n'a pas encore de clé : lancé à la main, le script prend celle de l'archive et le dit par un avertissement (cela détecte une archive abîmée, pas une archive falsifiée ; comparer son empreinte avec celle de la page des versions n'écarte que l'archive abîmée, puisqu'elle vient de la même source ; pour écarter une archive falsifiée, obtenir l'empreinte de l'archive auprès de l'éditeur par un autre canal, téléphone ou message, et la comparer avec le résultat de `sha256sum lama-X.Y.Z.tar.gz`) ; le service de l'application, lui, refuse toujours dans ce cas, d'où cette première mise à jour à la main. L'option `--sans-signature` est réservée aux essais. Une seule mise à jour à la fois : si une autre est en cours (depuis l'application ou un autre terminal), le script s'arrête et le dit.

Le script sauvegarde ensuite. Si cette sauvegarde échoue seulement à cause du disque USB (absent ou en échec), la mise à jour continue quand même, la copie Google Drive restant en file. Si elle échoue pour toute autre raison, la mise à jour est annulée : rien n'est modifié.

Il installe ensuite la nouvelle version à côté des anciennes, fabrique le certificat HTTPS s'il manque (ou le renouvelle au seuil), redémarre, puis vérifie que l'application répond. Sinon, il revient seul à la version précédente. Si la nouvelle version avait modifié la structure de la base, la copie d'avant la mise à jour est remise en place automatiquement à ce retour arrière ; la base modifiée par la nouvelle version est gardée à côté, sous le nom `lama.db.migree-AAAAMMJJ-HHMMSS` (avec ses fichiers `-wal` et `-shm` éventuels). Seules les versions récentes sont gardées dans `/opt/lama/versions` (les trois dernières installées, ainsi que la version en service et la précédente). Il pose enfin la mise à jour depuis l'application, si elle manque.

### Première mise à jour vers HTTPS

La première mise à jour d'un serveur installé avant le HTTPS fait passer lama en https : dès le redémarrage, chaque appareil affiche un avertissement tant que le certificat de l'institut n'y est pas installé.

1. La faire hors des heures d'ouverture, avec internet si possible : le script installe `openssl`, `polkitd` et `systemd-timesyncd` s'ils manquent. Hors ligne, il continue et dit ce qui manque (sans `openssl`, lama reste en http ; sans `polkitd`, Réglages, Heure est refusé ; sans `systemd-timesyncd`, l'heure ne se règle pas seule).
2. En fin de script, noter l'adresse et l'empreinte de l'autorité affichées.
3. Passer sur chaque appareil (caisse, accueil, tablettes, téléphones) : ouvrir http://lama.local/certificat, installer le certificat, comparer l'empreinte affichée sur l'appareil à celle du script (voir « Certificat HTTPS »), puis fermer les onglets de lama et ouvrir https://lama.local.
4. Le faire dans les 30 jours : les appareils gardent alors leur session et leur déclaration ; passé ce délai, il faut se reconnecter et déclarer de nouveau l'appareil.

## Restaurer une sauvegarde

Depuis l'application (cas normal) : Réglages, Sauvegardes, Restauration. Choisir la sauvegarde, coller la clé privée, confirmer par le mot de passe. Tous les écrans affichent « Maintenance en cours » pendant environ une minute, puis l'application redémarre sur la sauvegarde. La base remplacée est gardée sous le nom avant-restauration-….db.

En ligne de commande, si l'application ne démarre plus (de préférence dans `tmux`, comme pour la mise à jour) :

```bash
sudo /opt/lama/actuelle/deploy/restaurer.sh --lister
sudo /opt/lama/actuelle/deploy/restaurer.sh /mnt/lama-sauvegarde/quotidiennes/lama-AAAAMMJJ-HHMM.db.gz.age
sudo /opt/lama/actuelle/deploy/restaurer.sh --drive lama-AAAAMMJJ-HHMM.db.gz.age
```

L'option --drive lit la destination `gdrive:lama`. Si une autre destination a été enregistrée dans Réglages, Connexions, l'indiquer ainsi : `sudo LAMA_DRIVE=gdrive:AutreDossier /opt/lama/actuelle/deploy/restaurer.sh --drive lama-AAAAMMJJ-HHMM.db.gz.age` (de même avec --lister).

La clé privée est demandée au clavier, sans s'afficher. Si elle est fausse, rien n'est modifié. Le fichier indiqué est lu sous le compte du service, jamais en root : une sauvegarde copiée ailleurs que sur le disque de sauvegarde doit être posée dans `/tmp` et rendue lisible (`chmod 0644`, elle reste chiffrée). L'application est toujours relancée à la fin, même si la restauration est interrompue en cours de route.

## Reprendre après une panne du serveur

1. Installer Ubuntu Server 24.04 sur la nouvelle machine.
2. Avant de lancer l'installation, remettre les deux clés de secours pour garder les mêmes :

```bash
sudo install -d -m 0750 /etc/lama
sudo sh -c 'umask 077; cat > /etc/lama/master.key'        # coller la clé maîtresse, Entrée, puis Ctrl-D
sudo sh -c 'age-keygen -y > /etc/lama/sauvegarde.pub'     # coller la clé privée, Entrée, puis Ctrl-D
```

(installer d'abord `age` avec `sudo apt-get install -y age` si la commande manque.)

3. Lancer, dans un terminal, `sudo ./deploy/installer.sh` depuis l'archive : il garde ces clés et n'en affiche pas de nouvelles.
4. Brancher le disque de sauvegarde, puis relancer `sudo ./deploy/installer.sh` depuis la même archive : il rend au compte de service tout le contenu du disque (le compte `lama` porte toujours le numéro 871, mais un disque venu d'une installation plus ancienne peut appartenir à un autre numéro, et les sauvegardes suivantes y échoueraient). Restaurer ensuite la sauvegarde la plus récente en ligne de commande (voir plus haut). Si le disque est perdu, autoriser Google Drive puis restaurer avec --drive.
5. Se connecter avec un compte de la sauvegarde : ils sont tous revenus avec les données.

## Surveiller

- État du service : `systemctl status lama`
- Journaux : `journalctl -u lama -n 100`
- Prochaine sauvegarde : `systemctl list-timers lama-sauvegarde.timer`
- Certificat : `sudo lama-certificat --etat`, prochain contrôle avec `systemctl list-timers lama-certificat.timer`
- Sauvegarde immédiate : `sudo systemctl start lama-sauvegarde.service`
- Historique et alertes : Réglages, Sauvegardes, dans l'application.

Si https://lama.local ne répond pas depuis un appareil du Wi-Fi :

- avertissement du navigateur : le certificat n'est pas approuvé sur cet appareil, ouvrir http://lama.local/certificat ;

- essayer l'adresse IP du serveur, https://192.168.x.y (donnée par `hostname -I` sur le serveur, ou par la liste des appareils du routeur) ;
- `lama-2.local` ou `lama-3.local` (le certificat ne les couvre pas, passer par l'adresse IP en attendant) : avahi prend un nom suffixé quand il croit le nom déjà pris sur le réseau (autre appareil nommé `lama`, ou annonces du serveur lui-même juste avant un redémarrage) ;
- `journalctl -u avahi-daemon | grep conflict` le confirme, et `sudo systemctl restart avahi-daemon` reprend le nom `lama.local` une fois le conflit levé.

Après une coupure de courant, le serveur redémarre et l'application reprend seule ; une sauvegarde manquée à 2 h est faite au démarrage.
