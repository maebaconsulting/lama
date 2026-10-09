import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./http.ts";
import { reloadOpenRecord } from "./open-record.ts";
import { createLatest, escapeDecision, focusAfterClose, hasUnsavedText, inertBehindPanel, panelView, shouldRestoreFocus, type PanelError } from "./panneau.ts";

/** Promesse que le test résout ou rejette quand il veut (réponse du serveur simulée). */
function pending<R>() {
  let resolve!: (v: R) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<R>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * Panneau simulé comme dans app.tsx et use-app.ts : l'identifiant ouvert
 * (adresse), la fiche chargée, l'erreur rattachée à l'élément demandé.
 */
function panel() {
  const latest = createLatest();
  const s = { openId: null as number | null, loadedId: null as number | null, error: null as PanelError | null };
  return {
    s,
    view: () => panelView(s.openId!, s.loadedId, s.error),
    open(id: number, load: () => Promise<number>) {
      s.openId = id;
      s.error = null;
      return latest.run(load, (loaded) => { s.loadedId = loaded; })
        .catch((err: Error) => { s.error = { id, message: err.message }; });
    },
    close() { s.openId = null; latest.cancel(); },
  };
}

test("panneau : la fiche une fois chargée, le chargement avant, l'erreur avec son message sinon", () => {
  assert.deepEqual(panelView(12, 12, null), { kind: "fiche" });
  assert.deepEqual(panelView(12, null, null), { kind: "chargement" });
  assert.deepEqual(panelView(12, 7, null), { kind: "chargement" }, "une autre fiche encore chargée n'est pas montrée");
  assert.deepEqual(panelView(12, null, { id: 12, message: "Rendez-vous introuvable" }), { kind: "erreur", message: "Rendez-vous introuvable" });
  assert.deepEqual(panelView(12, null, { id: 7, message: "Rendez-vous introuvable" }), { kind: "chargement" }, "l'erreur d'un autre élément ne s'affiche pas");
});

test("panneau : rendez-vous introuvable ou supprimé, l'erreur s'affiche, « Réessayer » recharge", async () => {
  const p = panel();
  await p.open(12, async () => { throw new ApiError("Rendez-vous introuvable", 404, null, null); });
  assert.deepEqual(p.view(), { kind: "erreur", message: "Rendez-vous introuvable" });
  // Réessayer : l'erreur disparaît pendant le chargement, puis la fiche s'affiche.
  const retry = pending<number>();
  const done = p.open(12, () => retry.promise);
  assert.deepEqual(p.view(), { kind: "chargement" });
  retry.resolve(12);
  await done;
  assert.deepEqual(p.view(), { kind: "fiche" });
});

test("panneau (D7) : la réponse tardive du premier rendez-vous ne s'affiche jamais sur le second", async () => {
  const p = panel();
  const first = pending<number>();
  const second = pending<number>();
  const a = p.open(1, () => first.promise);
  const b = p.open(2, () => second.promise);
  second.resolve(2);
  await b;
  assert.deepEqual(p.view(), { kind: "fiche" });
  first.resolve(1);
  await a;
  assert.equal(p.s.loadedId, 2, "la fiche 1 arrivée en retard n'écrase pas la fiche 2");
  assert.deepEqual(p.view(), { kind: "fiche" });
});

test("panneau (D7) : l'échec tardif du premier rendez-vous ne s'affiche pas sur le second", async () => {
  const p = panel();
  const first = pending<number>();
  const second = pending<number>();
  const a = p.open(1, () => first.promise);
  const b = p.open(2, () => second.promise);
  first.reject(new ApiError("Rendez-vous introuvable", 404, null, null));
  await a;
  assert.equal(p.s.error, null);
  assert.deepEqual(p.view(), { kind: "chargement" });
  second.resolve(2);
  await b;
  assert.deepEqual(p.view(), { kind: "fiche" });
});

test("panneau (D7) : la fiche 1 arrivée après l'échec de la 2 ne remplace pas l'erreur de la 2", async () => {
  const p = panel();
  const first = pending<number>();
  const a = p.open(1, () => first.promise);
  await p.open(2, async () => { throw new ApiError("Rendez-vous introuvable", 404, null, null); });
  first.resolve(1);
  await a;
  assert.equal(p.s.loadedId, null);
  assert.deepEqual(p.view(), { kind: "erreur", message: "Rendez-vous introuvable" });
});

test("panneau fermé avant la réponse : la réponse est ignorée", async () => {
  const p = panel();
  const first = pending<number>();
  const a = p.open(1, () => first.promise);
  p.close();
  first.resolve(1);
  await a;
  assert.equal(p.s.loadedId, null);
});

/** Rechargement en direct tel que use-app.ts le câble : 404 ou 403, la fiche se vide et le panneau se ferme. */
function live(status: number | null, openAgain?: number) {
  let selectedId: number | undefined = 12;
  let panelOpen = true;
  let applied = 0;
  const run = reloadOpenRecord({
    id: 12,
    load: async () => {
      if (openAgain !== undefined) selectedId = openAgain; // une autre fiche ouverte entre-temps
      if (status === null) return "fiche 12";
      throw new ApiError("refus", status, null, null);
    },
    currentId: () => selectedId,
    apply: () => { applied++; },
    close: () => { selectedId = undefined; panelOpen = false; },
  });
  return run.then(() => ({ selectedId, panelOpen, applied }));
}

test("panneau : le rendez-vous supprimé ailleurs (reçu en direct) ferme le panneau ; une coupure passagère le laisse", async () => {
  assert.deepEqual(await live(404), { selectedId: undefined, panelOpen: false, applied: 0 });
  assert.deepEqual(await live(403), { selectedId: undefined, panelOpen: false, applied: 0 });
  assert.deepEqual(await live(0), { selectedId: 12, panelOpen: true, applied: 0 }, "Wi-Fi coupé : la fiche reste");
  assert.deepEqual(await live(500), { selectedId: 12, panelOpen: true, applied: 0 });
  assert.deepEqual(await live(null), { selectedId: 12, panelOpen: true, applied: 1 });
  assert.deepEqual(await live(404, 13), { selectedId: 13, panelOpen: true, applied: 0 }, "une autre fiche ouverte entre-temps n'est pas fermée");
});

test("panneau fermé : le focus revient à l'élément qui l'a ouvert, sinon au conteneur de l'écran", () => {
  const body = { isConnected: true, name: "body" };
  const main = { isConnected: true, name: "main" };
  const row = { isConnected: true, name: "ligne APT-2" };
  assert.equal(focusAfterClose(row, body, main), row);
  assert.equal(focusAfterClose({ ...row, isConnected: false }, body, main), main, "ligne disparue (rendez-vous supprimé)");
  assert.equal(focusAfterClose(body, body, main), main, "lien direct : rien n'avait le focus");
  assert.equal(focusAfterClose(null, body, main), main);
});

test("fermeture : le focus n'est pas retiré d'un élément de l'écran (bouton du rail qui change d'écran)", () => {
  const body = { isConnected: true };
  const railButton = { isConnected: true };
  assert.equal(shouldRestoreFocus(railButton, body, false), false, "bouton du rail : le focus y reste");
  assert.equal(shouldRestoreFocus(railButton, body, true), true, "bouton « Fermer » du panneau : retour au déclencheur");
  assert.equal(shouldRestoreFocus(body, body, false), true, "focus perdu sur la page entière");
  assert.equal(shouldRestoreFocus(null, body, false), true);
  assert.equal(shouldRestoreFocus({ isConnected: false }, body, false), true, "élément disparu");
});

test("Échap : ferme le panneau où que soit le focus, sauf fenêtre ou menu par-dessus, ou note en cours", () => {
  const esc = { key: "Escape", defaultPrevented: false };
  assert.equal(escapeDecision(esc, false, false), "fermer");
  assert.equal(escapeDecision(esc, false, true), "garder", "note commencée : jamais perdue");
  assert.equal(escapeDecision(esc, true, false), "ignorer", "fenêtre de déplacement ouverte : elle seule se ferme");
  assert.equal(escapeDecision({ key: "Escape", defaultPrevented: true }, false, false), "ignorer", "déjà traitée (Radix, confirmation)");
  assert.equal(escapeDecision({ key: "Enter", defaultPrevented: false }, false, false), "ignorer");
});

test("brouillon : un champ qui contient autre chose que des espaces", () => {
  assert.equal(hasUnsavedText([]), false);
  assert.equal(hasUnsavedText(["", "  \n "]), false);
  assert.equal(hasUnsavedText(["", "Allergie au latex"]), true);
});

test("panneau plein écran sur téléphone : la page dessous devient inerte, pas à partir de 768 px", () => {
  assert.equal(inertBehindPanel(true, false), true);
  assert.equal(inertBehindPanel(true, true), false);
  assert.equal(inertBehindPanel(false, false), false);
});
