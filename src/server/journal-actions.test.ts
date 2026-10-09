import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "./test-support.ts";

/** V1-03 : suppressions, changements de prix et corrections de stock inscrits au journal (décision 2). */
async function setup(t: { after: (fn: () => void) => void }) {
  const ctx = await setupApp(t);
  const call = await ctx.as("manager");
  const manager = (ctx.db.prepare("SELECT id FROM accounts WHERE login = 'manager'").get() as { id: number }).id;
  const lines = () => ctx.db.prepare("SELECT account_id, action, target FROM audit_log WHERE action NOT LIKE 'connexion%' ORDER BY id")
    .all().map((r) => ({ ...r }) as { account_id: number; action: string; target: string });
  const insert = (sql: string, ...params: (string | number)[]) => Number(ctx.db.prepare(sql).run(...params).lastInsertRowid);
  return { ...ctx, call, manager, lines, insert };
}

test("chaque suppression écrit une ligne avec l'auteur et le nom de la fiche", async (t) => {
  const { call, manager, lines, insert } = await setup(t);
  const client = insert("INSERT INTO clients (name, phone) VALUES (?, ?)", "Aïcha Essai", "+237 677 00 00 01");
  const staff = insert("INSERT INTO staff (name, email, title, color) VALUES (?, '', '', '#4A5D73')", "Brenda Essai");
  const service = insert("INSERT INTO services (name, duration, price) VALUES (?, 60, 15000)", "Tresses essai");
  const product = insert("INSERT INTO products (name, price, stock) VALUES (?, 4000, 12)", "Huile essai");
  const slot = insert("INSERT INTO blocked_slots (staff_id, blocked_date, start_time, end_time, reason) VALUES (1, '2026-11-02', '12:00', '13:00', 'Pause')");
  const apt = await call("POST", "/api/appointments", { client_id: 1, staff_id: 1, scheduled_date: "2026-11-03", start_time: "10:00", service_ids: [1] });
  const aptId = apt.body.appointment.id;
  const identifier = apt.body.appointment.identifier;
  const note = insert("INSERT INTO appointment_notes (appointment_id, content) VALUES (?, ?)", aptId, "Allergie au henné, rappeler au 677 00 00 02");

  for (const path of [`/api/notes/${note}`, `/api/appointments/${aptId}`, `/api/clients/${client}`, `/api/staff/${staff}`, `/api/services/${service}`, `/api/blocked-slots/${slot}`, `/api/products/${product}`]) {
    assert.equal((await call("DELETE", path)).status, 200, path);
  }
  const staffOne = (await call("GET", "/api/staff")).body.staff.find((s: { id: number }) => s.id === 1).name;
  assert.deepEqual(lines(), [
    { account_id: manager, action: "rdv.note_suppression", target: identifier },
    { account_id: manager, action: "rdv.suppression", target: identifier },
    { account_id: manager, action: "cliente.suppression", target: "Aïcha Essai" },
    { account_id: manager, action: "membre.suppression", target: "Brenda Essai" },
    { account_id: manager, action: "prestation.suppression", target: "Tresses essai" },
    { account_id: manager, action: "creneau.suppression", target: `${staffOne}, 2026-11-02 12:00-13:00` },
    { account_id: manager, action: "produit.suppression", target: "Huile essai" },
  ]);
  assert.ok(lines().every((l) => !l.target.includes("henné") && !l.target.includes("677")), "ni texte de note ni téléphone");
});

test("une suppression d'une fiche déjà absente n'écrit rien", async (t) => {
  const { call, lines } = await setup(t);
  assert.equal((await call("DELETE", "/api/products/99999")).status, 200);
  assert.deepEqual(lines(), []);
});

test("changement de prix d'une prestation et d'un produit, correction de stock : ancienne et nouvelle valeur", async (t) => {
  const { call, lines, insert } = await setup(t);
  const service = insert("INSERT INTO services (name, duration, price) VALUES (?, 60, 15000)", "Tresses essai");
  const product = insert("INSERT INTO products (name, price, stock) VALUES (?, 4000, 12)", "Huile de coco essai");
  assert.equal((await call("PUT", `/api/services/${service}`, { price: 12000 })).status, 200);
  assert.equal((await call("PUT", `/api/products/${product}`, { price: 4500, stock: 8 })).status, 200);
  assert.deepEqual(lines().map((l) => [l.action, l.target]), [
    ["prestation.prix", "Tresses essai\u00a0: 15\u202f000 → 12\u202f000\u00a0F"],
    ["produit.prix", "Huile de coco essai\u00a0: 4\u202f000 → 4\u202f500\u00a0F"],
    ["produit.stock", "Huile de coco essai\u00a0: 12 → 8"],
  ]);
});

test("une modification sans changement de prix ni de stock n'écrit rien", async (t) => {
  const { call, lines, insert } = await setup(t);
  const service = insert("INSERT INTO services (name, duration, price) VALUES (?, 60, 15000)", "Tresses essai");
  const product = insert("INSERT INTO products (name, price, stock) VALUES (?, 4000, 12)", "Huile essai");
  assert.equal((await call("PUT", `/api/services/${service}`, { name: "Tresses longues", price: 15000 })).status, 200);
  assert.equal((await call("PUT", `/api/products/${product}`, { brand: "Maison", price: 4000, stock: 12 })).status, 200);
  assert.deepEqual(lines(), []);
});

test("un nom très long est raccourci pour que l'ancienne et la nouvelle valeur restent au journal", async (t) => {
  const { call, lines, insert } = await setup(t);
  const name = "Soin visage éclat + gommage + masque hydratant + massage + finition";
  assert.equal([...name].length >= 60, true);
  const service = insert("INSERT INTO services (name, duration, price) VALUES (?, 60, 15000)", name);
  assert.equal((await call("PUT", `/api/services/${service}`, { price: 12000 })).status, 200);
  const [line] = lines();
  assert.ok([...line.target].length <= 64);
  assert.ok(line.target.startsWith("Soin visage éclat"));
  assert.ok(line.target.includes("…"));
  assert.ok(line.target.endsWith("\u00a0: 15\u202f000 → 12\u202f000\u00a0F"), line.target);
});
