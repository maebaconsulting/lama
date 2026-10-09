import assert from "node:assert/strict";
import { test } from "node:test";
import type { TicketRow } from "../caisse/ticket.ts";
import { ticketRows, type TicketDocument } from "../caisse/ticket.ts";
import { COLUMNS, decodeCp858 as readable, OPEN_DRAWER, pairLines, rasterBytes, ticketBytes, toCp858Text, wrap } from "./escpos.ts";

test("CP858 : accents français gardés, œ écrit « oe », espaces insécables et signe moins ramenés, inconnu sur sa lettre de base", () => {
  assert.equal(toCp858Text("Aïcha, Grâce, éclat, Crème, ça, Ô, «\u00a0ok\u00a0»"), "Aïcha, Grâce, éclat, Crème, ça, Ô, « ok »");
  assert.equal(toCp858Text("Cœur, ŒUVRE"), "Coeur, OEUVRE");
  assert.equal(toCp858Text("13\u202f000\u00a0FCFA, \u22123\u202f000"), "13 000 FCFA, -3 000");
  assert.equal(toCp858Text("Ọlá ❤"), "Olá ?");
});

test("découpe aux espaces sur la largeur, mot trop long coupé", () => {
  assert.deepEqual(wrap("Soin du visage éclat", 10), ["Soin du", "visage", "éclat"]);
  assert.deepEqual(wrap("abcdefghijkl", 5), ["abcde", "fghij", "kl"]);
});

test("paire : montant entier à droite de la première ligne, libellé long continué en dessous", () => {
  const lines = pairLines("Soin du visage éclat avec masque hydratant et massage crânien", "25 000 FCFA", COLUMNS);
  assert.equal(lines[0].length, COLUMNS);
  assert.ok(lines[0].endsWith(" 25 000 FCFA"));
  assert.equal(lines[1], "hydratant et massage crânien");
  assert.deepEqual(pairLines("Total", "57 000 FCFA", 20), ["Total    57 000 FCFA"]);
});

test("paire : texte de droite aussi large que la ligne, seul sur sa ligne et tronqué, sans erreur", () => {
  assert.deepEqual(pairLines("Total", "0123456789ABCDEFGHIJ", 20), ["Total", "0123456789ABCDEFGHIJ"]);
  assert.deepEqual(pairLines("Total", "0123456789ABCDEFGHIJKL", 20), ["Total", "0123456789ABCDEFGHIJ"]);
});

const ROWS: TicketRow[] = [
  { type: "text", text: "Institut Akwa", style: "nom", align: "center" },
  { type: "rule" },
  { type: "text", text: "FACTURE", style: "titre", align: "center" },
  { type: "text", text: "FAC-2026-000001", style: "numero", align: "center" },
  { type: "pair", left: "Crème", right: "35\u202f000\u00a0FCFA", style: "corps" },
  { type: "pair", left: "Total TTC", right: "57\u202f000\u00a0FCFA", style: "total" },
];

test("ticket : initialisation, table 19, styles, centrage, filet, avance et coupe ; mêmes octets à chaque fois", () => {
  const bytes = ticketBytes(ROWS);
  assert.deepEqual([...bytes.subarray(0, 5)], [0x1b, 0x40, 0x1b, 0x74, 19]);
  assert.deepEqual([...bytes.subarray(-7)], [0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00]);
  const s = readable(bytes);
  assert.match(s, /\x1b!\x18\x1ba\x01Institut Akwa\n/, "nom en gras double hauteur, centré");
  assert.match(s, /\x1b!\x00\x1ba\x00-{48}\n/, "filet de 48 tirets");
  assert.match(s, /\x1b!\x08\x1ba\x01FACTURE\nFAC-2026-000001\n/);
  assert.match(s, /Crème {32}35 000 FCFA\n/);
  assert.match(s, /\x1b!\x18Total TTC {28}57 000 FCFA\n/);
  assert.deepEqual(ticketBytes(ROWS), bytes);
  assert.ok(!bytes.includes(0x10), "jamais d'octet 0x10 (début d'une demande d'état) dans un ticket");
});

test("duplicata : « DUPLICATA » en gras centré juste sous le titre, une seule fois", () => {
  const s = readable(ticketBytes(ROWS, { duplicate: "DUPLICATA" }));
  assert.match(s, /FACTURE\nDUPLICATA\nFAC-2026-000001/);
  assert.equal(s.split("DUPLICATA").length, 2);
  assert.doesNotMatch(readable(ticketBytes(ROWS)), /DUPLICATA/);
});

test("tiroir : impulsion ESC p 0 25 250", () => {
  assert.deepEqual([...OPEN_DRAWER], [0x1b, 0x70, 0x00, 0x19, 0xfa]);
});

test("image raster : GS v 0, largeur en octets et hauteur en points, petit-boutiste, puis les octets", () => {
  const img = { width: 16, height: 2, bits: Buffer.from([0xff, 0x00, 0x0f, 0xf0]) };
  assert.deepEqual(rasterBytes(img), [0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0, 0xff, 0x00, 0x0f, 0xf0]);
});

test("ticket avec logo : image centrée avant le nom ; sans image, la rangée logo n'imprime rien", () => {
  const img = { width: 8, height: 1, bits: Buffer.from([0xaa]) };
  const rows = [{ type: "logo" as const }, { type: "text" as const, text: "Institut Zeta", style: "nom" as const, align: "center" as const }];
  const withLogo = [...ticketBytes(rows, { logo: img })];
  const raster = [0x1d, 0x76, 0x30, 0x00, 1, 0, 1, 0, 0xaa];
  const at = withLogo.findIndex((_, i) => raster.every((b, j) => withLogo[i + j] === b));
  assert.ok(at > 0, "image présente");
  assert.deepEqual(withLogo.slice(at - 3, at), [0x1b, 0x61, 0x01], "centrée");
  assert.ok(readable(Buffer.from(withLogo.slice(at))).includes("Institut Zeta"), "nom après l'image");
  const without = [...ticketBytes(rows)];
  assert.equal(without.findIndex((_, i) => without[i] === 0x1d && without[i + 1] === 0x76), -1);
});

test("ticket papier : rangées de fidélité de ticketRows, comme le PDF ; accents gardés, signe moins ramené", () => {
  const doc: TicketDocument = {
    kind: "invoice", number: "FAC-2026-000003", issued_at: Date.parse("2026-10-04T09:00:00Z"), lang: "fr",
    fiscal: { tva_active: false, tva_taux: 0, niu: "", rccm: "", nom: "Institut Akwa", adresse: "", telephone: "", mentions_fr: "", mentions_en: "", marque_documents: "logo_nom" },
    client_name: "Aïcha Mbida", account_name: "Grâce",
    lines: [{ label_fr: "Soin du visage éclat", label_en: "Radiance facial", quantity: 1, unit_price: 25000, line_total: 25000, staff_name: null }],
    subtotal: 25000, discount_amount: 5000, discount_kind: "amount", discount_value: 5000, discount_reason: "fidelite",
    total_ttc: 20000, total_ht: 20000, total_tva: 0,
    payments: [{ method: "card", amount: 20000, reference: "", cash_given: null, change_given: 0 }], tip: null,
    loyalty: { earned: 20, reward: 100, taken: 0, restored: 0, balance: 40 },
  };
  const s = readable(ticketBytes(ticketRows(doc)));
  assert.match(s, /Récompense +-100 points\n/);
  assert.match(s, /Points gagnés +\+20\n/);
  assert.match(s, /Solde fidélité +40 points\n/);
});