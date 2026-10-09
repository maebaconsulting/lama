import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { invoicePdfPath, pdfFileName, printsInFrame } from "./ticket-pdf.ts";

/** « Imprimer » et « Télécharger » le ticket PDF (sous-projet 5 § 5.1) : adresses, nom du fichier, appareil, câblage des écrans. */

test("adresses du PDF : affiché pour imprimer, en pièce jointe pour télécharger ; fichier au numéro de la facture", () => {
  assert.equal(invoicePdfPath(12), "/api/invoices/12/pdf");
  assert.equal(invoicePdfPath(12, true), "/api/invoices/12/pdf?telecharger=1");
  assert.equal(pdfFileName("FAC-2026-000001"), "FAC-2026-000001.pdf");
});

test("impression dans un cadre caché, sauf sur iPhone et iPad (un iPad se présente comme un Mac tactile)", () => {
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  assert.equal(printsInFrame("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0", 0), true);
  assert.equal(printsInFrame("Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0", 0), true);
  assert.equal(printsInFrame(mac, 0), true);
  assert.equal(printsInFrame(mac, 5), false, "iPad");
  assert.equal(printsInFrame("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5), false);
});

test("écrans : récapitulatif après l'émission et fiche d'un rendez-vous payé (gérante et réception), sans fetch", () => {
  const boutons = readFileSync("src/client/components/caisse/boutons-ticket.tsx", "utf8");
  assert.doesNotMatch(boutons, /fetch\(/);
  assert.match(boutons, /contentWindow\?\.print\(\)/);
  assert.match(boutons, /a\.download = doc\.fileName/);
  assert.match(boutons, /const doc = source \?\? invoiceSource\(invoice!\);/, "ticket d'une facture par défaut, ou celui donné (clôture)");
  assert.match(boutons, /t\("caisse\.imprimer"\)/);
  assert.match(boutons, /t\("caisse\.telecharger"\)/);
  const emise = readFileSync("src/client/components/caisse/emise.tsx", "utf8");
  assert.match(emise, /<BoutonsTicket invoice=\{invoice\} direct=\{\{ kind: "invoice", id: invoice\.id \}\} outcome=\{invoice\} \/>/);
  assert.ok(emise.indexOf("<BoutonsTicket") < emise.indexOf("caisse.nouvelle_vente"), "avant « Nouvelle vente »");
  const fiche = readFileSync("src/client/components/appointment-detail.tsx", "utf8");
  assert.match(fiche, /apt\.invoice_id && canSell\(account\.role\) && <BoutonsTicket/);
  assert.match(fiche, /apt\.invoice_id && canSell\(account\.role\) && \(\s*<div/, "fiche payée (invoice_total) : boutons du ticket seulement si canSell (correctif final)");
  assert.equal(fiche.split('invoice={{ id: apt.invoice_id, number: apt.invoice_number }} direct={{ kind: "invoice", id: apt.invoice_id }}').length - 1, 2, "les deux boutons du ticket portent l'impression directe");
  assert.match(fiche, /<div className="@md:col-span-2">\s*<dt className="sr-only">\{t\("caisse\.ticket_pdf"\)\}<\/dt>\s*<dd>\s*<BoutonsTicket/, "boutons du ticket dans un groupe dt\/dd valide, enfant du dl (correctif final)");
});

test("PDF vérifié avant l'impression ou le téléchargement : la porte d'entrée unique de l'API, jamais fetch, un refus affiché en clair", () => {
  const boutons = readFileSync("src/client/components/caisse/boutons-ticket.tsx", "utf8");
  assert.match(boutons, /import \{ api, apiBlob, ApiError \} from "\.\.\/\.\.\/api"/, "seule la porte d'entrée de l'API, jamais fetch directement");
  assert.match(boutons, /apiBlob\(doc\.path\)/, "le PDF est demandé, pas ouvert à l'aveugle");
  assert.match(boutons, /err instanceof ApiError \? err\.message : t\("erreur\.reseau"\)/, "message traduit du serveur, ou repli traduit");
  assert.match(boutons, /role="alert"/, "l'échec est affiché, pas seulement dans la console");
  assert.match(boutons, /URL\.createObjectURL\(blob\)/, "impression et téléchargement depuis une adresse d'objet");
  assert.match(boutons, /URL\.revokeObjectURL\(url\)/, "l'adresse d'objet est révoquée après usage");
});

test("iPhone et iPad : l'onglet s'ouvre dans le geste du clic, avant l'attente du PDF", () => {
  const boutons = readFileSync("src/client/components/caisse/boutons-ticket.tsx", "utf8");
  const openIndex = boutons.indexOf('window.open("", "_blank")');
  const awaitIndex = boutons.indexOf("await pdf()");
  assert.ok(openIndex >= 0, "onglet vide ouvert de façon synchrone");
  assert.ok(awaitIndex >= 0, "attente du PDF");
  assert.ok(openIndex < awaitIndex, "l'onglet s'ouvre avant l'attente, dans le geste de la personne");
  assert.match(boutons, /tab\.opener = null/, "l'onglet garde sa poignée (pas de noopener) pour recevoir l'adresse ensuite");
  assert.match(boutons, /tab\.location\.href = url/, "succès : l'onglet vide reçoit l'adresse du PDF");
  assert.match(boutons, /tab\?\.close\(\)/, "échec : l'onglet vide se referme au lieu de rester vide sans explication");
});

test("cadre d'impression : révoqué et retiré à la fin de l'impression (afterprint), jamais avant le repli", () => {
  const boutons = readFileSync("src/client/components/caisse/boutons-ticket.tsx", "utf8");
  assert.match(boutons, /addEventListener\("afterprint", cleanup\)/, "nettoyage à la fin de l'impression, pas au chargement du cadre");
  assert.match(boutons, /setTimeout\(cleanup, 60000\)/, "filet de sécurité si «\u00a0afterprint\u00a0» ne survient jamais (Firefox notamment)");
  assert.doesNotMatch(boutons, /finally \{\s*URL\.revokeObjectURL/, "jamais de révocation immédiate au chargement du cadre");
  const catchIndex = boutons.indexOf('window.open(url, "_blank", "noopener")');
  const cleanupDeclIndex = boutons.indexOf("const cleanup = ()");
  assert.ok(catchIndex > cleanupDeclIndex, "le repli existe après la déclaration du nettoyage");
});
