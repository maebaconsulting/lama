import assert from "node:assert/strict";
import { test } from "node:test";
import { PNG } from "pngjs";
import { renderRows, renderTicket, TICKET_WIDTH, usableLogo } from "./ticket-pdf.ts";
import { ticketRows, type TicketDocument } from "./ticket.ts";

/**
 * Ticket en PDF (sous-projet 5 § 5.1) : 80 mm de large, hauteur selon le
 * contenu, une page, polices de la charte embarquées (jamais Helvetica),
 * aucune image sans logo déposé, métadonnées « lama », même document donc mêmes octets. Le texte lui-même est vérifié
 * sur les rangées (`ticket.test.ts`) : dans le PDF, il est codé en glyphes.
 */

const doc: TicketDocument = {
  kind: "invoice", number: "FAC-2026-000007", issued_at: Date.parse("2026-09-28T08:00:00Z"), lang: "fr",
  fiscal: { tva_active: true, tva_taux: 19.25, niu: "M012345678901A", rccm: "RC/DLA/2026/B/1234", nom: "Institut Akwa", adresse: "Bonapriso, Douala", telephone: "+237 699 00 00 00", mentions_fr: "Mentions légales de l'institut.", mentions_en: "" },
  client_name: "Aïcha Mbida", account_name: "Grâce",
  lines: [{ label_fr: "Soin du visage éclat", label_en: "Radiance facial", quantity: 1, unit_price: 25000, line_total: 25000, staff_name: "Solange" }],
  subtotal: 25000, discount_amount: 0, discount_kind: null, discount_value: null, discount_reason: "",
  total_ttc: 25000, total_ht: 20964, total_tva: 4036,
  payments: [{ method: "cash", amount: 25000, reference: "", cash_given: 30000, change_given: 5000 }],
  tip: null,
};

const latin = (pdf: Buffer) => pdf.toString("latin1");

function mediaBox(pdf: Buffer): [number, number] {
  const m = latin(pdf).match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  assert.ok(m, "MediaBox");
  return [Number(m[1]), Number(m[2])];
}

test("80 mm de large, une seule page, hauteur selon le contenu", async () => {
  const pdf = await renderTicket(doc);
  assert.equal(latin(pdf).slice(0, 5), "%PDF-");
  const [width, height] = mediaBox(pdf);
  assert.equal(Math.round(width * 100) / 100, 226.77);
  assert.equal(TICKET_WIDTH.toFixed(2), "226.77");
  assert.equal(latin(pdf).match(/\/Type \/Page\b/g)?.length, 1, "une page");
  assert.ok(height > 300 && height < 700, `hauteur ${height}`);
  const many = { ...doc, lines: Array.from({ length: 12 }, (_, i) => ({ ...doc.lines[0], label_fr: `Prestation ${i + 1} au nom assez long pour passer à la ligne` })) };
  const [, taller] = mediaBox(await renderTicket(many));
  assert.ok(taller > height + 12 * 20, `${taller} pour 12 lignes, ${height} pour 1`);
  assert.equal(latin(await renderTicket(many)).match(/\/Type \/Page\b/g)?.length, 1, "toujours une page");
});

test("polices de la charte embarquées, jamais une police standard", async () => {
  const text = latin(await renderTicket(doc));
  for (const name of ["EBGaramond-Regular", "EBGaramond-SemiBold", "Jost-Regular", "Jost-Medium"]) {
    assert.match(text, new RegExp(`/BaseFont /[A-Z]{6}\\+${name}`), name);
  }
  assert.ok(!/Helvetica|Times-Roman|Courier/.test(text));
  assert.match(text, /\/FontFile2/);
});

test("renommage lama : aucun logo dessiné, texte et filets noirs (instructions lisibles sans compression)", async () => {
  const text = latin(await renderTicket(doc, { compress: false }));
  assert.equal((text.match(/ c\n/g) ?? []).length, 0, "aucune courbe : le cygne a disparu");
  assert.match(text, /\n0 0 0 scn\n/, "texte noir");
  assert.match(text, /\n0 0 0 SCN\n/, "filets noirs");
  const colors = new Set(text.match(/\n[\d. ]+ (scn|SCN)\n/g));
  assert.deepEqual([...colors].sort(), ["\n0 0 0 SCN\n", "\n0 0 0 scn\n"], "aucune autre couleur que le noir");
});

test("même document, mêmes octets ; date du PDF = date d'émission ; titre = numéro", async () => {
  const a = await renderTicket(doc);
  const b = await renderTicket(doc);
  assert.ok(a.equals(b));
  const text = latin(a);
  assert.match(text, /\(D:20260928080000Z\)/, "date de création : l'émission, pas l'heure de la demande");
  assert.match(text, /\(FAC-2026-000007\)/, "titre : le numéro");
  assert.ok(!a.equals(await renderTicket({ ...doc, lang: "en" })), "l'anglais est un autre ticket");
});

test("renommage lama : Creator et Producer du PDF « lama », auteur = nom de l'institut", async () => {
  const text = latin(await renderTicket(doc, { compress: false }));
  // pdfkit range chaque valeur dans un objet à part : « /Creator 14 0 R » renvoie à « 14 0 obj\n(lama) ».
  const info = (key: string) => {
    const ref = text.match(new RegExp(`/${key} (\\d+) 0 R`))?.[1];
    return ref ? text.match(new RegExp(`\\n${ref} 0 obj\\n\\(([^)]*)\\)`))?.[1] : undefined;
  };
  assert.deepEqual([info("Creator"), info("Producer"), info("Author")], ["lama", "lama", "Institut Akwa"]);
});

test("TVA inactive et anglais : le PDF se fabrique aussi", async () => {
  const off = await renderTicket({ ...doc, lang: "en", fiscal: { ...doc.fiscal, tva_active: false }, total_ht: 25000, total_tva: 0 });
  assert.equal(latin(off).slice(0, 5), "%PDF-");
  assert.ok(mediaBox(off)[1] < mediaBox(await renderTicket(doc))[1], "deux rangées de moins (HT et TVA), une de plus (non applicable)");
});

test("PDF avec logo : une image est dessinée ; sans logo ou avec une image illisible, aucun échec et aucune image", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const rows = [{ type: "logo" as const }, { type: "text" as const, text: "Institut Akwa", style: "nom" as const, align: "center" as const }];
  const meta = { title: "F-1", author: "Institut Akwa", date: 0 };
  const withImage = (await renderRows(rows, meta, { compress: false, logo: png })).toString("latin1");
  assert.match(withImage, /\/Subtype \/Image/);
  const without = (await renderRows(rows, meta, { compress: false })).toString("latin1");
  assert.doesNotMatch(without, /\/Subtype \/Image/);
  const broken = (await renderRows(rows, meta, { compress: false, logo: Buffer.from("abîmé") })).toString("latin1");
  assert.doesNotMatch(broken, /\/Subtype \/Image/);
});

test("« Logo seul » avec un logo illisible : le nom reste en tête, aucune image, le PDF se termine", async () => {
  const alone = { ...doc, fiscal: { ...doc.fiscal, marque_documents: "logo" as const } };
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  // PNG d'en-tête valide dont les données (IDAT) sont abîmées : pdfkit lèverait une exception non interceptée.
  const big = PNG.sync.write(Object.assign(new PNG({ width: 8, height: 8 }), { data: Buffer.alloc(8 * 8 * 4, 200) }));
  const at = big.indexOf("IDAT") + 4;
  const corrupt = Buffer.concat([big.subarray(0, at), Buffer.alloc(12, 0x55), big.subarray(at + 12)]);
  for (const logo of [Buffer.from("abîmé"), corrupt]) {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("PDF jamais terminé")), 5000).unref());
    const out = (await Promise.race([renderTicket(alone, { compress: false, logo }), timeout])).toString("latin1");
    assert.doesNotMatch(out, /\/Subtype \/Image/);
  }
  const rows = ticketRows(alone, { logo: usableLogo(corrupt) !== null });
  assert.deepEqual(rows[0], { type: "text", text: "Institut Akwa", style: "nom", align: "center" });
  assert.equal(usableLogo(corrupt), null);
  assert.notEqual(usableLogo(png), null);
  const good = (await renderTicket(alone, { compress: false, logo: png })).toString("latin1");
  assert.match(good, /\/Subtype \/Image/);
});

test("fidélité : rangées en plus, toujours une seule page", async () => {
  const [, plain] = mediaBox(await renderTicket(doc));
  const withLoyalty = await renderTicket({ ...doc, loyalty: { earned: 25, reward: 0, taken: 0, restored: 0, balance: 125 } });
  const [, taller] = mediaBox(withLoyalty);
  assert.ok(taller > plain, `${taller} avec la fidélité, ${plain} sans`);
  assert.equal(latin(withLoyalty).match(/\/Type \/Page\b/g)?.length, 1);
});