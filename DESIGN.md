---
name: lama
description: Le carnet de rendez-vous d'un institut de beauté, couverture de cuir et pages d'ivoire.
colors:
  cuir: "#161514"
  ivoire: "#F3EEE4"
  papier: "#FBF9F4"
  encre-grise: "#6E6A64"
  filet: "#D8D1C4"
  encre-rouge: "#7A1F1F"
  teinte-survol: "color-mix(in srgb, #161514 6%, #F3EEE4)"
  teinte-onglet: "color-mix(in srgb, #161514 4%, #F3EEE4)"
  couverture-survol: "color-mix(in srgb, #F3EEE4 10%, #161514)"
  couverture-filet: "color-mix(in srgb, #F3EEE4 14%, #161514)"
  statut-reserve: "#5B6B7A"
  statut-confirme: "#3F5E4A"
  statut-en-cours: "#2E3A5C"
  statut-termine: "#161514"
  statut-annule: "#7A1F1F"
  statut-absent: "#7A6556"
  encre-ardoise: "#4A5D73"
  encre-sauge: "#4F6552"
  encre-prune: "#6B4660"
  encre-petrole: "#2F5D62"
  encre-lilas: "#6D6480"
  encre-bouteille: "#35544A"
  encre-rose: "#8C5A6B"
  encre-anthracite: "#4B4B4B"
  sombre-rail: "#0D0C0B"
  sombre-carte: "#1F1D1B"
  sombre-touche: "#2A2724"
  sombre-encre-grise: "#A8A197"
  sombre-filet: "#3A3632"
  sombre-encre-rouge: "#E0877D"
typography:
  display:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontSize: "2rem"
    fontWeight: 300
    letterSpacing: "0.3em"
  headline:
    fontFamily: "EB Garamond, Georgia, serif"
    fontSize: "2rem"
    fontWeight: 500
    letterSpacing: "0.005em"
  title:
    fontFamily: "EB Garamond, Georgia, serif"
    fontSize: "1.375rem"
    fontWeight: 500
    lineHeight: 1.25
  figures:
    fontFamily: "EB Garamond, Georgia, serif"
    fontSize: "1.375rem"
    fontWeight: 400
    fontFeature: "\"onum\" 1, \"pnum\" 1"
  figures-tabular:
    fontFamily: "EB Garamond, Georgia, serif"
    fontSize: "0.875rem"
    fontWeight: 400
    fontFeature: "\"onum\" 1, \"tnum\" 1"
  body:
    fontFamily: "Jost, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
  body-sm:
    fontFamily: "Jost, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  label:
    fontFamily: "Jost, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.18em"
  button:
    fontFamily: "Jost, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    letterSpacing: "0.04em"
rounded:
  sm: "1px"
  md: "2px"
spacing:
  cible: "44px"
  registre: "48px"
  gouttiere: "16px"
  gouttiere-large: "32px"
  section: "40px"
components:
  button-primary:
    backgroundColor: "{colors.cuir}"
    textColor: "{colors.papier}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "0 20px"
    height: "44px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.cuir}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "0 20px"
    height: "44px"
  button-outline-hover:
    backgroundColor: "{colors.teinte-survol}"
  button-secondary:
    backgroundColor: "{colors.papier}"
    textColor: "{colors.cuir}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "0 20px"
    height: "44px"
  button-destructive:
    backgroundColor: "{colors.encre-rouge}"
    textColor: "{colors.papier}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "0 20px"
    height: "44px"
  input:
    backgroundColor: "{colors.papier}"
    textColor: "{colors.cuir}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "44px"
  tab-edge:
    backgroundColor: "{colors.teinte-onglet}"
    textColor: "{colors.encre-grise}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "44px"
  tab-edge-active:
    backgroundColor: "{colors.papier}"
    textColor: "{colors.cuir}"
  register-row:
    backgroundColor: "transparent"
    textColor: "{colors.cuir}"
    typography: "{typography.body-sm}"
    height: "48px"
  register-row-hover:
    backgroundColor: "{colors.teinte-survol}"
  status-badge:
    backgroundColor: "transparent"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  appointment-slip:
    backgroundColor: "{colors.papier}"
    textColor: "{colors.cuir}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  card:
    backgroundColor: "{colors.papier}"
    textColor: "{colors.cuir}"
    rounded: "{rounded.sm}"
    padding: "24px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ivoire}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "44px"
  nav-item-active:
    backgroundColor: "{colors.couverture-survol}"
    textColor: "{colors.ivoire}"
---

# Design System: lama

## Overview

**Creative North Star: "Le carnet de rendez-vous"**

L'agenda de lama est une double page de carnet tenue par la réception. La couverture est de cuir noir : c'est le menu latéral (et l'en-tête mobile), et elle porte la marque lama en blanc. À l'intérieur, tout s'écrit à l'encre sur du papier : les écrans de travail (agenda, listes, fiches, caisse, réglages) sont sur fond blanc pur (`--background` et `--card`, `#FFFFFF`), lignes de registre tracées au filet, libellés en capitales espacées comme la signature « Institut de beauté », heures et montants en chiffres elzéviriens. L'ivoire reste la couleur des surfaces secondaires (`--muted`, `--secondary`, `--accent`), des textes posés sur la couverture et des blocs de l'accueil. Le luxe tient à la retenue et à la justesse des détails, pas à l'ornement.

Le système refuse explicitement le tableau de bord SaaS générique : pas de cartes arrondies, pas d'ombres portées, pas de pastilles vives. La profondeur vient du matériau (cuir contre ivoire, papier posé sur ivoire, filet) et jamais d'une élévation simulée. La densité est celle d'un registre : lignes de 48 px, cibles tactiles de 44 px au minimum, pour un usage au doigt sur tablette et téléphone autant qu'à la souris.

La direction a été retenue par le tirage impeccable 83cf36d3 (carte « IMPECCABLE’S PICK ») et construite à partir du code. La page de référence vivante est `/charte` (`src/client/components/charte.tsx`), hors menu ; les jetons sont dans `src/client/styles.css`, les encres dans `src/client/lib/inks.ts`, et `src/client/palette-guard.test.ts` fait respecter la palette.

**État du chantier (écarts connus).** Seules les fondations sont recomposées : jetons, primitives `ui/*`, badge de statut, couverture (menu latéral), logo, page `/charte`. Les écrans métier (tableau de bord, agenda, listes, formulaires) héritent des jetons mais ne sont pas encore recomposés, et leurs textes restent en anglais ; ce travail relève des sous-projets 3 (bilingue) et 4 (refonte écran par écran). Ils contiennent encore des résidus d'OpenSalon (voir « Do's and Don'ts ») qui ne font pas partie du système. Depuis le renommage lama, l'application n'affiche que le signe de lama et le logo que chaque institut dépose dans Réglages.

**Key Characteristics:**
- Couverture de cuir noir, pages d'ivoire, fiches de papier.
- Règle du logo : blanc sur fond noir (cuir), noir sur fond blanc (papier), jamais d'or.
- Angles de 1 à 2 px, aucune ombre, profondeur par le matériau et le filet.
- Trois voix typographiques : Cormorant Garamond 300 pour le seul mot « lama », EB Garamond pour les titres et les chiffres, Jost pour l'interface.
- Exception : les chiffres clés des blocs ivoire de l'accueil s'écrivent en Jost gras, chiffres réguliers, pour se lire d'un coup d'œil au comptoir (sous-projet 4 § 3.4, décision du 29/09/2026).
- Statuts et praticiennes écrits à l'encre (trait et texte), jamais en pastille pleine.
- Registre en lignes de 48 px, onglets de jours sur la tranche.

## Colors

Une palette de papeterie : un noir de cuir, deux papiers, deux encres de travail et une encre rouge d'alerte, complétés par des encres sourdes pour les statuts et les praticiennes.

### Primary
- **Cuir** (`cuir`) : couverture (menu latéral, en-tête mobile), texte courant, bouton principal, anneau de focus, filet des dialogues. C'est la couleur d'autorité de l'interface.

### Secondary
- **Encre rouge** (`encre-rouge`) : erreurs, suppressions, conflits d'agenda, statut « Annulé », alertes de stock bas. Jamais décorative.

### Neutral
- **Ivoire** (`ivoire`) : surfaces secondaires des écrans de travail (touches, survols, onglets, blocs de l'accueil) et textes posés sur la couverture ; le fond des pages, des fiches et des dialogues est blanc pur (`#FFFFFF`).
- **Papier** (`papier`) : fiches, cartes, dialogues, champs de saisie, onglet actif, ticket ; il se pose sur l'ivoire comme une feuille insérée.
- **Encre grise** (`encre-grise`) : texte secondaire, libellés, contours de champs (4,65:1 sur ivoire, donc lisible et conforme pour un contour d'élément interactif).
- **Filet** (`filet`) : lignes du registre, bordures de cartes et d'onglets, séparateurs, sélection de texte. Purement décoratif (1,31:1 sur ivoire).
- **Teinte de survol** (`teinte-survol`) : cuir à 6 % dans l'ivoire ; survol des lignes, des boutons contour, secondaires et fantômes.
- **Teinte d'onglet** (`teinte-onglet`) : cuir à 4 % dans l'ivoire ; fond des onglets de tranche inactifs.
- **Couverture, survol et filet** (`couverture-survol`, `couverture-filet`) : ivoire à 10 % et 14 % dans le cuir ; élément de menu actif et séparateurs sur la couverture.

### Encres de statut
Définies dans `STATUS_INKS` et lues par `statusInk()` : réservé en gris-bleu (`statut-reserve`), confirmé en vert sapin (`statut-confirme`), en cours en bleu nuit (`statut-en-cours`), terminé en cuir (`statut-termine`), annulé en encre rouge (`statut-annule`), absent en brun taupe (`statut-absent`). Un statut inconnu retombe sur l'encre grise. Toutes dépassent 4,5:1 sur ivoire.

### Encres de praticiennes
Huit encres (`STAFF_INKS`) : ardoise, sauge, prune, pétrole, lilas, bouteille, rose, anthracite. Toute couleur stockée (praticienne, prestation) passe par `toInk()` : une encre conforme est gardée, une couleur vive est ramenée à l'encre de teinte la plus proche, un gris ou une valeur invalide donne l'anthracite. Toutes dépassent 4,5:1 sur ivoire.

### Thème sombre
Choisi par compte (Clair, Sombre, Comme l'appareil), appliqué par l'attribut `data-theme` de la page (sous-projet 4 § 3.1). Le fond passe au cuir, les cartes au gris très foncé (`sombre-carte`), les touches au gris chaud foncé (`sombre-touche`), le texte à l'ivoire ; l'encre grise, le filet et l'encre rouge sont éclaircis (`sombre-encre-grise`, `sombre-filet`, `sombre-encre-rouge`). Le rail et l'en-tête prennent `sombre-rail`, plus sombre que le cuir, pour rester la surface la plus sombre ; le logo y reste blanc. L'action principale s'inverse (ivoire, texte cuir). Les encres de statut et de praticienne passent par la variable `--encre` et les classes `encre`, `encre-fond`, `encre-lisere` : pures en clair, mêlées à 40 % dans l'ivoire en sombre. Les contrastes des deux jeux sont calculés par `theme-contrast.test.ts`. La page `/charte` reste en thème clair.

### Named Rules
**La règle des matériaux fixes.** Cuir, papier, ivoire et blanc ne changent pas avec le thème : un écran de travail emploie les jetons (`bg-card`, `text-foreground`, `bg-muted`, `bg-primary`) ; seuls la charte, le logo et la couverture emploient les matériaux directement (test `palette-guard`).

**La règle sans or.** lama n'a pas d'or : sur le cuir de la couverture, la marque est blanche (papier), sur le papier elle est noire (cuir). Le test `palette-guard` refuse `#B8964E` et tout jeton `or-cygne`.

**La règle de la palette close.** Aucune couleur hors des vingt-cinq valeurs de la charte (six fondations, quatre encres de statut propres, huit encres de praticiennes, six teintes du thème sombre, et le blanc), aucune classe de la palette Tailwind (`bg-blue-500`…), aucun `oklch()` : `palette-guard.test.ts` échoue sinon. Les seules teintes dérivées sont les mélanges `color-mix` du cuir et de l'ivoire ci-dessus, et les encres mêlées d'ivoire du thème sombre.

**La règle de l'encre rouge.** Le rouge signifie toujours une perte, un refus ou un conflit. Il ne sert jamais d'accent.

**La règle du rouge sur cuir.** Sur la couverture, l'encre rouge s'emploie en aplat avec un chiffre papier (badge de stock bas) ; jamais au trait, illisible sur cuir (1,77:1).

## Typography

**Display Font:** Cormorant Garamond (avec Georgia, serif), graisse 300, jeu latin, pour le seul mot « lama »
**Body Font:** Jost (avec system-ui, sans-serif), graisses 300, 400 et 500
**Label/Mono Font:** EB Garamond (avec Georgia, serif), graisses 400, 400 italique et 500, pour les titres et les chiffres

**Character:** Cormorant Garamond léger porte le mot « lama » en minuscules espacées, EB Garamond donne la main du registre (titres, heures, montants en chiffres elzéviriens), Jost tient l'interface avec la netteté d'une étiquette de parfumerie. Les trois polices sont auto-hébergées via `@fontsource` (aucun appel réseau, l'institut peut perdre internet).

### Hierarchy
- **Display** (Cormorant Garamond 300, interlettrage 0,3em, minuscules) : le mot « lama » de la marque (`MotLama`), 2,75rem à l'entrée, 2rem dans le rail, 1,375rem en tête du téléphone. Réservé à la marque.
- **Headline** (EB Garamond 500, 2rem, 0,005em) : titres de page (`h1`, `h2`, `h3` basculent tous en EB Garamond 500).
- **Title** (EB Garamond 500, 1,375rem, interligne serré) : titres de carte et de dialogue.
- **Chiffres** (EB Garamond 400, chiffres elzéviriens proportionnels) : heures, montants, compteurs (classe `chiffres`). En colonne de tableau, chiffres elzéviriens tabulaires sans retour à la ligne (classe `chiffres-tabulaires`).
- **Body** (Jost 400, 1rem) : texte courant, saisie dans les champs (16 px sur mobile pour éviter le zoom, 0,875rem à partir de `md`). Mesure limitée à `max-w-prose` pour les paragraphes.
- **Label** (Jost 500, 0,75rem, interlettrage 0,18em, capitales) : classe `etiquette`, comme la signature « Institut de beauté » ; en-têtes de colonnes, libellés de champs, onglets, statuts, titres de section de la charte.

L'échelle est stricte : 0,75 · 0,875 · 1 · 1,375 · 2 rem, rien d'autre.

### Named Rules
**La règle des chiffres de registre.** Toute heure et tout montant s'écrivent en EB Garamond à chiffres elzéviriens ; tabulaires dès qu'ils s'alignent en colonne. Jamais de chiffres Jost pour une donnée d'agenda ou de caisse.

**La règle des trois graisses.** Graisses 300, 400 et 500 seulement, celles qui sont réellement chargées. Le gras et le demi-gras (`font-bold`, `font-semibold`) sont ramenés à 500 dans les jetons (`--font-weight-bold`, `--font-weight-semibold`) : aucun gras synthétisé par le navigateur.

**La règle du mot seul.** Cormorant Garamond ne sert qu'au mot « lama » ; jamais à un titre, un libellé, un bouton ou une donnée.

**La règle du français typographique.** Accents partout (« Élégance », « À bientôt », « Œ »), espaces insécables avant les ponctuations doubles, pas de majuscules à chaque mot, jamais de tiret cadratin. Le spécimen de la charte vérifie le rendu des accents dans les trois polices.

## Layout

L'application est un carnet ouvert : couverture de cuir fixe à gauche (240 px, visible à partir de 768 px), page d'ivoire à droite. Sous 768 px, la couverture devient un bandeau cuir en tête (signe et mot « lama » en blanc) et le menu s'ouvre en panneau de cuir de 320 px au maximum, pleine hauteur, depuis la gauche.

Les pages de référence se composent dans une colonne de 64rem (`max-w-5xl`) avec une gouttière de 16 px sur mobile et 32 px à partir de `sm`. Les sections se succèdent séparées par un filet haut et 40 px de respiration verticale, le titre de section en libellé capitales. Les grilles passent d'une colonne à deux (`sm`) puis quatre (`lg`) selon la matière.

Le rythme vertical est celui du registre : ligne de 48 px (`registre`), en-têtes de colonnes et cibles tactiles de 44 px (`cible`). Aucun élément interactif ne descend sous 44 px de haut, sauf le bouton `sm` (36 px) réservé aux contextes denses à la souris.

## Elevation & Depth

Le système est plat : aucune ombre portée, nulle part. La profondeur se lit dans le matériau. La couverture de cuir encadre les pages ; le papier (plus clair) se pose sur l'ivoire pour signaler une fiche, un dialogue, un champ ou l'onglet actif ; un filet de 1 px délimite. Un dialogue se distingue par un filet cuir sur papier et un voile de cuir à 60 % sur la page, non par une ombre. L'état se marque par une teinte (survol à 6 % de cuir) ou par un filet qui fonce (filet vers cuir au survol d'un rendez-vous).

### Named Rules
**La règle du papier posé.** Pour élever une surface, on change de papier (ivoire vers papier) et on trace un filet ; on n'ajoute jamais d'ombre.

## Shapes

Les angles sont presque vifs : 1 px (`sm`) pour tous les composants, 2 px au plus (`md`, et les jetons `lg` et `xl` de Tailwind sont eux aussi ramenés à 2 px, si bien qu'aucune classe d'arrondi ne peut dépasser 2 px, sauf `rounded-full`). Les formes sont des rectangles de papeterie : fiches, onglets à coin supérieur, étiquettes. Les traits font 1 px, sauf le liseré d'encre de 3 px à gauche d'un rendez-vous. Le ticket 80 mm utilise un filet pointillé cuir comme les tickets de caisse imprimés.

## Components

### Buttons
Sobres et nets, comme une étiquette gravée.
- **Shape :** angles presque vifs (1 px), hauteur 44 px, 20 px de marge latérale ; `lg` 48 px et 32 px ; `icon` carré de 44 px.
- **Primary :** cuir, texte papier, Jost 500 0,875rem, interlettrage 0,04em.
- **Hover / Focus :** cuir à 85 % au survol, transition de couleur de 200 ms ; focus par contour cuir de 1 px décalé de 2 px ; désactivé à 40 % d'opacité.
- **Outline :** transparent, contour encre grise, survol en teinte de survol.
- **Secondary :** papier, contour filet, survol en teinte de survol.
- **Ghost :** texte seul, survol en teinte de survol.
- **Destructive :** encre rouge, texte papier.
- **Link :** souligné au filet, le soulignement passe au cuir au survol.

### Chips
- **Badge de statut :** libellé en capitales espacées (0,18em), texte et filet de 1 px dans l'encre du statut, fond transparent, angles de 1 px. Libellés français : Réservé, Confirmé, En cours, Terminé, Annulé, Absent.
- **Badge générique :** plein cuir (défaut), papier à filet (secondaire), encre rouge au trait (destructif) ou contour ; capitales en 0,12em d'interlettrage.

### Cards / Containers
- **Corner Style :** 1 px.
- **Background :** papier sur ivoire.
- **Shadow Strategy :** aucune (voir Elevation & Depth).
- **Border :** filet de 1 px.
- **Internal Padding :** 24 px ; titre en EB Garamond 500.

### Inputs / Fields
- **Style :** papier, contour encre grise de 1 px, angles de 1 px, 44 px de haut (champ, liste déroulante) ; zone de texte de 80 px minimum. Libellé en capitales espacées au-dessus.
- **Focus :** contour cuir de 1 px décalé de 2 px, curseur de saisie cuir.
- **Error / Disabled :** libellé, contour et message en encre rouge avec `aria-invalid` ; désactivé à 50 % d'opacité.

### Navigation
La couverture de cuir porte la marque lama blanche (papier) en tête, le signe seul quand le rail est replié, puis les entrées du menu en Jost 0,875rem (interlettrage 0,04em) avec icône de 16 px. Inactif : ivoire à 70 % ; survol : fond `couverture-survol` à 60 % et ivoire plein ; actif : fond `couverture-survol`, ivoire plein, `aria-current="page"`. Cibles de 44 px. Compteurs en badges au trait de la couverture ; stock bas en badge plein encre rouge à chiffre papier (voir la règle du rouge sur cuir). En pied de couverture, deux compteurs en chiffres elzéviriens avec libellé en capitales. Sur mobile, bandeau cuir et panneau de menu (voir Layout).

### Onglets de tranche
Signature du carnet : les jours se choisissent comme des onglets dépassant de la tranche. Chaque onglet est un libellé en capitales (Jost 500, 0,75rem, 0,18em) dans un rectangle à coins supérieurs de 1 px, filet sur trois côtés, 44 px de haut ; les onglets se chevauchent d'un pixel. Inactif : fond `teinte-onglet`, encre grise. Actif : papier, texte cuir, bord inférieur effacé pour se fondre dans la page papier en dessous, passé au premier plan.

### Registre
Tableau en lignes de 48 px séparées par un filet bas, sans fond ni cadre ; la dernière ligne n'a pas de filet. En-têtes de colonnes en libellé capitales, encre grise, 44 px. Heures et montants en chiffres elzéviriens tabulaires, montants alignés à droite. Survol et sélection en teinte de survol.

### Fiche de rendez-vous
Dans l'agenda et la charte : papier, filet de 1 px, liseré gauche de 3 px dans l'encre de la praticienne (via `toInk()`), angles de 1 px ; heure en chiffres elzéviriens encre grise, nom de la cliente en Jost, prestation en petit encre grise. Au survol, le filet passe au cuir. Un blocage de créneau prend un liseré encre grise.

### Ticket 80 mm
Aperçu de 302 px sur papier, filet autour : nom de l'institut en EB Garamond (aucun logo), numéro et date, lignes séparées par un filet pointillé cuir, montants en chiffres elzéviriens, formule de politesse en encre grise, « propulsé par lama » en pied.

### Logo
Le signe lama (`src/client/assets/brand/signe-lama.svg`, `currentColor`, provisoire et remplaçable dans ce seul fichier) et le mot « lama », insérés par `SigneLama` et `MotLama`, et dans le cadre par `MarqueCadre` (entrée, rail ouvert, rail replié, téléphone ; réglages de chaque place dans `src/client/lib/marque.ts`). Deux versions, selon le fond : blanche (papier) sur cuir, noire (cuir) sur papier. L'icône d'application et le favicon (`icon.svg`) posent le signe blanc sur un carré de cuir.

## Do's and Don'ts

### Do:
- **Do** écrire les statuts et les praticiennes à l'encre : texte et filet (badge), liseré de 3 px (fiche), pastille carrée de 10 à 12 px au plus pour une légende.
- **Do** faire passer toute couleur stockée par `toInk()` et tout statut par `statusInk()`.
- **Do** poser le papier sur l'ivoire et tracer un filet de 1 px pour distinguer une surface.
- **Do** garder les angles à 1 px (`rounded-sm`), 2 px au plus.
- **Do** composer heures et montants avec `chiffres` ou `chiffres-tabulaires`.
- **Do** utiliser le libellé `etiquette` pour les en-têtes de colonnes, les libellés de champs, les onglets et les statuts.
- **Do** tenir des cibles de 44 px et des lignes de registre de 48 px.
- **Do** marquer le focus par un contour cuir de 1 px décalé de 2 px (ivoire sur la couverture).
- **Do** vérifier chaque nouvelle valeur dans `/charte` et faire passer `palette-guard.test.ts`.

### Don't:
- **Don't** ajouter d'ombre portée (`shadow-*`), sur aucune surface.
- **Don't** tracer un badge au trait d'encre rouge sur la couverture de cuir ; l'aplat rouge à chiffre papier s'impose.
- **Don't** demander une graisse au-delà de 500 ni introduire une graisse non chargée.
- **Don't** arrondir au-delà de 2 px, ni utiliser de pastille ronde pleine pour un statut.
- **Don't** introduire d'or : la marque est blanche sur le cuir, noire sur le papier.
- **Don't** introduire de couleur vive ou de classe de la palette Tailwind (`bg-green-500`, `text-blue-600`…) ; les couleurs des praticiennes et des prestations passent par leur encre.
- **Don't** employer l'encre rouge pour autre chose qu'une erreur, une suppression, un conflit ou une annulation.
- **Don't** composer une donnée d'heure ou de montant en Jost, ni un libellé ou un bouton en Cormorant Garamond.
- **Don't** reprendre comme modèle les écrans métier non recomposés : leurs `select` natifs de 36 px à anneau de 2 px, la bannière d'erreur à ombre et fond rouge translucide et les textes anglais sont des résidus d'OpenSalon en attente des sous-projets 3 et 4.
