import assert from "node:assert/strict";
import { test } from "node:test";
import { can, restrictFields } from "./permissions.ts";
import { setupApp } from "../test-support.ts";
import { doualaDay } from "../../shared/caisse.ts";

type Row = [method: string, path: string, admin: boolean, manager: boolean, reception: boolean, practitioner: boolean];
const MATRIX: Row[] = [
  ["GET", "/api/stats", false, true, true, true],
  ["GET", "/api/calendar", false, true, true, true],
  ["GET", "/api/appointments/3", false, true, true, true],
  ["POST", "/api/appointments", false, true, true, false],
  ["PUT", "/api/services/1/supplements", false, true, false, false],
  ["POST", "/api/services/1/supplements/copie", false, true, false, false],
  ["PUT", "/api/appointments/3/supplements", false, true, true, false],
  ["PUT", "/api/appointments/3", false, true, true, false],
  ["DELETE", "/api/appointments/3", false, true, true, false],
  ["POST", "/api/appointments/3/notes", false, true, true, true],
  ["DELETE", "/api/notes/4", false, true, true, false],
  ["POST", "/api/blocked-slots", false, true, true, false],
  ["GET", "/api/clients", false, true, true, true],
  ["PUT", "/api/clients/2", false, true, true, true],
  ["POST", "/api/clients", false, true, true, false],
  ["DELETE", "/api/clients/2", false, true, true, false],
  ["GET", "/api/staff", false, true, true, true],
  ["GET", "/api/horaires", false, true, true, true],
  ["POST", "/api/staff", false, true, false, false],
  ["PUT", "/api/services/1", false, true, false, false],
  ["PUT", "/api/products/1", false, true, true, false],
  ["POST", "/api/products", false, true, false, false],
  ["GET", "/api/accounts", true, true, false, false],
  ["POST", "/api/devices", true, true, false, false],
  ["GET", "/api/settings", true, true, false, false],
  ["GET", "/api/import/clientes/modele", true, true, false, false],
  ["POST", "/api/import/clientes/apercu", true, true, false, false],
  ["POST", "/api/import/rendez-vous", true, true, false, false],
  ["GET", "/api/outbox", true, true, true, false],
  ["GET", "/api/backups/status", true, true, false, false],
  ["POST", "/api/backups/run", true, false, false, false],
  ["GET", "/api/audit", true, true, false, false],
  ["GET", "/api/events", true, true, true, true],
  ["GET", "/api/auth/me", true, true, true, true],
  ["GET", "/api/campaigns", false, true, false, false],
  ["GET", "/api/campaigns/preview", false, true, false, false],
  ["POST", "/api/campaigns", false, true, false, false],
  ["GET", "/api/relances/seuil", false, true, true, true],
  ["PUT", "/api/relances/seuil", false, false, false, false],
  ["GET", "/api/relances", false, false, false, false],
  ["GET", "/api/transfers/proposal", false, true, true, false],
  ["POST", "/api/transfers", false, true, true, false],
  ["GET", "/api/inconnue", false, false, false, false],
  ["GET", "/api/demandes-en-ligne", false, true, true, false],
  ["GET", "/api/demandes-en-ligne/compte", false, true, true, false],
  ["GET", "/api/demandes-en-ligne/agenda", false, true, true, true],
  ["POST", "/api/demandes-en-ligne/4/confirmer", false, true, true, false],
  ["GET", "/api/en-ligne/etat", true, true, false, false],
  ["POST", "/api/en-ligne/tester", true, true, false, false],
  ["GET", "/api/en-ligne/qr", false, true, false, false],
];

test("la table des droits suit la spec § 3.4", () => {
  const roles = ["admin", "manager", "reception", "practitioner"] as const;
  for (const [method, path, ...expected] of MATRIX) {
    roles.forEach((role, i) => assert.equal(can(role, method, path), expected[i], `${role} ${method} ${path}`));
  }
});

test("restrictFields : praticienne sur les notes, réceptionniste sur le stock", () => {
  assert.deepEqual(restrictFields("practitioner", "clients", { name: "X", notes: "allergie" }), { notes: "allergie" });
  // Mini CRM (décision 4) : la praticienne écrit aussi les préférences, jamais les étiquettes ni l'anniversaire.
  assert.deepEqual(
    restrictFields("practitioner", "clients", { notes: "a", preferences: "Thé", tags: ["VIP"], birthday: "01-01", card: "AB12" }),
    { notes: "a", preferences: "Thé" },
  );
  assert.deepEqual(restrictFields("reception", "products", { price: 1, stock: 12 }), { stock: 12 });
  assert.deepEqual(restrictFields("manager", "products", { price: 1, stock: 12 }), { price: 1, stock: 12 });
});

test("le chiffre d'affaires dépend du rôle", async (t) => {
  const ctx = await setupApp(t);
  const manager = await ctx.as("manager");
  const today = doualaDay(ctx.clock.now);
  ctx.db.exec(`INSERT INTO appointments (identifier, client_id, staff_id, status, scheduled_date, start_time, end_time, total_price)
    VALUES ('A-1', 1, 1, 'completed', '${today}', '09:00', '10:00', 15000), ('A-2', 1, 1, 'completed', '2020-01-01', '09:00', '10:00', 5000)`);
  assert.equal((await manager("GET", "/api/stats")).body.revenue, 20000);
  assert.equal((await (await ctx.as("reception"))("GET", "/api/stats")).body.revenue, 15000);
  assert.equal("revenue" in (await (await ctx.as("practitioner"))("GET", "/api/stats")).body, false);
});

test("une praticienne ne modifie que les notes d'une fiche", async (t) => {
  const ctx = await setupApp(t);
  const praticienne = await ctx.as("practitioner");
  assert.equal((await praticienne("PUT", "/api/clients/1", { name: "Renommée", notes: "Peau sensible" })).status, 200);
  const row = ctx.db.prepare("SELECT name, notes FROM clients WHERE id = 1").get() as { name: string; notes: string };
  assert.notEqual(row.name, "Renommée");
  assert.equal(row.notes, "Peau sensible");
});
