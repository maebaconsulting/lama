import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "./test-support.ts";

/** V1-04 (décision 3) : prix d'achat et coordonnées des collègues retirés à la praticienne. */
async function setup(t: { after: (fn: () => void) => void }) {
  const ctx = await setupApp(t);
  const practitioner = await ctx.as("practitioner");
  const own = (ctx.db.prepare("SELECT staff_id FROM accounts WHERE login = 'practitioner'").get() as { staff_id: number }).staff_id;
  ctx.db.prepare("UPDATE staff SET email = 'moi@institut.cm', phone = '+237 677 00 00 09' WHERE id = ?").run(own);
  // Une collègue avec ses coordonnées (la fiche de la praticienne d'essai existe avant la démonstration, qui ne sème alors pas d'équipe).
  ctx.db.prepare("INSERT INTO staff (name, email, phone, title, color) VALUES ('Collègue essai', 'collegue@institut.cm', '+237 677 00 00 08', '', '#4A5D73')").run();
  const product = Number(ctx.db.prepare("INSERT INTO products (name, price, cost, stock) VALUES ('Huile essai', 4000, 2500, 12)").run().lastInsertRowid);
  return { ...ctx, practitioner, own, product };
}

test("praticienne : ni prix d'achat dans la liste et le détail des produits, prix de vente gardé", async (t) => {
  const { practitioner, product } = await setup(t);
  const list = await practitioner("GET", "/api/products?limit=1000");
  assert.equal(list.status, 200);
  const row = list.body.products.find((p: { id: number }) => p.id === product);
  assert.equal(row.price, 4000);
  assert.ok(list.body.products.every((p: object) => !("cost" in p)));
  const detail = await practitioner("GET", `/api/products/${product}`);
  assert.equal(detail.body.product.price, 4000);
  assert.ok(!("cost" in detail.body.product));
});

test("praticienne : courriel et téléphone absents pour ses collègues, présents sur sa propre fiche", async (t) => {
  const { practitioner, own } = await setup(t);
  const staff = (await practitioner("GET", "/api/staff")).body.staff as Record<string, unknown>[];
  const mine = staff.find((s) => s.id === own)!;
  assert.equal(mine.email, "moi@institut.cm");
  assert.equal(mine.phone, "+237 677 00 00 09");
  const others = staff.filter((s) => s.id !== own);
  assert.ok(others.length > 0);
  for (const s of others) {
    assert.ok(!("email" in s) && !("phone" in s), String(s.name));
    assert.ok(typeof s.name === "string" && typeof s.color === "string");
  }
});

test("réception et gérante : réponses inchangées (prix d'achat, coordonnées de toute l'équipe)", async (t) => {
  const ctx = await setup(t);
  for (const role of ["reception", "manager"] as const) {
    const call = await ctx.as(role);
    const detail = await call("GET", `/api/products/${ctx.product}`);
    assert.equal(detail.body.product.cost, 2500, role);
    const staff = (await call("GET", "/api/staff")).body.staff as Record<string, unknown>[];
    assert.ok(staff.every((s) => typeof s.email === "string" && typeof s.phone === "string"), role);
  }
});
