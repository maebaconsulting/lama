import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp, type Reply } from "../test-support.ts";
import { PNG_1PX } from "../institut/images-essai.ts";
import { DEFAULT_TEXTS } from "./textes.ts";

/** Produit recommandé par WhatsApp (images des produits, spec du 04/10/2026, § 1) : texte prérempli, mise en file, « À envoyer à la main ». */

const BIN = { "content-type": "application/octet-stream" };
const FR = { "Accept-Language": "fr" };
const pick = (r: Reply) => [r.status, r.body.error];

async function scene(t: Parameters<typeof setupApp>[0]) {
  const ctx = await setupApp(t, { demo: false });
  const gerante = await ctx.as("manager");
  await gerante("PUT", "/api/settings/institut.nom", { value: "Institut Ébène" });
  const product = (await gerante("POST", "/api/products", { name: "Sérum Karité", name_en: "Shea Serum", price: 12000 })).body.product.id as number;
  const client = (await gerante("POST", "/api/clients", { name: "Aïcha Mbarga", phone: "699123456" })).body.client.id as number;
  return { ctx, gerante, reception: await ctx.as("reception"), product, client };
}

const whatsappRows = (ctx: Awaited<ReturnType<typeof setupApp>>) =>
  ctx.db.prepare("SELECT dedupe_key, payload, created_by FROM outbox WHERE kind = 'whatsapp' ORDER BY id").all() as { dedupe_key: string; payload: string; created_by: number | null }[];

test("texte prérempli : texte de la gérante, prénom, nom du produit dans la langue de la cliente, prix au format des documents, version de la photo", async (t) => {
  const { gerante, reception, product, client } = await scene(t);
  const fr = await reception("GET", `/api/products/${product}/whatsapp?client_id=${client}`);
  assert.equal(fr.status, 200);
  assert.deepEqual(fr.body, { text: "Aïcha, voici Sérum Karité (12\u202f000\u00a0FCFA) que nous vous recommandons chez Institut Ébène.", image_version: null });
  await gerante("PUT", `/api/products/${product}/image`, PNG_1PX, BIN);
  await gerante("PUT", `/api/clients/${client}`, { language: "en" });
  const en = await reception("GET", `/api/products/${product}/whatsapp?client_id=${client}`);
  assert.deepEqual(en.body, { text: "Aïcha, here is Shea Serum (12\u202f000\u00a0FCFA), which we recommend at Institut Ébène.", image_version: 1 });
});

test("texte « Produit recommandé » : réglage de la gérante, variables contrôlées, rendu par /api/whatsapp/texts et utilisé pour le texte prérempli", async (t) => {
  const { gerante, reception, product, client } = await scene(t);
  const texts = (await gerante("GET", "/api/whatsapp/texts")).body.texts as { key: string; kind: string; value: string }[];
  assert.deepEqual(texts.filter((x) => x.kind === "produit").map((x) => [x.key, x.value]), [
    ["whatsapp.texte.produit.fr", DEFAULT_TEXTS.produit.fr],
    ["whatsapp.texte.produit.en", DEFAULT_TEXTS.produit.en],
  ]);
  const bad = await gerante("PUT", "/api/settings/whatsapp.texte.produit.fr", { value: "{produit} le {date}" }, FR);
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /^Variable inconnue\u00a0: \{date\}\./);
  assert.equal((await gerante("PUT", "/api/settings/whatsapp.texte.produit.fr", { value: "Bonjour {nom}, {produit} à {prix}." })).status, 200);
  const draft = await reception("GET", `/api/products/${product}/whatsapp?client_id=${client}`);
  assert.equal(draft.body.text, "Bonjour Aïcha Mbarga, Sérum Karité à 12\u202f000\u00a0FCFA.");
});

test("envoi d'un produit : mis en file avec l'identifiant du produit et le texte relu, jamais la photo ; un envoi par appui ; journal au nom du produit, sans le texte", async (t) => {
  const { ctx, gerante, reception, product, client } = await scene(t);
  await gerante("PUT", `/api/products/${product}/image`, PNG_1PX, BIN);
  ctx.db.exec("DELETE FROM outbox");
  assert.equal((await reception("POST", `/api/products/${product}/whatsapp`, { client_id: client, text: "  Aïcha, regardez ce sérum.  " })).status, 200);
  assert.equal((await gerante("POST", `/api/products/${product}/whatsapp`, { client_id: client, text: "Encore" })).status, 200);
  const rows = whatsappRows(ctx);
  assert.equal(rows.length, 2, "un envoi par appui");
  assert.match(rows[0].dedupe_key, new RegExp(`^wa:produit:${product}:`));
  assert.notEqual(rows[0].dedupe_key, rows[1].dedupe_key);
  assert.deepEqual(JSON.parse(rows[0].payload), {
    to: "237699123456", lang: "fr", text: "Aïcha, regardez ce sérum.", modele: "produit",
    valeurs: { prenom: "Aïcha", nom: "Aïcha Mbarga", produit: "Sérum Karité", prix: "12\u202f000\u00a0FCFA", institut: "Institut Ébène", telephone: "" },
    product: { id: product }, origin: { type: "produit", clientId: client },
  });
  assert.ok(rows.every((r) => r.created_by !== null));
  const audit = ctx.db.prepare("SELECT target FROM audit_log WHERE action = 'whatsapp.produit' ORDER BY id").all().map((r) => (r as { target: string }).target);
  assert.deepEqual(audit, ["Sérum Karité", "Sérum Karité"]);
});

test("envoi refusé : texte vide ou trop long, produit ou cliente inconnus, sans numéro, numéro impossible ; administrateur et praticienne exclus ; rien en file", async (t) => {
  const { ctx, gerante, product, client } = await scene(t);
  ctx.db.exec("DELETE FROM outbox");
  const post = (body: unknown, id = product) => gerante("POST", `/api/products/${id}/whatsapp`, body, FR);
  assert.deepEqual(pick(await post({ client_id: client, text: "   " })), [400, "Le texte du message est vide."]);
  assert.deepEqual(pick(await post({ client_id: client, text: "a".repeat(1001) })), [400, "Texte de 1000 caractères au plus attendu."]);
  assert.deepEqual(pick(await post({ client_id: client, text: "x" }, 999)), [404, "Produit introuvable."]);
  assert.deepEqual(pick(await post({ client_id: 999, text: "x" })), [404, "Cliente introuvable."]);
  assert.deepEqual(pick(await post({ client_id: String(client), text: "x" })), [404, "Cliente introuvable."]);
  await gerante("PUT", `/api/clients/${client}`, { phone: "12" });
  assert.deepEqual(pick(await post({ client_id: client, text: "x" })), [400, "Numéro de téléphone impossible à normaliser."]);
  await gerante("PUT", `/api/clients/${client}`, { phone: "" });
  assert.deepEqual(pick(await post({ client_id: client, text: "x" })), [400, "Cette cliente n'a pas de numéro de téléphone."]);
  assert.deepEqual(pick(await gerante("GET", `/api/products/${product}/whatsapp?client_id=${client}`, undefined, FR)), [400, "Cette cliente n'a pas de numéro de téléphone."], "même refus pour le texte prérempli");
  for (const role of ["admin", "practitioner"] as const) {
    const call = await ctx.as(role);
    assert.equal((await call("POST", `/api/products/${product}/whatsapp`, { client_id: client, text: "x" })).status, 403, role);
    assert.equal((await call("GET", `/api/products/${product}/whatsapp?client_id=${client}`)).status, 403, role);
  }
  assert.equal(whatsappRows(ctx).length, 0);
});

test("« À envoyer à la main » : produit avec photo (nom et version, à télécharger) ; produit supprimé : plus montré", async (t) => {
  const { ctx, gerante, reception, product, client } = await scene(t);
  await gerante("PUT", `/api/products/${product}/image`, PNG_1PX, BIN);
  const other = (await gerante("POST", "/api/products", { name: "Huile de coco", price: 5000 })).body.product.id as number;
  const failed = (key: string, id: number) => {
    const payload = JSON.stringify({ to: "237699123456", lang: "fr", text: `Texte ${key}`, product: { id }, origin: { type: "produit", clientId: client } });
    ctx.db.prepare("INSERT INTO outbox (kind, payload, dedupe_key, next_attempt_at, created_at) VALUES ('whatsapp', ?, ?, 0, ?)").run(payload, key, ctx.clock.now);
    ctx.db.exec(`UPDATE outbox SET status = 'failed', last_error = '@whatsapp.sans_fournisseur' WHERE dedupe_key = '${key}'`);
  };
  failed("a", product);
  failed("b", other);
  ctx.db.exec(`DELETE FROM products WHERE id = ${other}`);
  const items = (await reception("GET", "/api/whatsapp/manual")).body.items;
  assert.equal(items.length, 1);
  assert.deepEqual({ type: items[0].type, product: items[0].product, text: items[0].text }, { type: "produit", product: { id: product, name: "Sérum Karité", image_version: 1 }, text: "Texte a" });
});
