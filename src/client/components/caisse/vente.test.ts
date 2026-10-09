import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Écran « Vente » (sous-projet 5 § 4.1, § 4.3), câblé sur les règles de
 * `lib/ticket.ts` (testées en exécution) : page à deux colonnes selon la
 * largeur réelle, barre « Ticket » au téléphone, catalogue, ticket, fenêtres.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const vente = read("./vente.tsx");
const catalogue = read("./catalogue.tsx");
const ticket = read("./ticket-vente.tsx");
const fenetres = read("./fenetres.tsx");
const app = read("../../app.tsx");

test("une page, pas un panneau ; un rendez-vous par adresse (/vente/12), l'écran repart de zéro quand elle change", () => {
  assert.match(app, /case "vente": return <Vente key=\{id \?\? "comptoir"\} appointmentId=\{id\} \/>;/);
  assert.match(vente, /const aptId = appointmentId && \/\^\[1-9\]\\d\{0,9\}\$\/\.test\(appointmentId\) \? Number\(appointmentId\) : null;/);
});

test("catalogue à gauche et ticket à droite dès 42 rem de large réelle ; au téléphone, barre « Ticket · N articles · montant »", () => {
  assert.match(vente, /<div className="@container flex min-h-0 min-w-0 flex-1 flex-col">/);
  assert.match(app, /view === "vente" && "flex flex-col",/, "la page prend la hauteur laissée par les bandeaux : « Encaisser » reste en vue");
  assert.match(vente, /<div className="flex min-h-0 flex-1 flex-col @2xl:flex-row">/);
  assert.match(vente, /@2xl:w-\[22rem\] @2xl:shrink-0 @2xl:border-l @2xl:border-filet @5xl:w-\[25rem\]/);
  assert.match(vente, /<div className="shrink-0 border-t border-filet bg-card p-3 @2xl:hidden">/);
  assert.match(vente, /\{tn\("caisse\.barre_ticket", itemCount\(ticket\)\)\}/);
  assert.match(vente, /onClick=\{\(\) => setVue\("ticket"\)\}/);
  assert.doesNotMatch(vente + catalogue + ticket, /\bmd:(?!text-sm|pb-4)/, "la mise en page suit le conteneur, jamais l'écran");
});

test("ticket gardé sur l'appareil ; rendez-vous : ticket pré-rempli, ou le ticket en cours gardé avec la proposition de le remplacer", () => {
  assert.match(vente, /const \[ticket, setTicket\] = useState<Ticket>\(\(\) => keptTicket\(account\.id\)\);/);
  assert.match(vente, /const update = \(next: Ticket\) => \{ keepTicket\(next, account\.id\); setTicket\(next\); setStaleDue\(null\); \};/);
  assert.match(vente, /if \(apt && ouverture === "prefill"\) update\(fromAppointment\(apt, ticket\.request_id\)\);/);
  assert.match(vente, /\{ouverture === "conflict" && apt && \(/);
  assert.match(vente, /onClick=\{\(\) => update\(fromAppointment\(apt\)\)\}>\{t\("caisse\.remplacer_ticket"\)\}/);
  assert.match(vente, /t\("caisse\.rdv_deja_paye", \{ numero: apt\.invoice_number \}\)/);
  // Reste de la tâche 5 (spec § 7) : l'émission connue lève aussi le gel du ticket, et la facture
  // reçue est gardée pour survivre à un aller-retour sur l'écran (voir plus bas).
  assert.match(vente, /onIssued=\{\(invoice\) => \{ update\(emptyTicket\(\)\); updatePending\(false\); keepIssued\(invoice, account\.id\); setIssued\(invoice\); setEtape\("emise"\); \}\}/);
});

/**
 * I1 de la relecture finale (final-review.md) : après l'encaissement d'un
 * rendez-vous, le ticket gardé (vidé par `onIssued`) était pré-rempli de
 * nouveau avec ce même rendez-vous, encore vu comme impayé le temps que la
 * réponse du `GET /api/appointments/:id` déclenché par le signal temps réel
 * arrive. « Nouvelle vente » ouvrait alors ce ticket fantôme, et un autre
 * rendez-vous pouvait se heurter au bandeau « Un autre ticket est en cours ».
 * Corrigé en ne pré-remplissant qu'à l'étape du ticket, sans facture ni envoi
 * en cours : l'effet ne se déclenche plus pendant l'étape « émise » ni
 * « paiement », donc jamais après `onIssued`, qui vide justement le ticket.
 */
test("I1 : le ticket n'est pré-rempli qu'à l'étape du ticket, sans facture ni envoi en cours (pas de ticket fantôme après un encaissement)", () => {
  // Correctif 1 : jamais non plus si elle ne peut plus encaisser ce rendez-vous (`blocked`, praticienne.test.ts).
  assert.match(vente, /const ouverture = apt && unpaid && etape === "ticket" && !issued && !pending && !blocked \? openFor\(ticket, apt\.id\) : "keep";/);
});

test("catalogue : onglets, recherche sans accents, catégories en pastilles, tuiles de 104 px ; rupture grisée et refusée, stock bas signalé", () => {
  assert.match(catalogue, /role="tablist"/);
  assert.match(catalogue, /matchesSearch\(search, i\.name, i\.name_en, i\.extra\)/);
  assert.match(catalogue, /aria-pressed=\{category === c\}/);
  assert.match(catalogue, /min-h-\[6\.5rem\]/);
  assert.match(catalogue, /const refuse = epuise \|\| plafond;/);
  assert.match(catalogue, /aria-disabled=\{refuse \? "true" : undefined\}\s*onClick=\{\(\) => \{ if \(!refuse\) onAdd\(\); \}\}/);
  assert.match(catalogue, /alerte=\{i\.p!\.stock <= i\.p!\.low_stock_alert\}/);
  assert.match(catalogue, /t\("caisse\.en_stock", \{ n: stock \?\? 0 \}\)/);
});

test("ticket : cliente obligatoire avec une prestation, − et + pour un produit, praticienne d'une prestation, « dont TVA » si active", () => {
  assert.match(ticket, /const missingClient = needsClient\(ticket\);/);
  // Retouche C (décision du 30/09/2026) : un dû nul (remise de 100 %, prestation offerte) n'empêche plus
  // « Encaisser » ; seul un ticket vide, une cliente manquante ou un article retiré le bloque encore.
  assert.match(ticket, /const blocked = lines\.length === 0 \|\| missingClient \|\| lines\.some\(\(l\) => l\.missing\) \|\| depositExceeds \|\| depositOtherClient;/);
  assert.doesNotMatch(ticket, /totals\.due <= 0/, "« Encaisser 0 F » reste actif dès qu'une ligne est au ticket");
  assert.match(ticket, /disabled=\{l\.stock !== null && l\.line\.quantity >= l\.stock\}/);
  assert.match(ticket, /onChange\(setLineStaff\(ticket, l\.index, Number\(\(e\.currentTarget as HTMLSelectElement\)\.value\) \|\| null\)\)/);
  assert.match(ticket, /\{settings\.vat_active && <Total libelle=\{vatLabel\(settings\.vat_rate \?\? 0, lang\)\} montant=\{formatPrice\(totals\.total_tva, lang\)\} \/>\}/);
  assert.match(ticket, /\{settings\.discounts && <Button/);
  assert.match(ticket, /\{settings\.tips && <Button/);
  assert.match(ticket, /<BoutonDestructif libelle=\{t\("caisse\.vider"\)\} question=\{t\("caisse\.vider_question"\)\} onConfirm=\{\(\) => onChange\(emptyTicket\(\)\)\} \/>/);
  assert.match(ticket, /<Button className="h-16 w-full text-base" disabled=\{blocked\} onClick=\{onCharge\}>/);
});

test("remise : pourcentage ou montant, motif obligatoire (« Autre » avec texte), plafond dit d'avance ; pourboire : praticienne par défaut", () => {
  assert.match(fenetres, /const ready = amount > 0 && reason !== null && \(reason !== "autre" \|\| note\.trim\(\) !== ""\);/);
  assert.match(fenetres, /\{off > 0 && exceedsCap\(subtotal, off, cap\) && <p className="text-sm text-encre-rouge">/);
  assert.match(fenetres, /"min-h-16 rounded-sm border px-3 text-sm font-medium/);
  assert.match(ticket, /defaultStaff=\{defaultTipStaff\(ticket, appointment\?\.staff_id \?\? null\)\}/);
  assert.match(fenetres, /inputMode="numeric"/);
  assert.doesNotMatch(fenetres, /type="number"/, "montants en texte, lus par parseAmount");
});

/**
 * Correction reportée de la tâche 5 (spec § 7, jamais de vente en double ni
 * perdue) : tant que l'issue d'un envoi est inconnue (Paiement en train
 * d'envoyer, ou une erreur d'issue inconnue : statut 0 ou 500 et plus), le
 * ticket gardé sur l'appareil doit rester gelé, et quitter l'écran doit
 * ramener à l'étape « paiement » au retour plutôt que de rouvrir le ticket.
 */
test("une demande partie sans issue connue gèle le ticket gardé et ramène à Paiement au retour sur l'écran (tâche 5, reste pour la tâche 6)", () => {
  const lib = read("../../lib/ticket.ts");
  assert.match(lib, /export function keptPending\(accountId: number \| null\): boolean \{\s*return forAccount\(accountId\)\.pending;\s*\}/);
  assert.match(lib, /export function keepPending\(p: boolean, accountId: number \| null\): void \{\s*forAccount\(accountId\)\.pending = p;\s*\}/);

  const paiement = read("./paiement.tsx");
  assert.match(paiement, /onPending: \(pending: boolean\) => void;/, "Paiement rend compte à l'écran « Vente » de l'issue inconnue");
  assert.match(paiement, /onPending\(true\);/, "un envoi qui part est signalé tout de suite");
  assert.match(paiement, /setError\(\{ message: e\.message, retry: e instanceof ApiError && \(e\.status === 0 \|\| e\.status >= 500\) \}\);\s*\/\/[^\n]*\n\s*onPending\(e instanceof ApiError && \(e\.status === 0 \|\| e\.status >= 500\)\);/, "une réponse perdue reste une issue inconnue même une fois l'envoi terminé");

  assert.match(vente, /const \[pending, setPending\] = useState\(\(\) => keptPending\(account\.id\)\);/);
  assert.match(vente, /const updatePending = \(p: boolean\) => \{ keepPending\(p, account\.id\); setPending\(p\); \};/);
  assert.match(vente, /onPending=\{updatePending\}/, "câblé sur Paiement");
  assert.match(vente, /\{etape === "paiement" \|\| pending \? \(/, "gelé : l'écran ne montre jamais le catalogue ni le ticket tant que l'issue est inconnue");
  assert.match(vente, /onIssued=\{\(invoice\) => \{ update\(emptyTicket\(\)\); updatePending\(false\); keepIssued\(invoice, account\.id\); setIssued\(invoice\); setEtape\("emise"\); \}\}/, "l'émission connue lève le gel");
});

/**
 * Relecture de la tâche 6 : collision de la clé
 * « caisse.pourboire » avec celle de la tâche 5, facture reçue pendant que
 * l'écran « Vente » est quitté jamais montrée au retour (le ticket réapparaît
 * vide, ce qui ouvre la voie à une vente rejouée en double), et reprise
 * d'un envoi en attente sans aide à la reprise après un remontage de l'écran.
 */
test("relecture : libellé « Pourboire » rétabli, facture reçue gardée jusqu'au retour sur l'écran, reprise d'un envoi en attente", () => {
  const fr = read("../../i18n/fr.ts");
  const en = read("../../i18n/en.ts");
  assert.match(fr, /"caisse\.pourboire": "Pourboire",/, "la clé du brief n'est plus prise par le libellé du pourboire sans nom");
  assert.match(en, /"caisse\.pourboire": "Tip",/);
  assert.match(fr, /"caisse\.pourboire_sans_nom": "Pourboire, hors facture",/);
  assert.match(en, /"caisse\.pourboire_sans_nom": "Tip, not invoiced",/);

  const emise = read("./emise.tsx");
  assert.match(emise, /t\("caisse\.pourboire_pour", \{ nom: invoice\.tip\.staff_name \}\) : t\("caisse\.pourboire_sans_nom"\)/);
  assert.match(ticket, /staffName\(ticket\.tip\.staff_id\) \? t\("caisse\.pourboire_pour", \{ nom: staffName\(ticket\.tip\.staff_id\) \}\) : t\("caisse\.pourboire_sans_nom"\)/, "même défaut que emise.tsx, corrigé de la même façon");

  const lib = read("../../lib/ticket.ts");
  assert.match(lib, /export function keptIssued\(accountId: number \| null, appointmentId: number \| null\): Invoice \| null \{/, "rattachée au compte et à la vente qui l'a produite (relecture 2)");
  assert.match(lib, /export function keepIssued\(i: Invoice \| null, accountId: number \| null\): void \{\s*forAccount\(accountId\)\.issued = i;\s*\}/);

  assert.match(vente, /const \[etape, setEtape\] = useState<Etape>\(\(\) => \(keptIssued\(account\.id, aptId\) \? "emise" : "ticket"\)\);/, "une facture reçue pendant que l'écran est quitté est retrouvée au montage, pour ce compte et ce rendez-vous");
  assert.match(vente, /const \[issued, setIssued\] = useState<Invoice \| null>\(\(\) => keptIssued\(account\.id, aptId\)\);/);
  assert.match(vente, /onNew=\{\(\) => \{ keepIssued\(null, account\.id\); setIssued\(null\); setEtape\("ticket"\); setVue\("catalogue"\); navigate\(pathFor\("vente", lang\)\); \}\}/);
  assert.match(vente, /onHome=\{\(\) => \{ keepIssued\(null, account\.id\); navigate\(pathFor\("dashboard", lang\)\); \}\}/);
  assert.match(vente, /resume=\{pending\}/, "Paiement reprend directement dans l'état « réponse perdue » après un remontage en attente");

  const paiement = read("./paiement.tsx");
  assert.match(paiement, /resume: boolean;/);
  assert.match(paiement, /const \[error, setError\] = useState<\{ message: string; retry: boolean \} \| null>\(\(\) => \(resume \? \{ message: t\("erreur\.reseau"\), retry: true \} : null\)\);/);
});

/**
 * Re-relecture de la tâche 6 : `keepIssued`/`keptIssued`
 * (et, de la même façon, `keepTicket`/`keptTicket`, `keepPending`/
 * `keptPending`) sont des variables de module, jamais effacées au
 * changement de compte : sur un poste partagé, la facture (numéro, montant,
 * cliente, versements), le ticket ou l'envoi en attente d'une personne
 * pouvaient être remontrés à la suivante, ou au mauvais rendez-vous pour la
 * même personne. Corrigé en rattachant tout au compte qui les a gardés
 * (fonctions pures, testées en exécution dans `lib/ticket.test.ts`).
 */
test("re-relecture : ticket, envoi en attente et facture gardés rattachés au compte, jamais montrés à la personne suivante sur un poste partagé", () => {
  const lib = read("../../lib/ticket.ts");
  assert.match(lib, /interface KeptSale \{/, "un enregistrement par compte, jamais partagé ni remplacé par un autre (relecture 3)");
  assert.match(lib, /const kept = new Map<number \| null, KeptSale>\(\);/, "chaque compte a le sien : la lecture d'un autre compte ne détruit jamais celui d'un premier");
  assert.match(lib, /export function keptTicket\(accountId: number \| null\): Ticket \{\s*return forAccount\(accountId\)\.ticket;\s*\}/);
  assert.match(lib, /export function keepTicket\(t: Ticket \| null, accountId: number \| null\): void \{\s*forAccount\(accountId\)\.ticket = t \?\? emptyTicket\(\);\s*\}/);

  // Câblé sur le compte de la session ouverte (jamais sur un identifiant tapé ou déduit) : la
  // même personne qui déverrouille le retrouve (décision 1), une autre part d'un écran vierge.
  assert.match(vente, /import \{ useAuth \} from "\.\.\/\.\.\/auth-context";/);
  assert.match(vente, /const \{ account \} = useAuth\(\);/);
});

/**
 * Re-relecture 2 de la tâche 6 : un seul enregistrement
 * gardé, remplacé dès qu'un autre compte le lisait, détruisait le ticket, le
 * `request_id` et le gel du premier compte (risque de vente en double au
 * comptoir) ; une facture qui ne correspondait pas à la vente demandée
 * était effacée à la lecture au lieu d'être seulement tenue cachée (une
 * facture de comptoir gardée disparaissait sans jamais avoir été montrée si
 * la personne ouvrait un rendez-vous avant de toucher « Nouvelle vente »).
 */
/**
 * Mineur 2 de la relecture finale (final-review.md) : après un refus 409
 * « total » (prix du catalogue changé), seul le catalogue des produits était
 * relu, jamais les prestations, et le montant dû renvoyé par le serveur
 * n'était pas utilisé ; le prix d'une prestation changée rebouclait donc sur
 * le même refus. Corrigé en relisant aussi les prestations et en affichant
 * tout de suite le montant dû du serveur (`staleDue`), jusqu'au prochain
 * changement du ticket.
 */
test("mineur 2 : refus 409 « total », prestations relues en plus des produits, montant dû du serveur affiché tout de suite", () => {
  const useApp = read("../../hooks/use-app.ts");
  const context = read("../../context.tsx");
  assert.match(context, /reloadServices: \(\) => Promise<void>;/, "exposée par le contexte, comme les autres rechargements");
  assert.match(useApp, /reloadServices: fetchServices,/);

  assert.match(vente, /const \{ services, staffLookup, clientLookup, navigate, reloadServices \} = useApp\(\);/);
  assert.match(vente, /const \[staleDue, setStaleDue\] = useState<number \| null>\(null\);/);
  assert.match(vente, /onStale=\{\(due\) => \{ void products\.reload\(\); void reloadServices\(\); if \(due !== undefined\) setStaleDue\(due\); \}\}/);
  assert.match(vente, /totals=\{staleDue !== null \? \{ \.\.\.share\.totals, due: staleDue \} : share\.totals\}/);

  const paiement = read("./paiement.tsx");
  assert.match(paiement, /onStale: \(due\?: number\) => void;/);
  assert.match(paiement, /onStale\(e\.code === "total" \? \(e\.body as \{ due\?: number \} \| null\)\?\.due : undefined\);/);
});

test("re-relecture 2 : un enregistrement par compte (jamais remplacé par la lecture d'un autre), facture cachée mais jamais effacée par une vente qui ne la concerne pas", () => {
  const lib = read("../../lib/ticket.ts");
  assert.match(lib, /function forAccount\(accountId: number \| null\): KeptSale \{\s*let k = kept\.get\(accountId\);\s*if \(!k\) \{\s*k = \{ ticket: emptyTicket\(\), pending: false, issued: null \};\s*kept\.set\(accountId, k\);\s*\}\s*return k;\s*\}/, "un compte inconnu obtient son propre enregistrement vierge, sans jamais toucher à celui d'un autre");
  assert.match(lib, /export function keptIssued\(accountId: number \| null, appointmentId: number \| null\): Invoice \| null \{\s*const k = forAccount\(accountId\);\s*return k\.issued && k\.issued\.appointment_id === appointmentId \? k\.issued : null;\s*\}/, "aucune mutation : une facture d'une autre vente est cachée, pas effacée");
});

// Retouche 8 (critique de la vague 1) : le montant de « Encaisser … » en chiffres de la charte, pas en Jost.
test("« Encaisser 33 350 F » : montant en chiffres Garamond dans le bouton", () => {
  assert.match(ticket, /const encaisser = aroundAmount\(t\("caisse\.encaisser_montant", \{ montant: formatPrice\(totals\.due, lang\) \}\), formatPrice\(totals\.due, lang\)\);/);
  assert.match(ticket, /\{encaisser\[0\]\}<span className="chiffres text-lg">\{encaisser\[1\]\}<\/span>\{encaisser\[2\]\}/);
});

// Retouche 4 (critique du 30/09/2026) : avec un pourboire, le grand chiffre du ticket est la somme
// demandée à la cliente (« À payer », total + pourboire) ; « Total » de la facture passe en taille normale.
test("retouche 4 : avec un pourboire, « À payer » (total + pourboire) en grand, « Total » en taille normale, le pourboire entre les deux", () => {
  const totaux = ticket.slice(ticket.indexOf('<dl className="space-y-1.5">'), ticket.indexOf("</dl>"));
  assert.match(ticket, /const toPay = Boolean\(ticket\.tip\) \|\| \(deposit !== null && !depositOtherClient\);/);
  assert.match(totaux, /<dd className=\{toPay \? "chiffres-tabulaires text-base" : "chiffres text-right font-serif text-4xl leading-none"\}><Montant valeur=\{formatPrice\(totals\.total_ttc, lang\)\} \/><\/dd>/, "sans pourboire ni acompte, « Total » reste en grand");
  const total = totaux.indexOf('t("caisse.total")');
  const pourboire = totaux.indexOf('t("caisse.pourboire_pour"');
  const aPayer = totaux.indexOf('t("caisse.a_payer")');
  assert.ok(total >= 0 && pourboire > total && aPayer > pourboire, "Total, puis le pourboire, puis « À payer »");
  assert.match(totaux, /\{toPay && \(\s*<div className="flex items-baseline justify-between gap-3 border-t border-foreground pt-3">\s*<dt className="etiquette">\{t\("caisse\.a_payer"\)\}<\/dt>\s*<dd className="chiffres text-right font-serif text-4xl leading-none"><Montant valeur=\{formatPrice\(totals\.due, lang\)\} \/><\/dd>/);
  const fr = read("../../i18n/fr.ts");
  const en = read("../../i18n/en.ts");
  assert.match(fr, /"caisse\.a_payer": "À payer",/);
  assert.match(en, /"caisse\.a_payer": "To pay",/);
});

// Retouche 6 (critique du 30/09/2026) : un produit dont tout le stock est au ticket n'a pas l'air
// en rupture ; « Rupture » garde son encre pleine (contraste AA), seule la tuile s'estompe.
test("retouche 6 : tuile au plafond du stock distincte de la rupture, badge « Rupture » sans opacité", () => {
  const tuile = catalogue.slice(catalogue.indexOf("function Tuile"), catalogue.indexOf("export function Catalogue"));
  assert.match(tuile, /const epuise = stock !== null && stock <= 0;/);
  assert.match(tuile, /const plafond = stock !== null && stock > 0 && auTicket >= stock;/);
  assert.doesNotMatch(tuile, /rupture && "cursor-not-allowed opacity-50/, "l'opacité ne s'applique plus à toute la tuile (badge compris)");
  assert.match(tuile, /const pale = epuise && "opacity-50";/);
  assert.equal((tuile.match(/\bpale\b/g) ?? []).length, 4, "nom, marque et prix estompés, déclaration comprise ; jamais le badge");
  assert.match(tuile, /\{epuise \? \(\s*<span className="rounded-sm border border-encre-rouge px-1\.5 text-xs text-encre-rouge">\{t\("caisse\.rupture"\)\}<\/span>/);
  assert.match(tuile, /\) : plafond \? \(\s*<span className="etiquette min-w-0">\{t\("caisse\.au_ticket_tout", \{ n: auTicket \}\)\}<\/span>/);
  assert.match(tuile, /refuse && "cursor-not-allowed"/);
  const fr = read("../../i18n/fr.ts");
  const en = read("../../i18n/en.ts");
  assert.match(fr, /"caisse\.au_ticket_tout": "Au ticket · \{n\}, tout le stock",/);
  assert.match(en, /"caisse\.au_ticket_tout": "On ticket · \{n\}, all the stock",/);
});

// Retouche 9, pastilles (critique du 30/09/2026) : au téléphone, les catégories tiennent sur une
// rangée qui défile seule (bord à bord), sans déborder de la page ; sur plus de 42 rem, elles passent à la ligne.
test("retouche 9 : pastilles de catégories sur une ligne qui défile au téléphone, à la ligne au-delà de 42 rem", () => {
  assert.match(catalogue, /role="group" aria-label=\{t\("caisse\.categories"\)\} className="-mx-4 -my-1 flex shrink-0 gap-2 overflow-x-auto px-4 py-1 @2xl:mx-0 @2xl:flex-wrap @2xl:overflow-visible @2xl:px-0"/);
  assert.match(catalogue, /"min-h-11 shrink-0 whitespace-nowrap rounded-sm border px-4 text-sm/);
});

/**
 * Retouches vague 3a, commit 1 (retouches-brief.md § 1) : `SaleSettings` rend optionnels les
 * champs que la réponse réduite à la praticienne omet (jamais lus dans cet état, l'écran bloque
 * avant) ; `tsc` exige quand même une valeur de secours à chaque lecture.
 */
test("retouche : réglages optionnels, valeur de secours à chaque lecture (TVA, plafond, moyens)", () => {
  assert.match(vente, /const vat = \{ active: settings\.data\.vat_active \?\? false, rate: settings\.data\.vat_rate \?\? 0 \};/);
  assert.match(ticket, /vatLabel\(settings\.vat_rate \?\? 0, lang\)/);
  assert.match(ticket, /cap=\{settings\.discount_cap \?\? 0\}/);
});

// Vague 3b : l'acompte en attente du rendez-vous est un versement déjà reçu ; il se déduit de « À payer ».
test("acompte au ticket : lu pour le rendez-vous de l'adresse, déduit comme le serveur, montré au-dessus de « À payer », vente bloquée s'il dépasse", () => {
  assert.match(vente, /aptId === null \|\| !canSell\(account\.role\) \? Promise\.resolve\(\[\] as Deposit\[\]\) : api<\{ deposits: Deposit\[\] \}>\("GET", `\/api\/deposits\?appointment_id=\$\{aptId\}`\)/);
  // V1-78 : hors rendez-vous, l'acompte choisi au comptoir (jamais celui d'un rendez-vous).
  assert.match(vente, /const held = ticket\.appointment_id !== null && ticket\.appointment_id === aptId \? heldDeposit\(deposits\.data \?\? \[\]\) : chosenCounterDeposit\(ticket, counter\.data\);\n\s*const share = depositShare\(priced\.totals, ticket\.client_id, held\);/);
  assert.match(vente, /totals=\{share\.totals\}\n\s*deposit=\{share\.deposit\}\n\s*depositExceeds=\{share\.exceeds\}\n\s*depositOtherClient=\{share\.otherClient\}/);
  const totaux = ticket.slice(ticket.indexOf('<dl className="space-y-1.5">'), ticket.indexOf("</dl>"));
  assert.ok(totaux.indexOf('t("caisse.acompte_deduit"') > totaux.indexOf('t("caisse.pourboire_pour"') && totaux.indexOf('t("caisse.acompte_deduit"') < totaux.indexOf('t("caisse.a_payer")'));
  assert.match(ticket, /\{depositExceeds && deposit && \(/);
});

// Mineur 2 (relecture finale) : les acomptes se lisent comme les réglages, jamais le prix plein montré
// avant de savoir s'il y a un acompte à déduire.
test("acomptes attendus comme les réglages : état de chargement, erreur affichée, jamais le prix plein entre-temps", () => {
  assert.match(vente, /const depositsExpected = aptId !== null && canSell\(account\.role\);/);
  assert.match(vente, /if \(depositsExpected && deposits\.error && !deposits\.data\) return <div className="p-4 sm:p-6"><EtatErreur message=\{deposits\.error\} onRetry=\{deposits\.reload\} \/><\/div>;/);
  assert.match(vente, /if \(depositsExpected && deposits\.data === null\) return <EtatChargement \/>;/);
  assert.ok(vente.indexOf("const depositsExpected") < vente.indexOf("const share = depositShare"), "attendu avant de calculer la part de l'acompte");
});

// Mineur 3 (relecture finale) : la cliente du ticket a changé (« Changer »), l'acompte reste celui de l'autre.
test("acompte d'une autre cliente : phrase du serveur, vente bloquée, rien de déduit", () => {
  assert.match(ticket, /\{depositOtherClient && deposit && \(\s*<p role="status" className="rounded-sm border border-encre-rouge p-3 text-sm text-encre-rouge">\{t\("acompte\.autre_cliente", \{ numero: deposit\.number \}\)\}<\/p>/);
  assert.match(ticket, /const blocked = lines\.length === 0 \|\| missingClient \|\| lines\.some\(\(l\) => l\.missing\) \|\| depositExceeds \|\| depositOtherClient;/);
  assert.match(ticket, /\{deposit && !depositOtherClient && <Total libelle=\{t\("caisse\.acompte_deduit", \{ numero: deposit\.number \}\)\}/);
});
