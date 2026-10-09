import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./http.ts";
import { reloadOpenRecord } from "./open-record.ts";

function setup(currentId: () => number | undefined) {
  const applied: string[] = [];
  let closed = 0;
  return {
    applied,
    closed: () => closed,
    run: (id: number, load: () => Promise<string>) =>
      reloadOpenRecord({ id, load, currentId, apply: (r) => applied.push(r), close: () => { closed++; } }),
  };
}

test("fiche ouverte : la réponse est appliquée si la même fiche est toujours ouverte", async () => {
  const s = setup(() => 7);
  await s.run(7, async () => "fiche 7");
  assert.deepEqual(s.applied, ["fiche 7"]);
  assert.equal(s.closed(), 0);
});

test("fiche ouverte : une réponse tardive n'écrase pas une autre fiche ouverte entre-temps (M4)", async () => {
  let ouverte = 7;
  const s = setup(() => ouverte);
  let repondre!: (v: string) => void;
  const enCours = s.run(7, () => new Promise<string>((r) => { repondre = r; }));
  ouverte = 8;
  repondre("fiche 7");
  await enCours;
  assert.deepEqual(s.applied, []);
  assert.equal(s.closed(), 0);
});

test("fiche ouverte : fermée seulement si le serveur dit qu'elle n'existe plus (404) ou n'est plus permise (403)", async () => {
  for (const status of [404, 403]) {
    const s = setup(() => 7);
    await s.run(7, async () => { throw new ApiError("refus", status, null, null); });
    assert.equal(s.closed(), 1, String(status));
  }
});

test("fiche ouverte : gardée sur une erreur passagère (réseau, 500, 503) (M4)", async () => {
  for (const erreur of [new TypeError("Failed to fetch"), new ApiError("erreur", 500, null, null), new ApiError("maintenance", 503, null, null)]) {
    const s = setup(() => 7);
    await s.run(7, async () => { throw erreur; });
    assert.equal(s.closed(), 0, erreur.message);
    assert.deepEqual(s.applied, []);
  }
});

test("fiche ouverte : un 404 tardif ne ferme pas une autre fiche ouverte entre-temps", async () => {
  let ouverte = 7;
  const s = setup(() => ouverte);
  let refuser!: (e: unknown) => void;
  const enCours = s.run(7, () => new Promise<string>((_, r) => { refuser = r; }));
  ouverte = 8;
  refuser(new ApiError("introuvable", 404, null, null));
  await enCours;
  assert.equal(s.closed(), 0);
});

test("rechargement temps réel : les trois fiches ouvertes (rendez-vous, cliente, produit) passent par reloadOpenRecord", async () => {
  const { readFileSync } = await import("node:fs");
  const hook = readFileSync(new URL("../hooks/use-app.ts", import.meta.url), "utf8");
  assert.equal(hook.match(/reloadOpenRecord\(\{/g)?.length, 3);
  assert.match(hook, /currentId: \(\) => latest\.current\.selectedAppointment\?\.id/);
  assert.match(hook, /currentId: \(\) => latest\.current\.selectedClient\?\.id/);
  // Vague 4 : le stock d'un produit ouvert suit les ventes faites sur un autre poste.
  assert.match(hook, /currentId: \(\) => latest\.current\.selectedProduct\?\.id/);
});
