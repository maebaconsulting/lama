import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parsePanel, withPanel } from "../../lib/routes.ts";

/**
 * Fiche d'une facture ou d'un avoir dans le panneau et formulaire « Émettre
 * un avoir » (sous-projet 5 § 6.1), câblés sur `lib/avoir.ts` (testé en
 * exécution) : droits, montant calculé comme le serveur, identifiant gardé,
 * avoir émis ouvert à la place.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const fiche = read("./fiche-facture.tsx");
const formulaire = read("./formulaire-avoir.tsx");
const app = read("../../app.tsx");

test("panneau « facture » : adresse dans les deux langues, gérante et réception seulement", () => {
  assert.deepEqual(parsePanel("/caisse?facture=12"), { kind: "invoice", id: "12" });
  assert.deepEqual(parsePanel("/till?invoice=12"), { kind: "invoice", id: "12" });
  assert.equal(withPanel("/clientes?cliente=3", { kind: "invoice", id: "7" }, "fr"), "/clientes?facture=7");
  assert.match(app, /case "invoice":\s*return canSell\(role\) \? <Panneau titre=\{t\("panneau\.facture"\)\} onClose=\{closePanel\}><FicheFacture key=\{itemId\} id=\{itemId\} \/><\/Panneau> : null;/);
});

test("versements : monnaie rendue affichée comme au ticket, remboursement en valeur absolue commenté", () => {
  // Correctif final (point 2) : alignée sur le ticket (server/caisse/ticket.ts), l'argent donné ne suffit pas sans la monnaie rendue.
  assert.match(fiche, /const change = inv\.payments\.reduce\(\(sum, p\) => sum \+ p\.change_given, 0\);/);
  assert.match(fiche, /\{change > 0 && <Rangee libelle=\{t\("caisse\.monnaie_rendue"\)\} montant=\{formatPrice\(change, lang\)\} \/>\}/);
  assert.match(fiche, /\/\/.*[Rr]emboursements?.*négatifs?.*\n\s*<Rangee key=\{i\}/, "Math.abs commenté : remboursements négatifs en base, montré en valeur absolue");
});

test("fiche : lue par l'API, suivie en direct, ticket imprimable, avoirs émis ouverts dans le panneau", () => {
  assert.match(fiche, /useLoad\(\(\) => api<\{ invoice: Invoice \}>\("GET", `\/api\/invoices\/\$\{id\}`\)\.then\(\(r\) => r\.invoice\), \["invoices"\]\)/);
  assert.match(fiche, /<BoutonsTicket key=\{inv\.id\} invoice=\{inv\} direct=\{\{ kind: inv\.kind === "credit_note" \? "credit" : "invoice", id: inv\.id \}\} \/>/);
  assert.match(fiche, /onClick=\{\(\) => openPanel\("invoice", c\.id\)\}/);
  assert.match(fiche, /onClick=\{\(\) => openPanel\("invoice", inv\.credited_invoice_id!\)\}/, "un avoir mène à la facture corrigée");
  assert.match(fiche, /t\(note \? "facture\.etabli_par" : "facture\.encaisse_par"\)/);
  assert.match(fiche, /\{!note && l\.credited > 0 && <span className="block text-sm text-muted-foreground">\{tn\("facture\.reprise", l\.credited\)\}<\/span>\}/);
});

/**
 * Retouche P2 (critique.md du 1er octobre 2026) : le montant de « Avoirs sur cette facture » se
 * composait en police d'interface (Jost) alors que tous les autres montants de la fiche sont en
 * chiffres elzéviriens (EB Garamond, classe `chiffres`). Sorti de la phrase traduite comme
 * `encaisser` dans `ticket-vente.tsx`.
 */
test("retouche P2 : « Avoirs sur cette facture » en chiffres de la charte, comme le reste de la fiche", () => {
  assert.match(fiche, /const reprise = aroundAmount\(t\("facture\.reprise_partielle", \{ montant: formatPrice\(inv\.credited_total, lang\) \}\), formatPrice\(inv\.credited_total, lang\)\);/);
  assert.match(fiche, /<p className="text-sm text-muted-foreground">\{reprise\[0\]\}<span className="chiffres">\{reprise\[1\]\}<\/span>\{reprise\[2\]\}<\/p>/);
  assert.doesNotMatch(fiche, /\{t\("facture\.reprise_partielle", \{ montant: formatPrice\(inv\.credited_total, lang\) \}\)\}/, "le montant n'est plus composé dans le texte traduit");
});

test("« Émettre un avoir » : facture non entièrement reprise, gérante ou réception autorisée ; avoir émis ouvert à la place", () => {
  assert.match(fiche, /const allowed = !note && !inv\.cancelled && canCredit\(account\.role, settings\.data\);/);
  assert.match(fiche, /onDone=\{\(created\) => \{ setCrediting\(false\); openPanel\("invoice", created\.id\); \}\}/);
});

test("formulaire : identifiant tiré une fois, montant et blocage par lib/avoir, envoi à /api/credit-notes, message du serveur gardé", () => {
  assert.match(formulaire, /useState<CreditDraft>\(\(\) => startCredit\(invoice, newRequestId\(\)\)\)/);
  assert.match(formulaire, /const preview = creditPreview\(invoice, draft\);/);
  assert.match(formulaire, /const stop = creditBlocker\(invoice, draft\);/);
  assert.match(formulaire, /api<\{ credit_note: Invoice \}>\("POST", "\/api\/credit-notes", \{ \.\.\.creditBody\(invoice, draft\), \.\.\.\(printer && print \? \{ print: true \} : \{\}\) \}\)/);
  assert.match(formulaire, /setError\(err instanceof ApiError \? err\.message : t\("erreur\.reseau"\)\);/);
  assert.match(formulaire, /disabled=\{stop !== null \|\| sending\} onClick=\{send\}/);
  assert.match(formulaire, /\{line\.kind === "product" && \(\s*<Case id=\{`avoir-stock-\$\{d\.line_id\}`\} label=\{t\("avoir\.remettre_stock"\)\}/, "« Remettre en stock » pour un produit seulement");
  assert.match(formulaire, /size="icon" aria-label=\{t\("avoir\.moins", \{ designation: name \}\)\}/, "− et + de 44 px, nommés");
});

test("acompte déduit (vague 3b) : sous « Versements », avant les moyens, sous son numéro de reçu", () => {
  const fiche = readFileSync(new URL("./fiche-facture.tsx", import.meta.url), "utf8");
  assert.match(fiche, /\{\(inv\.payments\.length > 0 \|\| \(inv\.deposits \?\? \[\]\)\.length > 0\) && \(/);
  assert.match(fiche, /\{\(inv\.deposits \?\? \[\]\)\.map\(\(d\) => <Rangee key=\{d\.id\} libelle=\{t\("facture\.acompte", \{ numero: d\.number \}\)\} montant=\{formatPrice\(d\.amount, lang\)\} \/>\)\}/);
});

// Correctif tâche 6 (joint, report de la tâche 3) : rappel de l'acompte déjà versé, près du remboursement.
test("avoir : phrase discrète rappelant l'acompte déjà versé quand la facture en a un", () => {
  assert.match(formulaire, /const acompte = completesInvoice\(invoice, draft\) \? \(invoice\.deposits \?\? \[\]\)\[0\] \?\? null : null;/);
  assert.match(formulaire, /\{acompte && <p className="text-sm text-muted-foreground">\{t\("avoir\.remboursement_acompte", \{ numero: acompte\.number, montant: formatPrice\(acompte\.amount, lang\) \}\)\}<\/p>\}/);
});

// Mineur 4 (relecture finale) : la phrase ne se montre qu'un avoir qui reprend toute la facture.
test("avoir : rappel de l'acompte seulement quand l'avoir reprend toute la facture (toutes les quantités)", () => {
  assert.match(formulaire, /completesInvoice, creditBlocker, creditBody, creditPreview/);
});
