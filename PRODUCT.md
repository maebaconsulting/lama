# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

L'équipe d'un institut de beauté premium en Afrique :

- **la gérante** : pilote l'institut, suit le chiffre d'affaires, règle la fiscalité, les rappels, les moyens de paiement et les comptes de l'équipe ;
- **la réception** : tient l'agenda, accueille, encaisse, envoie les tickets et rappels ;
- **les praticiennes** : consultent leur planning, prennent des notes sur les clientes.

Elles travaillent indifféremment sur tablette au comptoir, sur ordinateur et sur leur téléphone : les trois appareils sont prioritaires au même titre. Les clientes n'utilisent pas l'app ; elles en voient seulement les messages WhatsApp et les tickets.

## Product Purpose

Gérer une journée d'institut de bout en bout sans papier : rendez-vous par praticienne, fiches clientes, caisse avec ticket fiscal, paiement Mobile Money, rappels et tickets par WhatsApp. Réussite : la réception boucle une journée sans autre outil, la gérante règle tout sans technicien, une coupure d'internet n'arrête ni l'agenda ni l'encaissement.

## Positioning

Un outil pensé pour un institut de luxe camerounais, pas un logiciel générique de salon : bilingue français et anglais, francs CFA, Orange Money et MTN MoMo, WhatsApp comme canal client, installé dans l'institut et résistant aux coupures d'internet.

## Operating Context

- Serveur dans l'institut (mini-PC ou Mac mini), accès par le Wi-Fi de l'équipe ; internet sortant seulement.
- Journée rythmée par l'agenda : arrivée de la cliente, soin, encaissement, ticket envoyé par WhatsApp.
- Clientèle aisée de Douala, francophone et anglophone.
- Prestations d'institut : soins du visage, massages, onglerie, épilation, maquillage, coiffure ; vente de produits de soin.

## Capabilities and Constraints

- Base de code : fork d'OpenSalon (Preact, Tailwind CSS v4, shadcn/ui, Hono, SQLite), passée sur Node.
- Deux langues d'interface, bascule à tout moment ; franc CFA (XAF) sans décimales ; fuseau Africa/Douala ; horloge 24 h.
- Rôles : gérante, réception, praticienne.
- Facture fiscale au format ticket 80 mm, numérotation continue, avoirs.
- Spécifications et plans : documents internes, hors du dépôt public.

## Brand Commitments

- Nom : **lama** (« beauté » en bassa), gestion des instituts de beauté pensée pour l'Afrique ; chaque institut l'installe sur son propre serveur et y dépose son logo.
- Marque : un signe calligraphique d'un seul trait (provisoire, `src/client/assets/brand/signe-lama.svg`) et le mot « lama » en Cormorant Garamond 300, minuscules espacées. Sur les documents de l'institut, seulement « propulsé par lama » en pied.
- Registre demandé : luxe, dans l'esprit Chanel, Tom Ford, L'Oréal Luxe.
- Pas d'or : la marque est blanche sur le noir, noire sur le blanc ; l'interface reste en noir, blanc, ivoire et gris.
- Ton : vouvoiement chaleureux (« Nous avons hâte de vous retrouver demain »), en français comme en anglais.
- Français typographique : accents, espaces insécables avant les ponctuations doubles, pas de majuscules à chaque mot, jamais de tiret cadratin.

## Evidence on Hand

- Signe de lama vectoriel (`src/client/assets/brand/signe-lama.svg`) ; le logo de chaque institut est déposé dans Réglages.
- Aucune photo de l'institut, aucun témoignage, aucune donnée réelle : ne rien inventer de tel dans l'app.

## Product Principles

1. **La cliente d'abord, même absente de l'écran** : chaque message, ticket et rappel qu'elle reçoit doit être digne d'une maison de luxe.
2. **La journée ne s'arrête jamais** : sans internet, l'agenda et la caisse continuent ; ce qui attend un envoi le dit clairement.
3. **Le luxe par la retenue** : la marque vit dans la précision des détails, pas dans l'ornement.
4. **Deux langues, zéro compromis** : l'anglais n'est jamais une traduction de second rang.
5. **Rien d'irréversible par accident** : factures immuables, confirmations avant suppression, conflits d'agenda explicites.

## Accessibility & Inclusion

Contraste WCAG AA, navigation au clavier, cibles tactiles de 44 px minimum (usage au doigt sur tablette et téléphone).
