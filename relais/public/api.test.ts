import assert from "node:assert/strict";
import { test } from "node:test";
import { api, choisirSalon, creerApi, ErreurApi } from "./api.ts";

function faux(statut: number, corps: string) {
  const appels: { url: string; init?: RequestInit }[] = [];
  const f = async (url: string, init?: RequestInit) => {
    appels.push({ url, init });
    return new Response(corps, { status: statut, headers: { "content-type": "application/json" } });
  };
  return { api: creerApi("eclat", f), appels };
}

test("adresses des appels : sous /api/<salon>, paramètres vides omis, jeton encodé", async () => {
  const { api, appels } = faux(200, "{}");
  await api.jours("s60", null);
  await api.creneaux("s60", "2026-10-21", "p1");
  await api.suivi("a/b");
  assert.deepEqual(appels.map((a) => a.url), ["/api/eclat/jours?prestation=s60", "/api/eclat/creneaux?prestation=s60&date=2026-10-21&praticienne=p1", "/api/eclat/suivi"]);
  assert.deepEqual([appels[2].init?.method, appels[2].init?.body], ["POST", JSON.stringify({ jeton: "a/b" })], "le jeton est dans le corps, pas dans l'adresse");
});

test("envoi : POST JSON ; refus rendu en ErreurApi avec son code", async () => {
  const { api, appels } = faux(409, JSON.stringify({ erreur: { code: "indisponible", message: "demande refusée" } }));
  await assert.rejects(api.envoyer({
    type: "creneau", prestation: "s60", praticienne: null, date: "2026-10-21", heure: "09:00", souhait: null,
    cliente: { nom: "Mireille Ngo", telephone: "+237699123456", langue: "fr" }, note: "", accord: true, piege: "",
  }), (e) => e instanceof ErreurApi && e.statut === 409 && e.code === "indisponible");
  assert.equal(appels[0].init?.method, "POST");
  assert.equal(JSON.parse(String(appels[0].init?.body)).accord, true);
});

test("réponse illisible : code « autre »", async () => {
  const { api } = faux(502, "<html>passerelle</html>");
  await assert.rejects(api.vitrine(), (e) => e instanceof ErreurApi && e.statut === 502 && e.code === "autre");
});

test("corps trop gros du serveur : code « corps_trop_gros » conservé", async () => {
  const { api } = faux(413, JSON.stringify({ erreur: { code: "corps_trop_gros", message: "16 Ko au plus" } }));
  await assert.rejects(api.vitrine(), (e) => e instanceof ErreurApi && e.statut === 413 && e.code === "corps_trop_gros");
});

test("réponse 2xx qui n'est pas du JSON : code « autre »", async () => {
  const { api } = faux(200, "<html>passerelle</html>");
  await assert.rejects(api.vitrine(), (e) => e instanceof ErreurApi && e.statut === 200 && e.code === "autre");
});

test("choisirSalon : la liaison vivante demande /api/<salon>/…", async () => {
  const avant = api;
  const urls: string[] = [];
  const reel = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    choisirSalon("eclat");
    await api.vitrine();
    assert.deepEqual(urls, ["/api/eclat/vitrine"]);
  } finally {
    globalThis.fetch = reel;
    choisirSalon("");
    assert.notEqual(api, avant); // liaison recréée, sans salon comme au départ
  }
});
