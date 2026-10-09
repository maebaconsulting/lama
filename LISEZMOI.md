# lama

Rendez-vous et gestion des instituts de beauté, pensée pour l'Afrique. L'application tourne sur un petit serveur posé dans l'institut et s'utilise depuis n'importe quel appareil du Wi-Fi de l'institut, en français ou en anglais. English version : [README.md](README.md).

lama (« beauté » en bassa) est une reprise d'[OpenSalon](https://github.com/clawnify/OpenSalon), sous licence MIT.

## Démo

Essayez lama en ligne à l'adresse [https://lama-demo.mowoapp.com](https://lama-demo.mowoapp.com). L'écran de connexion montre trois comptes de démonstration (gérante, réception, praticienne) avec leurs mots de passe. Les données sont fictives et remises à zéro chaque nuit à 3 h, heure de Douala ; aucun message et aucune sauvegarde ne sortent de la démonstration.

## Ce que fait l'application

- Agenda du jour par membre de l'équipe, rendez-vous à plusieurs prestations, déplacement, créneaux bloqués et feuille du jour (CSV, prête pour Excel).
- Clientes, équipe, prestations et produits. Les prestations, les produits et la fonction des membres de l'équipe peuvent avoir une version anglaise ; vide, c'est le texte français qui s'affiche.
- Comptes par rôle (administrateur, gérante, réceptionniste, praticienne), postes partagés avec code PIN, journal des accès.
- Sauvegardes chiffrées chaque nuit, sur un disque USB et vers Google Drive.
- Montants en francs CFA, dates et heures de Douala (UTC+1).

## Langues

- Chaque compte a sa langue, français ou anglais, que l'on change à tout moment avec le bouton FR / EN en bas du menu latéral ou dans Réglages, Mon compte. Tout l'écran bascule, sans rechargement.
- Avant la connexion, les écrans prennent la langue du dernier compte connecté sur l'appareil, le français sinon.
- Les adresses des écrans sont traduites ; les deux formes ouvrent le même écran, et les adresses d'origine d'OpenSalon restent valables :

| Écran | Français | Anglais |
|---|---|---|
| Tableau de bord | `/` | `/` |
| Agenda | `/agenda` | `/calendar` |
| Rendez-vous | `/rendez-vous`, `/rendez-vous/{id}` | `/appointments`, `/appointments/{id}` |
| Clientes | `/clientes`, `/clientes/{id}` | `/clients`, `/clients/{id}` |
| Équipe | `/equipe` | `/staff` |
| Prestations | `/prestations` | `/services` |
| Produits | `/produits` | `/products` |
| Réglages | `/reglages` | `/settings` |

- L'API répond dans la langue de l'en-tête `Accept-Language`, en anglais sans en-tête. Ses routes (`/api/…`) sont les mêmes dans les deux langues.

## Développer

```bash
pnpm install
pnpm dev     # interface sur http://localhost:5173, API sur le port 8787, données de démonstration
pnpm test
```

## Installer à l'institut

Voir [deploy/LISEZMOI.md](deploy/LISEZMOI.md) (français) ou [deploy/README.md](deploy/README.md) (anglais). Une fois le certificat de l'institut approuvé sur un appareil, lama s'installe sur son écran d'accueil (iPhone, iPad, Android) et s'ouvre en plein écran, comme une application.

## Pour les agents IA

Voir [agent.md](agent.md) (en anglais), puis `/api/openapi.json` pour la forme exacte des requêtes et des réponses.

## Licence

MIT, voir [LICENSE](LICENSE). Les lignes de copyright de Clawnify (OpenSalon) et de lama sont gardées toutes les deux.
