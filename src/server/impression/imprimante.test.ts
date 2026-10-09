import assert from "node:assert/strict";
import { test } from "node:test";
import { COVER_OPEN, NO_PAPER, startFakePrinter } from "./fausse-imprimante.ts";
import { exclusive, parseAddress, sendToPrinter } from "./imprimante.ts";

// La fausse imprimante écoute 127.0.0.1 : adresse refusée en service, permise aux essais seulement.
process.env.LAMA_IMPRESSION_ESSAI = "1";

test("adresse : IPv4 du réseau local seulement, port 9100 par défaut, jamais un nom ni la machine elle-même", () => {
  assert.deepEqual(parseAddress("192.168.1.100"), { host: "192.168.1.100", port: 9100 });
  assert.deepEqual(parseAddress(" 10.0.0.7:9101 "), { host: "10.0.0.7", port: 9101 });
  assert.deepEqual(parseAddress("172.20.3.4"), { host: "172.20.3.4", port: 9100 });
  for (const bad of ["", "192.168.1.100:0", "192.168.1.100:70000", "http://192.168.1.100", "imprimante.local", "localhost", "169.254.169.254", "8.8.8.8", "172.32.0.1", "192.168.1.256", "a b"]) {
    assert.equal(parseAddress(bad), null, bad);
  }
  delete process.env.LAMA_IMPRESSION_ESSAI;
  try {
    assert.equal(parseAddress("127.0.0.1"), null, "la machine elle-même, hors essais");
    assert.equal(parseAddress("127.0.0.1:3000"), null);
  } finally {
    process.env.LAMA_IMPRESSION_ESSAI = "1";
  }
  assert.deepEqual(parseAddress("127.0.0.1:9100"), { host: "127.0.0.1", port: 9100 }, "essais : fausse imprimante");
});
test("imprimante prête : le ticket arrive entier, sans les demandes d'état", async (t) => {
  const fake = await startFakePrinter();
  t.after(() => fake.close());
  assert.deepEqual(await sendToPrinter(fake.address, Buffer.from("ticket\n"), { checkStatus: true }), { ok: true });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(fake.jobs.map(String), ["ticket\n"]);
});

test("papier épuisé ou capot ouvert : rien n'est envoyé, la raison est rendue", async (t) => {
  const fake = await startFakePrinter();
  t.after(() => fake.close());
  fake.status = { ...NO_PAPER };
  assert.deepEqual(await sendToPrinter(fake.address, Buffer.from("x"), { checkStatus: true }), { ok: false, reason: "papier" });
  fake.status = { ...COVER_OPEN };
  assert.deepEqual(await sendToPrinter(fake.address, Buffer.from("x"), { checkStatus: true }), { ok: false, reason: "capot" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fake.bytes, 0, "aucun octet de ticket reçu");
});

test("imprimante muette à l'état : le ticket part quand même ; le tiroir part sans demande d'état", async (t) => {
  const fake = await startFakePrinter();
  t.after(() => fake.close());
  fake.status = null;
  assert.deepEqual(await sendToPrinter(fake.address, Buffer.from("a"), { checkStatus: true }), { ok: true });
  assert.deepEqual(await sendToPrinter(fake.address, Buffer.from("b"), { checkStatus: false }), { ok: true });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(fake.jobs.map(String), ["a", "b"]);
});

test("injoignable : connexion refusée tout de suite, imprimante bloquée au bout du délai", async (t) => {
  const fake = await startFakePrinter();
  t.after(() => fake.close());
  const port = fake.address.split(":")[1];
  await fake.close();
  assert.deepEqual(await sendToPrinter(`127.0.0.1:${port}`, Buffer.from("x"), { checkStatus: true }), { ok: false, reason: "injoignable" });
  const stuck = await startFakePrinter();
  t.after(() => stuck.close());
  stuck.hang = true;
  const start = Date.now();
  assert.deepEqual(await sendToPrinter(stuck.address, Buffer.from("x"), { checkStatus: false }), { ok: false, reason: "injoignable" });
  assert.ok(Date.now() - start >= 4900, "attend le délai de 5 s");
});

test("un envoi à la fois : deux tâches simultanées s'exécutent l'une après l'autre, même si la première échoue", async () => {
  const order: string[] = [];
  const first = exclusive(async () => { order.push("début 1"); await new Promise((r) => setTimeout(r, 30)); order.push("fin 1"); throw new Error("échec"); });
  const second = exclusive(async () => { order.push("début 2"); return 2; });
  await assert.rejects(first);
  assert.equal(await second, 2);
  assert.deepEqual(order, ["début 1", "fin 1", "début 2"]);
});

test("imprimante qui ferme la connexion dès l'acceptation : échec rapide, jamais d'attente sans fin, la file repart", async (t) => {
  const fake = await startFakePrinter();
  t.after(() => fake.close());
  fake.refuse = true;
  const start = Date.now();
  assert.deepEqual(await exclusive(() => sendToPrinter(fake.address, Buffer.from("x"), { checkStatus: true })), { ok: false, reason: "injoignable" });
  assert.ok(Date.now() - start < 1000, `réponse en ${Date.now() - start} ms`);
  fake.refuse = false;
  assert.deepEqual(await exclusive(() => sendToPrinter(fake.address, Buffer.from("y"), { checkStatus: true })), { ok: true }, "l'envoi suivant n'est pas bloqué");
});
