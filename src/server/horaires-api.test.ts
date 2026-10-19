import assert from "node:assert/strict";
import { test } from "node:test";
import { SEMAINE_DEFAUT } from "../shared/horaires.ts";
import { setupApp } from "./test-support.ts";

test("horaires de l'institut : défaut, écriture par la gérante, lecture par la praticienne et la réception", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const p = await ctx.as("practitioner");
  const r = await ctx.as("reception");
  assert.deepEqual((await p("GET", "/api/horaires")).body, { institut: SEMAINE_DEFAUT });
  const coupure = { ...SEMAINE_DEFAUT, lun: [["09:00", "12:00"], ["13:00", "18:00"]] };
  assert.equal((await g("PUT", "/api/settings/institut.horaires", { value: coupure })).status, 200);
  assert.deepEqual((await r("GET", "/api/horaires")).body, { institut: coupure });
  assert.equal((await r("PUT", "/api/settings/institut.horaires", { value: SEMAINE_DEFAUT })).status, 403);
});

test("horaires de l'institut malformés : refus 400, message localisé, rien d'écrit", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  for (const value of [null, { ...SEMAINE_DEFAUT, lun: [["09:00", "13:00"], ["12:00", "18:00"]] }, { ...SEMAINE_DEFAUT, mar: [["06:00", "12:00"]] }]) {
    const res = await g("PUT", "/api/settings/institut.horaires", { value }, { "Accept-Language": "fr" });
    assert.equal(res.status, 400);
    assert.match(res.body.error as string, /horaires/i);
  }
  assert.deepEqual((await g("GET", "/api/horaires")).body, { institut: SEMAINE_DEFAUT });
});

test("équipe : prestations pratiquées par défaut, remplacées, identifiants inconnus ignorés", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const visage = (await g("POST", "/api/services", { name: "Visage", duration: 60, price: 25000 })).body.service.id as number;
  const ongles = (await g("POST", "/api/services", { name: "Ongles", duration: 30, price: 10000 })).body.service.id as number;
  const awa = (await g("POST", "/api/staff", { name: "Awa" })).body.staff;
  assert.deepEqual(awa.service_ids, [visage, ongles]);
  assert.equal(awa.horaires, null);
  assert.equal(awa.en_ligne, 0);
  assert.equal((await g("PUT", `/api/staff/${awa.id}`, { service_ids: [ongles, 9999] })).status, 200);
  const liste = (await g("GET", "/api/staff")).body.staff as { id: number; service_ids: number[] }[];
  assert.deepEqual(liste.find((s) => s.id === awa.id)?.service_ids, [ongles]);
  const coiffure = (await g("POST", "/api/services", { name: "Coiffure", duration: 45, price: 15000 })).body.service.id as number;
  const all = (await g("GET", "/api/staff/all")).body.staff as { id: number; service_ids: number[] }[];
  assert.deepEqual(all.find((s) => s.id === awa.id)?.service_ids, [ongles, coiffure], "nouvelle prestation pratiquée par défaut");
});

test("équipe : semaine type enregistrée, relue, remise à « comme l'institut » ; malformée refusée", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const awa = (await g("POST", "/api/staff", { name: "Awa" })).body.staff.id as number;
  const propre = { ...SEMAINE_DEFAUT, lun: [] };
  assert.equal((await g("PUT", `/api/staff/${awa}`, { horaires: propre })).status, 200);
  const lue = ((await g("GET", "/api/staff/all")).body.staff as { id: number; horaires: unknown }[]).find((s) => s.id === awa);
  assert.deepEqual(lue?.horaires, propre);
  const refus = await g("PUT", `/api/staff/${awa}`, { horaires: { ...SEMAINE_DEFAUT, mar: [["09:03", "12:00"]] } }, { "Accept-Language": "en" });
  assert.equal(refus.status, 400);
  assert.match(refus.body.error as string, /hours/i);
  assert.equal((await g("PUT", `/api/staff/${awa}`, { horaires: null })).status, 200);
  assert.equal(((await g("GET", "/api/staff")).body.staff as { id: number; horaires: unknown }[]).find((s) => s.id === awa)?.horaires, null);
});

test("réservable en ligne : décoché par défaut sur la praticienne et la prestation, puis coché", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const service = (await g("POST", "/api/services", { name: "Visage", duration: 60, price: 25000 })).body.service;
  assert.equal(service.en_ligne, 0);
  assert.equal((await g("PUT", `/api/services/${service.id}`, { en_ligne: 1 })).status, 200);
  const services = (await g("GET", "/api/services")).body.services as { id: number; en_ligne: number }[];
  assert.equal(services.find((s) => s.id === service.id)?.en_ligne, 1);
  const awa = (await g("POST", "/api/staff", { name: "Awa", en_ligne: 1 })).body.staff;
  assert.equal(awa.en_ligne, 1);
});
