import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Paiement et émission (sous-projet 5 § 4.2, § 4.3, § 7), câblés sur les
 * règles de `lib/paiement.ts` et `lib/caisse-texte.ts` (testées en exécution) :
 * gros boutons, calculatrice, monnaie rendue, même demande renvoyée,
 * mot de passe d'une gérante au-delà du plafond.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const paiement = read("./paiement.tsx");
const approbation = read("./approbation.tsx");
const emise = read("./emise.tsx");

test("moyens activés par la gérante en boutons de 64 px, pavé de 64 px à trois colonnes, « Effacer » écrit", () => {
  // Retouche vague 3a (commit 1) : `methods` est optionnel dans la réponse réduite à la praticienne,
  // jamais atteinte ici (l'écran bloque avant), mais `tsc` l'exige quand même.
  assert.match(paiement, /const methods = PAYMENT_METHODS\.filter\(\(m\) => \(settings\.methods \?\? \[\]\)\.includes\(m\)\);/);
  assert.match(paiement, /"min-h-16 rounded-sm border px-2 text-sm leading-tight/);
  assert.match(paiement, /onClick=\{\(\) => setDraft\(chooseMethod\(draft, m, due\)\)\}/);
  assert.match(paiement, /\{padKeys\(\)\.map\(\(k\) => \(/);
  assert.match(paiement, /className=\{cn\("h-16 border-filet px-1", k === "effacer" \? "text-sm" : "font-serif text-3xl"\)\}/);
  assert.match(paiement, /onClick=\{\(\) => setDraft\(pressKey\(draft, k, due\)\)\}/);
  assert.match(paiement, /\{k === "effacer" \? t\("caisse\.effacer"\) : k === "virgule" \? separateurDecimal\(lang\) : k\}/);
  assert.match(paiement, /aria-label=\{k === "virgule" \? t\("caisse\.touche_virgule"\) : undefined\}/);
  assert.match(paiement, /<span className="chiffres">\{saisiePave\(current, lang\)\}<\/span>/);
});

test("espèces : montant exact puis montants ronds ; « À rendre » en très grand avec les coupures (courtes au téléphone)", () => {
  assert.match(paiement, /\{cashSuggestions\(draft, due\)\.map\(\(amount, i\) => \{/);
  assert.match(paiement, /onClick=\{\(\) => setDraft\(setTendered\(draft, amount, due\)\)\}/);
  assert.match(paiement, /\{s\.change > 0 && \(/);
  assert.match(paiement, /\{changeText\(s\.change, lang, true\)\}/);
  assert.match(paiement, /\{changeText\(s\.change, lang\)\}/);
  assert.match(paiement, /font-serif text-4xl leading-none @5xl:text-5xl"><Montant valeur=\{formatPrice\(s\.change, lang\)\} \/>/);
  assert.match(paiement, /flex-wrap items-end justify-between/, "colonne étroite : le montant passe sous les coupures");
});

/**
 * Retouche C (décision produit du 30/09/2026, M1 de la relecture
 * finale) : dû nul (remise de 100 %, prestation offerte), ni moyens ni pavé,
 * la phrase « Rien à encaisser » à la place ; « Valider et émettre la
 * facture » reste actif (le blocage générique le laisse déjà passer, aucun
 * versement n'étant exigé) ; le clavier physique n'ouvre plus de versement.
 */
test("retouche C : dû nul, ni moyens ni pavé, la phrase « Rien à encaisser » à leur place", () => {
  assert.match(paiement, /\{due > 0 \? \(/, "moyens affichés seulement à dû positif");
  assert.match(paiement, /<p className="text-sm text-muted-foreground">\{t\("caisse\.rien_a_encaisser"\)\}<\/p>/, "phrase à la place des moyens");
  assert.match(paiement, /\{due > 0 && \(\s*<div className="order-6 /, "afficheur du montant saisi caché à dû nul");
  assert.match(paiement, /\{due > 0 && \(\s*<div className="order-7 /, "montants rapides ou référence cachés à dû nul");
  assert.match(paiement, /\{due > 0 && \(\s*<div className="order-8 /, "pavé caché à dû nul");
  assert.match(paiement, /if \(!sending && due > 0\) setDraft\(\(d\) => pressKey\(d, action, due\)\);/, "le clavier physique n'ouvre plus de versement à dû nul");
});

/**
 * Relecture de la retouche C, mineur 1 (`retouches-C-review.md`) : sur
 * tablette, à dû nul, le bloc « Versements » (titre, « Aucun versement pour
 * l'instant. », « Reçu », « Reste à payer ») restait affiché sous la phrase
 * « Rien à encaisser… », ce qui la contredisait. Il est désormais caché au
 * même titre que l'afficheur, les montants rapides et le pavé.
 */
test("relecture, mineur 1 : dû nul, le bloc « Versements » (tablette) est caché lui aussi", () => {
  assert.match(paiement, /\{due > 0 && \(\s*<div className=\{cn\("order-4 /, "bloc « Versements » cadré par le même due > 0 que les autres");
});

/**
 * Relecture de la retouche C, mineur 2 (`retouches-C-review.md`) : si le dû
 * tombe à 0 pendant l'étape de paiement (refus « total », `onStale(0)`,
 * prix repassé à 0 F au catalogue) alors qu'un versement était déjà saisi,
 * le brouillon gardait cette entrée : `blocker` renvoyait « trop » et
 * « Valider » restait inactif alors qu'il n'y a plus rien à régler. Le
 * brouillon est désormais vidé dès que le dû devient nul.
 */
test("relecture, mineur 2 : dû tombant à 0 pendant l'étape vide le brouillon, « Valider » redevient utilisable", () => {
  assert.match(paiement, /useEffect\(\(\) => \{\s*if \(due === 0\) setDraft\(startPayment\(methods\)\);\s*\}, \[due\]\);/, "brouillon vidé dès que le dû devient nul");
});

test("carte et paiements mobiles : référence demandée, obligatoire pour Orange Money et MoMo", () => {
  assert.match(paiement, /REFERENCE_REQUIRED\.includes\(current\.method\) \? t\("caisse\.reference_obligatoire"\) : t\("caisse\.reference"\)/);
  assert.match(paiement, /setDraft\(setReference\(draft, draft\.active, \(e\.currentTarget as HTMLInputElement\)\.value\)\)/);
});

test("« Valider et émettre » actif seulement à reste nul, sans double envoi ; la même demande est renvoyée après une coupure", () => {
  assert.match(paiement, /disabled=\{stop !== null \|\| sending \|\| checking\} onClick=\{\(\) => \(error\?\.retry \? retry\(\) : send\(\)\)\}/);
  assert.match(paiement, /const body = \{ \.\.\.saleBody\(ticket\), payments: paymentsBody\(draft, due\)/);
  assert.match(paiement, /setError\(\{ message: e\.message, retry: e instanceof ApiError && \(e\.status === 0 \|\| e\.status >= 500\) \}\);/);
  assert.match(paiement, /error\?\.retry \? t\("caisse\.reessayer"\) : t\("caisse\.valider"\)/);
  assert.match(paiement, /\{stop && <p className=\{cn\("text-center text-sm text-muted-foreground", s\.change > 0 \? "" : "hidden @2xl:block"\)\}>\{blockerText\(stop, s\.remaining, lang\)\}<\/p>\}/);
  // Prix ou stock changés entre-temps : le catalogue est relu et le nouveau total s'affiche avant de valider (§ 7).
  // Mineur 2 de la relecture finale : le montant dû renvoyé par le serveur pour un refus « total » est transmis.
  assert.match(paiement, /if \(e instanceof ApiError && \(e\.code === "total" \|\| e\.code === "stock"\)\) onStale\(e\.code === "total" \? \(e\.body as \{ due\?: number \} \| null\)\?\.due : undefined\);/);
});

test("réponse perdue : retour au ticket bloqué tant que l'issue est inconnue, même demande renvoyée sans nouveau request_id", () => {
  // Tant que l'envoi est en cours, ou que la dernière réponse est perdue (réseau coupé, 5xx d'un relais), la seule
  // action possible est de renvoyer la même demande (même request_id) : le retour au ticket reste bloqué (§ 7).
  assert.match(paiement, /const retourBloque = sending \|\| checking \|\| error\?\.retry === true;/);
  assert.match(paiement, /<Button variant="ghost" className="-ml-3" disabled=\{retourBloque\} onClick=\{onBack\}>/);
  assert.match(paiement, /<Button variant="ghost" size="icon" className="-ml-3 @2xl:hidden" aria-label=\{t\("caisse\.retour_ticket"\)\} disabled=\{retourBloque\} onClick=\{onBack\}>/, "au téléphone : même blocage pour le chevron");
  assert.doesNotMatch(paiement, /newRequestId/, "le request_id n'est jamais régénéré côté paiement");
});

test("coupure ou refus (total, stock) pendant l'approbation : la fenêtre se ferme, l'erreur et « Réessayer l'envoi » redeviennent visibles", () => {
  assert.match(paiement, /\} else \{[\s\S]*?setApproval\(null\);\s*if \(e instanceof ApiError && \(e\.code === "total" \|\| e\.code === "stock"\)\) onStale\(e\.code === "total" \? \(e\.body as \{ due\?: number \} \| null\)\?\.due : undefined\);/);
});

test("remise au-delà du plafond : la gérante retape son mot de passe, la réception fait approuver par une gérante", () => {
  assert.match(paiement, /const done = await confirm\(\(\) => api<\{ invoice: Invoice \}>\("POST", "\/api\/sales", body\)\);/);
  assert.match(paiement, /e\.code === "approbation"\) \{\s*setApproval\(\{ refused: manager \? e\.message : null \}\);/);
  assert.match(paiement, /onApprove=\{\(login, password\) => send\(\{ login, password \}\)\}/);
  assert.match(paiement, /\.\.\.\(manager \? \{ approval: manager \} : \{\}\)/);
  assert.match(approbation, /<DialogContent compact focusChamp>/);
  assert.match(approbation, /id="approbation-mot-de-passe" type="password"/);
  assert.match(approbation, /<Erreur message=\{refused\} \/>/);
});

test("téléphone : une seule colonne dans l'ordre de la maquette ; tablette : récapitulatif à gauche, calculatrice à droite", () => {
  assert.equal((paiement.match(/<section className="contents @2xl:flex/g) ?? []).length, 2);
  for (let n = 1; n <= 9; n++) assert.match(paiement, new RegExp(`order-${n} `), `order-${n}`);
  assert.match(paiement, /className="sticky bottom-0 order-9 /, "« Valider et émettre » toujours en vue au téléphone");
  assert.match(paiement, /!plusieurs && "hidden"/, "au téléphone, la liste des versements à partir de deux");
  assert.match(paiement, /@2xl:w-\[24rem\] @2xl:shrink-0 @2xl:flex-col/);
});

test("après l'émission : numéro, total, versements, monnaie rendue et « Nouvelle vente »", () => {
  assert.match(emise, /<p className="chiffres font-serif text-4xl leading-tight">\{invoice\.number\}<\/p>/);
  assert.match(emise, /const change = invoice\.payments\.reduce\(\(sum, p\) => sum \+ p\.change_given, 0\);/);
  assert.match(emise, /onClick=\{onNew\}>\{t\("caisse\.nouvelle_vente"\)\}/);
});

test("pourboire sans praticienne connue (staff_name nul) : libellé sans nom", () => {
  assert.match(emise, /\{invoice\.tip\.staff_name \? t\("caisse\.pourboire_pour", \{ nom: invoice\.tip\.staff_name \}\) : t\("caisse\.pourboire_sans_nom"\)\}/);
});

/** Pied collant du téléphone (« Valider et émettre ») et colonne de gauche de la tablette. */
const pied = paiement.slice(paiement.indexOf('className="sticky bottom-0 order-9'), paiement.indexOf("</section>", paiement.indexOf('className="sticky bottom-0 order-9')));
const gauche = paiement.slice(paiement.indexOf("<section"), paiement.indexOf("</section>"));

// Retouche 1 (P1, décision produit du 30/09/2026) : au téléphone, le pavé entier tient à 390 × 844 et ne bouge plus.
test("téléphone : « À rendre » dans le pied collant, au-dessus de « Valider », dans un emplacement de hauteur fixe", () => {
  assert.ok(pied.length > 0);
  assert.match(pied, /<div className="flex h-14 flex-col justify-center @2xl:hidden">\s*\{s\.change > 0 \? \(/, "emplacement de 56 px, réservé même vide");
  assert.match(pied, /role="status"[^>]*bg-primary[^>]*>[\s\S]*\{changeText\(s\.change, lang, true\)\}/);
  assert.match(pied, /: stop && <p className="text-center text-sm text-muted-foreground">\{blockerText\(stop, s\.remaining, lang\)\}<\/p>\}/, "sans monnaie à rendre : ce qui bloque, à la même place");
  assert.ok(pied.indexOf("changeText(s.change, lang, true)") < pied.indexOf('<Button className="h-16 w-full'), "« À rendre » juste au-dessus du bouton");
  assert.doesNotMatch(gauche, /changeText\(s\.change, lang, true\)/, "plus rien ne s'insère au-dessus de l'afficheur");
  assert.match(gauche, /role="status" className="order-5 hidden [^"]*@2xl:mt-auto @2xl:flex/, "tablette : en bas de la colonne de gauche, comme la maquette");
});

test("téléphone : quatre moyens sur une rangée, retour et titre sur une ligne, libellé de l'afficheur lu seulement", () => {
  assert.match(paiement, /className="grid grid-cols-4 gap-2 @2xl:grid-cols-2 @4xl:grid-cols-4"/);
  assert.match(paiement, /<h2 className="etiquette sr-only text-encre-grise @2xl:not-sr-only">\{t\("caisse\.moyen_paiement"\)\}<\/h2>/);
  assert.match(paiement, /className="order-1 hidden items-center justify-between gap-3 @2xl:flex"/, "« Retour au ticket » écrit et nom de la cliente : tablette");
  assert.match(paiement, /<p id="caisse-saisie" className="etiquette sr-only text-encre-grise @2xl:not-sr-only">/);
  assert.match(paiement, /"h-16 border-filet px-1", k === "effacer"/, "touches de 64 px gardées");
});

// Retouche 7 (P2) : au poste fixe, le pavé répond au clavier physique ; l'écouteur n'existe que pendant l'étape.
test("clavier physique : écouteur posé avec l'écran de paiement, retiré à la fenêtre d'approbation, Entrée seulement si « Valider » est actif", () => {
  assert.match(paiement, /useEffect\(\(\) => \{\s*if \(approval\) return;[\s\S]*?document\.addEventListener\("keydown", onKey\);\s*return \(\) => document\.removeEventListener\("keydown", onKey\);\s*\}, \[approval\]\);/);
  assert.match(paiement, /const action = padAction\(e, placeOf\(e\.target, racine\.current\)\);/);
  assert.match(paiement, /e\.preventDefault\(\);\s*if \(action === "valider"\) \{\s*\/\/ Touche maintenue : un seul envoi\.\s*if \(stop === null && !sending && !checking && !e\.repeat\) void \(error\?\.retry \? retry\(\) : send\(\)\);\s*return;/);
  assert.match(paiement, /setDraft\(\(d\) => pressKey\(d, action, due\)\)/);
  assert.match(paiement, /if \(target\.closest\('\[role="dialog"\]'\) \|\| \(root !== null && !root\.contains\(target\)\)\) return "fenetre";/, "rien au pavé derrière une fenêtre, ni depuis le rail ou un panneau");
  assert.match(paiement, /<button key=\{i\} type="button" data-pave className=/, "montants rapides reconnus");
  assert.match(paiement, /variant="outline"\s*data-pave\s/, "touches du pavé reconnues");
  assert.match(paiement, /if \(target\.closest\("\[data-pave\]"\)\) return "pave";/);
  assert.doesNotMatch(paiement, /window\.addEventListener/);
});

// Retouche 8 (P3) : règle des chiffres de registre (DESIGN.md), montants rapides lisibles.
test("montants en chiffres de la charte : « Montant exact · … » et montants rapides en text-lg", () => {
  assert.match(paiement, /aroundAmount\(t\("caisse\.montant_exact", \{ montant: formatAmount\(amount, lang\) \}\), formatAmount\(amount, lang\)\)/);
  assert.match(paiement, /<span className="chiffres text-lg">\{exact\[1\]\}<\/span>/);
  assert.match(paiement, /<span className="chiffres text-lg">\{formatAmount\(amount, lang\)\}<\/span>/);
});

/**
 * Retouche P3 (critique.md du 1er octobre 2026) : au téléphone, le préréglage du montant exact ne
 * disait plus que « Exact », le chiffre perdu (lisible juste au-dessus dans l'afficheur, mais une
 * occasion de reconnaissance en moins pour une réceptionniste qui enchaîne les encaissements).
 * Réintroduit, compacté (« Exact · 25 000 » plutôt que « Montant exact · 25 000 »), sans déborder
 * à 390 px (cible de 44 px déjà tenue par le bouton de 48 px, `min-h-12`).
 */
test("retouche P3 : au téléphone, le préréglage exact garde son montant, compacté", () => {
  assert.match(paiement, /const exactCourt = aroundAmount\(t\("caisse\.exact_court", \{ montant: formatAmount\(amount, lang\) \}\), formatAmount\(amount, lang\)\);/);
  assert.match(paiement, /<span className="text-xs leading-tight @2xl:hidden">\{exactCourt\[0\]\}<span className="chiffres">\{exactCourt\[1\]\}<\/span>\{exactCourt\[2\]\}<\/span>/);
  assert.doesNotMatch(paiement, /<span className="@2xl:hidden">\{t\("caisse\.exact"\)\}<\/span>/, "l'ancien libellé sans chiffre a disparu");
  const fr = read("../../i18n/fr.ts");
  const en = read("../../i18n/en.ts");
  assert.match(fr, /"caisse\.exact_court": "Exact · \{montant\}",/);
  assert.match(en, /"caisse\.exact_court": "Exact · \{montant\}",/);
  assert.doesNotMatch(fr, /"caisse\.exact":/, "clé devenue orpheline, retirée");
  assert.doesNotMatch(en, /"caisse\.exact":/);
});

// Retouche 5 (critique du 30/09/2026) : la gérante voit ce qu'elle approuve, la remise (libellé avec
// le pourcentage ou le motif, montant) et le total après remise, en chiffres de la charte.
test("retouche 5 : la fenêtre d'approbation montre la remise, son motif et le total après remise", () => {
  assert.match(approbation, /discount: \{ label: string; amount: number \};/);
  assert.match(approbation, /total: number;/);
  assert.match(approbation, /<dt className="min-w-0">\{discount\.label\}<\/dt>\s*<dd className="chiffres-tabulaires text-base whitespace-nowrap">\{"\\u2013\\u00a0"\}<Montant valeur=\{formatPrice\(discount\.amount, lang\)\} \/><\/dd>/);
  assert.match(approbation, /<dt className="etiquette">\{t\("caisse\.total"\)\}<\/dt>\s*<dd className="chiffres-tabulaires text-base whitespace-nowrap"><Montant valeur=\{formatPrice\(total, lang\)\} \/><\/dd>/);
  assert.ok(approbation.indexOf("<DialogDescription>") < approbation.indexOf("discount.label"), "sous la description");
  assert.ok(approbation.indexOf("discount.label") < approbation.indexOf("<form"), "avant l'identifiant et le mot de passe");
  assert.match(paiement, /import \{ aroundAmount, blockerText, changeText, discountLabel, methodLabel \} from "@\/lib\/caisse-texte";/);
  assert.match(paiement, /discount=\{\{ label: ticket\.discount \? discountLabel\(ticket\.discount, lang\) : "", amount: totals\.discount_amount \}\}\s*total=\{totals\.total_ttc\}/);
  // Retouche vague 3a (commit 1) : `discount_cap` optionnel dans la réponse réduite (jamais atteinte ici), valeur de secours pour `tsc`.
  assert.match(paiement, /cap=\{settings\.discount_cap \?\? 0\}/);
});
