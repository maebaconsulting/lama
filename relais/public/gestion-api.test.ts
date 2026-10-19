import assert from "node:assert/strict";
import { test } from "node:test";
import { creerApiGestion, ErreurGestion } from "./gestion-api.ts";

function faux(reponses: Response[]) {
  const appels: { url: string; init?: RequestInit }[] = [];
  const f = async (url: string, init?: RequestInit) => {
    appels.push({ url, init });
    return reponses.shift() ?? new Response(null, { status: 204 });
  };
  return { api: creerApiGestion(f), appels };
}
const json = (statut: number, corps: unknown) => new Response(JSON.stringify(corps), { status: statut, headers: { "content-type": "application/json" } });

test("chaque appel porte l'en-tête de l'interface et vise /gestion/api", async () => {
  const { api, appels } = faux([new Response(null, { status: 204 }), json(200, { salons: [] }), json(201, { salon: { id: "eclat" }, cle: "c" })]);
  await api.connexion("secret");
  assert.deepEqual(await api.salons(), []);
  assert.equal((await api.creer("eclat", "Institut Éclat")).cle, "c");
  assert.deepEqual(appels.map((a) => [a.init?.method, a.url]), [["POST", "/gestion/api/connexion"], ["GET", "/gestion/api/salons"], ["POST", "/gestion/api/salons"]]);
  for (const a of appels) assert.equal(new Headers(a.init?.headers).get("x-relais-gestion"), "1");
  assert.equal(appels[0].init?.credentials, "same-origin");
});

test("suppression : identifiant recopié envoyé ; refus rendu en ErreurGestion", async () => {
  const { api, appels } = faux([new Response(null, { status: 204 }), json(401, { erreur: { code: "session", message: "connexion requise" } })]);
  await api.supprimer("eclat", "eclat");
  assert.deepEqual([appels[0].init?.method, appels[0].url, JSON.parse(String(appels[0].init?.body))], ["DELETE", "/gestion/api/salons/eclat", { confirmation: "eclat" }]);
  await assert.rejects(api.salons(), (e) => e instanceof ErreurGestion && e.statut === 401 && e.code === "session");
});

test("réponse d'erreur non JSON : code « autre » ; détail du relais conservé ; heure du relais lue", async () => {
  const { api } = faux([
    new Response("<html>bad gateway</html>", { status: 502 }),
    json(422, { erreur: { code: "donnees_invalides", message: "origines.0\u00a0: origine attendue" } }),
    new Response(JSON.stringify({ salons: [] }), { status: 200, headers: { date: "Sat, 17 Oct 2026 12:00:00 GMT" } }),
  ]);
  await assert.rejects(api.salons(), (e) => e instanceof ErreurGestion && e.statut === 502 && e.code === "autre" && e.detail === "");
  await assert.rejects(api.creer("a", "b"), (e) => e instanceof ErreurGestion && e.code === "donnees_invalides" && /^origines/.test(e.detail));
  assert.equal(api.heureRelais(), null);
  await api.salons();
  assert.equal(api.heureRelais(), Date.UTC(2026, 9, 17, 12, 0, 0));
});
