import assert from "node:assert/strict";
import { test } from "node:test";
import { formatFrancsDocument } from "../../shared/caisse.ts";
import { ticketFiscal } from "./routes.ts";
import { discountReasonText, printable, ticketDate, ticketInstant, ticketRows, type TicketDocument, type TicketRow } from "./ticket.ts";

/**
 * Contenu du ticket de 80 mm (sous-projet 5 § 5.1) : en-tête de l'institut,
 * titre, lignes, totaux avec ou sans TVA, versements, pourboire hors facture,
 * mentions et remerciement ; avoir et reçu d'acompte ; français et anglais.
 */

const FISCAL = {
  tva_active: true, tva_taux: 19.25, niu: "M012345678901A", rccm: "RC/DLA/2026/B/1234",
  nom: "Institut Akwa", adresse: "Rue des Palmiers, Bonapriso, Douala", telephone: "+237 699 00 00 00",
  mentions_fr: "Pas de reprise des produits ouverts.", mentions_en: "Opened products cannot be returned.",
};

/** Facture du test de l'API (vague 1) : soin et crème, remise fidélité de 5 %, pourboire, espèces et Orange Money. */
function invoice(over: Partial<TicketDocument> = {}): TicketDocument {
  return {
    kind: "invoice", number: "FAC-2026-000001", issued_at: Date.parse("2026-09-28T08:00:00Z"), lang: "fr", fiscal: FISCAL,
    client_name: "Aïcha Mbida", account_name: "Grâce",
    lines: [
      { label_fr: "Soin du visage éclat", label_en: "Radiance facial", quantity: 1, unit_price: 25000, line_total: 25000, staff_name: "Solange" },
      { label_fr: "Crème hydratante", label_en: "", quantity: 1, unit_price: 35000, line_total: 35000, staff_name: null },
    ],
    subtotal: 60000, discount_amount: 3000, discount_kind: "percent", discount_value: 5, discount_reason: "fidelite",
    total_ttc: 57000, total_ht: 47799, total_tva: 9201,
    payments: [
      { method: "cash", amount: 20000, reference: "", cash_given: 25000, change_given: 5000 },
      { method: "orange_money", amount: 39000, reference: "OM-4471", cash_given: null, change_given: 0 },
    ],
    tip: { amount: 2000, staff_name: "Solange" },
    ...over,
  };
}

/** Rangées écrites comme une personne lit le ticket : une ligne par rangée, « gauche | droite » pour une paire. */
function lines(rows: TicketRow[]): string[] {
  return rows.map((r) => (r.type === "rule" ? "----" : r.type === "pair" ? `${r.left} | ${r.right}` : r.text));
}

test("montant d'un document : « 13 000 FCFA », milliers et devise insécables", () => {
  assert.equal(formatFrancsDocument(13000), "13\u202f000\u00a0FCFA");
  assert.equal(formatFrancsDocument(0), "0\u00a0FCFA");
});

test("facture en français : en-tête, lignes, remise et motif, HT, TVA, TTC, versements, monnaie, pourboire hors facture, pied", () => {
  const nb = "\u00a0";
  assert.deepEqual(lines(ticketRows(invoice())), [
    "Institut Akwa",
    "Rue des Palmiers, Bonapriso, Douala",
    `Tél.${nb}+237 699 00 00 00`,
    `NIU${nb}: M012345678901A`,
    `RCCM${nb}: RC/DLA/2026/B/1234`,
    "----",
    "FACTURE",
    "FAC-2026-000001",
    "28/09/2026 09:00",
    `Cliente${nb}: Aïcha Mbida`,
    "Encaissé par Grâce",
    "----",
    `Soin du visage éclat | 25${nb}000${nb}FCFA`,
    `1${nb}×${nb}25${nb}000${nb}FCFA · Solange`,
    `Crème hydratante | 35${nb}000${nb}FCFA`,
    `1${nb}×${nb}35${nb}000${nb}FCFA`,
    "----",
    `Sous-total | 60${nb}000${nb}FCFA`,
    `Remise 5${nb}% | −3${nb}000${nb}FCFA`,
    "fidélité",
    `Total HT | 47${nb}799${nb}FCFA`,
    `TVA 19,25${nb}% | 9${nb}201${nb}FCFA`,
    `Total TTC | 57${nb}000${nb}FCFA`,
    "----",
    "Règlement",
    `Espèces | 25${nb}000${nb}FCFA`,
    `Orange Money · OM-4471 | 39${nb}000${nb}FCFA`,
    `Monnaie rendue | 5${nb}000${nb}FCFA`,
    `Total réglé | 59${nb}000${nb}FCFA`,
    "----",
    `Pourboire, hors facture | 2${nb}000${nb}FCFA`,
    "Pour Solange",
    "----",
    "Pas de reprise des produits ouverts.",
    "Merci de votre visite, à très bientôt",
    "propulsé par lama",
  ]);
});

test("facture en anglais : désignations anglaises (la française si l'anglaise manque), TVA en anglais, mentions anglaises", () => {
  const text = lines(ticketRows(invoice({ lang: "en" })));
  for (const expected of [
    "INVOICE", "Client: Aïcha Mbida", "Charged by Grâce", "Radiance facial | 25\u00a0000\u00a0FCFA", "Crème hydratante | 35\u00a0000\u00a0FCFA",
    "Discount 5% | −3\u00a0000\u00a0FCFA", "loyalty", "Total excl. VAT | 47\u00a0799\u00a0FCFA", "VAT 19.25% | 9\u00a0201\u00a0FCFA",
    "Total incl. VAT | 57\u00a0000\u00a0FCFA", "Payment", "Cash | 25\u00a0000\u00a0FCFA", "Change given | 5\u00a0000\u00a0FCFA",
    "Total paid | 59\u00a0000\u00a0FCFA",
    "Tip, not invoiced | 2\u00a0000\u00a0FCFA", "For Solange", "Opened products cannot be returned.", "Thank you for your visit, see you soon",
  ]) assert.ok(text.includes(expected), expected);
  assert.ok(!text.some((l) => /FACTURE|Merci|TVA/.test(l)));
  assert.equal(ticketRows(invoice({ lang: "en" })).length, ticketRows(invoice()).length);
});

test("TVA inactive : total seul et « TVA non applicable », ni HT ni ligne de TVA", () => {
  const off = { ...FISCAL, tva_active: false };
  const fr = lines(ticketRows(invoice({ fiscal: off, total_ht: 57000, total_tva: 0 })));
  assert.ok(fr.includes("Total | 57\u00a0000\u00a0FCFA"));
  assert.ok(fr.includes("TVA non applicable"));
  assert.ok(!fr.some((l) => l.startsWith("Total HT") || l.startsWith("TVA 19")));
  const en = lines(ticketRows(invoice({ lang: "en", fiscal: off, total_ht: 57000, total_tva: 0 })));
  assert.ok(en.includes("Total | 57\u00a0000\u00a0FCFA") && en.includes("VAT not applicable"));
});

test("sans remise, pourboire, NIU ni mentions : ces rangées disparaissent, rien de vide", () => {
  const rows = ticketRows(invoice({
    fiscal: { ...FISCAL, niu: "", rccm: " ", telephone: "", mentions_fr: "", mentions_en: "" },
    discount_amount: 0, discount_kind: null, discount_value: null, discount_reason: "", subtotal: 57000, tip: null, client_name: null,
  }));
  const text = lines(rows);
  assert.ok(!text.some((l) => /NIU|RCCM|Tél|Sous-total|Remise|Pourboire|Cliente/.test(l)));
  assert.ok(rows.every((r) => r.type !== "text" || r.text.trim() !== ""));
  assert.equal(text.filter((l) => l === "----").length, 5, "filets : en-tête, titre, lignes, versements, pied");
});

test("motif de remise : fidélité, geste commercial, texte libre ; montant sans pourcentage", () => {
  assert.equal(discountReasonText("geste", "fr"), "geste commercial");
  assert.equal(discountReasonText("geste", "en"), "goodwill gesture");
  assert.equal(discountReasonText("autre: anniversaire de la cliente", "fr"), "anniversaire de la cliente");
  const text = lines(ticketRows(invoice({ discount_kind: "amount", discount_value: 3000, discount_reason: "autre:Retard du soin" })));
  assert.ok(text.includes("Remise | −3\u00a0000\u00a0FCFA") && text.includes("Retard du soin"));
});

test("avoir : titre, facture corrigée, motif, total de l'avoir (apostrophe typographique), remboursement en positif, « Établi par » jamais « Encaissé par »", () => {
  const text = lines(ticketRows(invoice({
    kind: "credit_note", number: "AV-2026-000001", credited_number: "FAC-2026-000001", reason: "Produit défectueux",
    lines: [{ label_fr: "Crème hydratante", label_en: "Moisturising cream", quantity: 1, unit_price: 35000, line_total: 35000, staff_name: null }],
    subtotal: 35000, discount_amount: 0, discount_kind: null, discount_value: null, discount_reason: "", total_ttc: 35000, total_ht: 29350, total_tva: 5650,
    payments: [{ method: "cash", amount: -35000, reference: "", cash_given: null, change_given: 0 }], tip: null,
  })));
  for (const expected of ["AVOIR", "AV-2026-000001", "Facture corrigée\u00a0: FAC-2026-000001", "Motif\u00a0: Produit défectueux", "Total de l'avoir | 35\u00a0000\u00a0FCFA", "Remboursement", "Espèces | 35\u00a0000\u00a0FCFA", "Établi par Grâce"]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.ok(!text.some((l) => l.startsWith("Encaissé par")), "jamais « Encaissé par » sur un avoir");
  const en = lines(ticketRows(invoice({ kind: "credit_note", lang: "en", credited_number: "FAC-2026-000001" })));
  assert.ok(en.includes("CREDIT NOTE"));
  assert.ok(en.includes("Issued by Grâce"));
  assert.ok(!en.some((l) => l.startsWith("Charged by")), "jamais « Charged by » sur un avoir");
});

test("facture : toujours « Encaissé par », jamais « Établi par »", () => {
  const text = lines(ticketRows(invoice()));
  assert.ok(text.includes("Encaissé par Grâce"));
  assert.ok(!text.some((l) => l.startsWith("Établi par")));
});

test("« Total réglé » sous les versements, somme nette des montants appliqués, seulement pour une facture avec pourboire", () => {
  const sansMonnaie = invoice({
    payments: [
      { method: "cash", amount: 20000, reference: "", cash_given: 20000, change_given: 0 },
      { method: "orange_money", amount: 39000, reference: "OM-4471", cash_given: null, change_given: 0 },
    ],
  });
  const text2 = lines(ticketRows(sansMonnaie));
  assert.deepEqual(text2.slice(text2.indexOf("Règlement"), text2.indexOf("Règlement") + 4), [
    "Règlement",
    "Espèces | 20\u00a0000\u00a0FCFA",
    "Orange Money · OM-4471 | 39\u00a0000\u00a0FCFA",
    "Total réglé | 59\u00a0000\u00a0FCFA",
  ], "sans monnaie rendue, « Total réglé » suit directement les versements");

  const sansPourboire = lines(ticketRows(invoice({ tip: null })));
  assert.ok(!sansPourboire.some((l) => l.startsWith("Total réglé")), "sans pourboire : pas de « Total réglé »");

  const avoirAvecPourboire = lines(ticketRows(invoice({
    kind: "credit_note", credited_number: "FAC-2026-000001",
    payments: [{ method: "cash", amount: -35000, reference: "", cash_given: null, change_given: 0 }],
    tip: { amount: 2000, staff_name: "Solange" },
  })));
  assert.ok(!avoirAvecPourboire.some((l) => l.startsWith("Total réglé")), "un avoir n'a jamais de « Total réglé »");
});

test("reçu d'acompte : titre, rendez-vous cité, acompte reçu, versements, sans TVA ni lignes", () => {
  const doc = invoice({
    kind: "deposit", number: "AC-2026-000001", lines: [], subtotal: 10000, discount_amount: 0, discount_kind: null, discount_value: null, discount_reason: "",
    total_ttc: 10000, total_ht: 10000, total_tva: 0, appointment: { date: "2026-10-03", time: "10:00" },
    payments: [{ method: "momo", amount: 10000, reference: "MM-889", cash_given: null, change_given: 0 }], tip: null,
  });
  const fr = lines(ticketRows(doc));
  for (const expected of ["REÇU D'ACOMPTE", "AC-2026-000001", "Rendez-vous du 03/10/2026 à 10:00", "Acompte reçu | 10\u00a0000\u00a0FCFA", "MoMo · MM-889 | 10\u00a0000\u00a0FCFA"]) {
    assert.ok(fr.includes(expected), expected);
  }
  assert.ok(!fr.some((l) => /TVA|Total/.test(l)));
  const en = lines(ticketRows({ ...doc, lang: "en" }));
  assert.ok(en.includes("DEPOSIT RECEIPT") && en.includes("Appointment on 03/10/2026 at 10:00") && en.includes("Deposit received | 10\u00a0000\u00a0FCFA"));
});

test("renommage lama : « propulsé par lama » en pied de la facture, de l'avoir et du reçu d'acompte, dans leur langue ; aucun logo ; nom vide omis", () => {
  const avoir = invoice({ kind: "credit_note", number: "AV-2026-000001", credited_number: "FAC-2026-000001", reason: "Produit défectueux", tip: null });
  const acompte = invoice({ kind: "deposit", number: "AC-2026-000001", lines: [], tip: null, appointment: { date: "2026-10-03", time: "10:00" } });
  for (const doc of [invoice(), avoir, acompte]) {
    const fr = ticketRows(doc);
    assert.deepEqual(fr.at(-1), { type: "text", text: "propulsé par lama", style: "mention", align: "center" }, doc.kind);
    assert.deepEqual(ticketRows({ ...doc, lang: "en" }).at(-1), { type: "text", text: "powered by lama", style: "mention", align: "center" }, doc.kind);
    assert.ok(fr.every((r) => r.type === "text" || r.type === "pair" || r.type === "rule"), `${doc.kind} : aucune rangée de logo`);
  }
  const sansNom = ticketRows(invoice({ fiscal: { ...FISCAL, nom: "" } }));
  assert.ok(!sansNom.some((r) => r.type === "text" && r.style === "nom"), "nom vide : pas de ligne de nom");
  assert.equal(lines(sansNom)[0], "Rue des Palmiers, Bonapriso, Douala", "l'adresse ouvre le ticket");
});

test("texte imprimable : espace fine en espace insécable, accent absent des polices retiré, rien d'autre touché", () => {
  assert.equal(printable("13\u202f000\u00a0FCFA"), "13\u00a0000\u00a0FCFA");
  assert.equal(printable("Ngozi Ọkafor"), "Ngozi Okafor");
  assert.equal(printable("Łucja"), "?ucja");
  assert.equal(printable("Élégance « œuvre » ça – 19,25\u00a0% · 2 × 3 € ’"), "Élégance « œuvre » ça – 19,25\u00a0% · 2 × 3 € ’");
  assert.equal(printable("Ligne 1\nLigne 2"), "Ligne 1\nLigne 2");
  const all = ticketRows(invoice({ client_name: "Ọlá 13\u202f000" })).flatMap((r) => (r.type === "text" ? [r.text] : r.type === "pair" ? [r.left, r.right] : []));
  assert.ok(all.every((s) => !s.includes("\u202f")), "aucune espace fine ne reste : elle sortirait en carré");
  assert.ok(all.includes("Cliente\u00a0: Olá 13\u00a0000"));
});

test("date et heure d'émission à Douala, identiques dans les deux langues", () => {
  assert.equal(ticketInstant(Date.parse("2026-12-31T23:30:00Z")), "01/01/2027 00:30");
});

test("logo en tête : rangée logo puis nom ; « Logo seul » : nom en petit avec les mentions ; sans logo, nom en tête quel que soit le réglage", () => {
  const base = { ...invoice(), fiscal: { ...FISCAL, nom: "Institut Akwa", mentions_fr: "Merci de votre visite" } };
  const withLogo = ticketRows({ ...base, fiscal: { ...base.fiscal, marque_documents: "logo_nom" } }, { logo: true });
  assert.deepEqual(withLogo.slice(0, 2), [{ type: "logo" }, { type: "text", text: "Institut Akwa", style: "nom", align: "center" }]);
  const alone = ticketRows({ ...base, fiscal: { ...base.fiscal, marque_documents: "logo" } }, { logo: true });
  assert.deepEqual(alone[0], { type: "logo" });
  assert.ok(!alone.some((r) => r.type === "text" && r.style === "nom"), "pas de nom en tête");
  const legal = alone.findIndex((r) => r.type === "text" && r.text === "Merci de votre visite");
  assert.deepEqual(alone[legal - 1], { type: "text", text: "Institut Akwa", style: "mention", align: "center" });
  const noLogo = ticketRows({ ...base, fiscal: { ...base.fiscal, marque_documents: "logo" } });
  assert.deepEqual(noLogo[0], { type: "text", text: "Institut Akwa", style: "nom", align: "center" });
});

test("facture d'avant la vague B (fiscal sans marque_documents) : lue comme « Logo et nom »", () => {
  assert.equal(ticketFiscal({ nom: "Institut Akwa" }).marque_documents, "logo_nom");
  assert.equal(ticketFiscal({ nom: "Institut Akwa", marque_documents: "nimporte" as never }).marque_documents, "logo_nom");
  assert.equal(ticketFiscal({ nom: "Institut Akwa", marque_documents: "logo" }).marque_documents, "logo");
});

test("fidélité au ticket : récompense, points gagnés et solde figé sous les totaux ; rien sans écriture", () => {
  const nb = "\u00a0";
  const loyalty = { earned: 57, reward: 100, taken: 0, restored: 0, balance: 140 };
  const fr = lines(ticketRows(invoice({ loyalty })));
  const at = fr.indexOf(`Total TTC | 57${nb}000${nb}FCFA`);
  assert.deepEqual(fr.slice(at + 1, at + 7), ["----", `Récompense | −100${nb}points`, "Points gagnés | +57", `Solde fidélité | 140${nb}points`, "----", "Règlement"]);
  assert.deepEqual(lines(ticketRows(invoice({ loyalty: null }))), lines(ticketRows(invoice())), "sans écriture : ticket inchangé");
  const en = lines(ticketRows(invoice({ lang: "en", loyalty })));
  const atEn = en.indexOf(`Total incl. VAT | 57${nb}000${nb}FCFA`);
  assert.deepEqual(en.slice(atEn + 2, atEn + 5), [`Reward | −100${nb}points`, "Points earned | +57", `Loyalty balance | 140${nb}points`]);
});

test("fidélité sur un avoir : points repris, récompense rendue, solde ; singulier, zéro et solde négatif", () => {
  const nb = "\u00a0";
  const avoir = invoice({ kind: "credit_note", lang: "en", credited_number: "FAC-2026-000001", reason: "Produit défectueux", tip: null, loyalty: { earned: 0, reward: 0, taken: 22, restored: 100, balance: 100 } });
  const en = lines(ticketRows(avoir));
  const at = en.findIndex((l) => l.startsWith("Credit note total"));
  assert.deepEqual(en.slice(at + 1, at + 5), ["----", "Points taken back | −22", `Points returned | +100${nb}points`, `Loyalty balance | 100${nb}points`]);
  const solde = (balance: number, lang: "fr" | "en") => lines(ticketRows(invoice({ lang, loyalty: { earned: 1, reward: 0, taken: 0, restored: 0, balance } })));
  assert.ok(solde(1, "fr").includes(`Solde fidélité | 1${nb}point`));
  assert.ok(solde(0, "fr").includes(`Solde fidélité | 0${nb}point`));
  assert.ok(solde(0, "en").includes(`Loyalty balance | 0${nb}points`));
  assert.ok(solde(-5, "fr").includes(`Solde fidélité | −5${nb}points`));
  assert.ok(solde(1200, "fr").includes(`Solde fidélité | 1${nb}200${nb}points`), "milliers groupés, espace imprimable");
});

test("fidélité : pas de rangée pour un reçu d'acompte", () => {
  const dep = lines(ticketRows(invoice({ kind: "deposit", loyalty: { earned: 5, reward: 0, taken: 0, restored: 0, balance: 5 } })));
  assert.ok(!dep.some((l) => l.includes("fidélité")));
});
test("V1-79 : reçu d'acompte relu, sort imprimé sous « Acompte reçu » après un filet, dans la langue du reçu ; sans sort, rien ne change", () => {
  const doc = invoice({
    kind: "deposit", number: "AC-2026-000001", lines: [], subtotal: 10000, discount_amount: 0, discount_kind: null, discount_value: null, discount_reason: "",
    total_ttc: 10000, total_ht: 10000, total_tva: 0, appointment: { date: "2026-10-03", time: "10:00" },
    payments: [{ method: "momo", amount: 10000, reference: "MM-889", cash_given: null, change_given: 0 }], tip: null,
  });
  const at = Date.parse("2026-10-03T23:30:00Z"); // 04/10/2026 00:30 à Douala
  const held = ticketRows(doc);
  assert.deepEqual(ticketRows({ ...doc, fate: null }), held, "sort absent : reçu de l'encaissement inchangé");
  const applied = ticketRows({ ...doc, fate: { kind: "applied", invoice: "FAC-2026-000012", at } });
  const i = applied.findIndex((r) => r.type === "pair" && r.left === "Acompte reçu");
  assert.deepEqual(applied.slice(i + 1, i + 3), [{ type: "rule" }, { type: "text", text: "Déduit de la facture FAC-2026-000012 le 04/10/2026", style: "detail", align: "center" }]);
  assert.deepEqual([...applied.slice(0, i + 1), ...applied.slice(i + 3)], held, "deux rangées de plus, rien d'autre");
  assert.ok(lines(ticketRows({ ...doc, fate: { kind: "refunded", at } })).includes("Remboursé le 04/10/2026"));
  assert.ok(lines(ticketRows({ ...doc, fate: { kind: "kept", at } })).includes("Gardé le 04/10/2026"));
  const en = (fate: TicketDocument["fate"]) => lines(ticketRows({ ...doc, lang: "en", fate }));
  assert.ok(en({ kind: "applied", invoice: "FAC-2026-000012", at }).includes("Deducted from invoice FAC-2026-000012 on 04/10/2026"));
  assert.ok(en({ kind: "refunded", at }).includes("Refunded on 04/10/2026"));
  assert.ok(en({ kind: "kept", at }).includes("Kept on 04/10/2026"));
  assert.equal(ticketDate(at), "04/10/2026");
  // Une facture ne porte jamais de sort, même si le champ traînait.
  assert.ok(!lines(ticketRows(invoice({ fate: { kind: "kept", at } }))).some((l) => l.startsWith("Gardé")));
});
