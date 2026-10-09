import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Factures et avoirs dans la fiche d'une cliente, et numéro de facture de la
 * fiche d'un rendez-vous ouvert dans le panneau (sous-projet 5 § 6.1) : c'est
 * de là que la gérante retrouve une facture d'un autre jour pour l'avoir.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const liste = read("./factures-cliente.tsx");
const cliente = read("../fiches/fiche-cliente.tsx");
const rdv = read("../appointment-detail.tsx");

test("fiche de la cliente : ses factures et avoirs, gérante et réception seulement, suivis en direct", () => {
  assert.match(cliente, /\{canSell\(account\.role\) && <FacturesCliente clientId=\{client\.id\} \/>\}/);
  assert.match(liste, /api<\{ invoices: InvoiceSummary\[\] \}>\("GET", `\/api\/invoices\?client_id=\$\{clientId\}`\)/);
  assert.match(liste, /\["invoices"\]/);
});

test("chaque document s'ouvre dans le panneau ; avoir en négatif, facture reprise signalée", () => {
  assert.match(liste, /onClick=\{\(\) => openPanel\("invoice", d\.id\)\}/);
  assert.match(liste, /d\.kind === "credit_note" \? signedPrice\(-d\.total_ttc, lang\) : formatPrice\(d\.total_ttc, lang\)/);
  assert.match(liste, /d\.cancelled === 1 \? t\("facture\.reprise_entiere"\)/);
});

test("fiche du rendez-vous payé : le numéro de facture ouvre la facture dans le panneau (gérante et réception)", () => {
  assert.match(rdv, /onClick=\{\(\) => openPanel\("invoice", apt\.invoice_id!\)\}/);
});
