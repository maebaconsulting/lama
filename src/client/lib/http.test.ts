import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, parseResponse, requestInit, signalFor, uploadInit } from "./http.ts";
import { emitSessionSignal, onSessionSignal } from "./session-bus.ts";

test("X-Lama accompagne toute modification, jamais une lecture", () => {
  assert.equal((requestInit("GET").headers as Record<string, string>)["X-Lama"], undefined);
  assert.equal((requestInit("HEAD").headers as Record<string, string>)["X-Lama"], undefined);
  for (const method of ["POST", "PUT", "DELETE", "post"]) {
    assert.equal((requestInit(method).headers as Record<string, string>)["X-Lama"], "1", method);
  }
});

test("corps JSON, cookies du même site", () => {
  const init = requestInit("PUT", { value: 5 });
  assert.equal(init.method, "PUT");
  assert.equal(init.credentials, "same-origin");
  assert.equal((init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.equal(init.body, '{"value":5}');
  assert.equal(requestInit("GET").body, undefined);
});

test("réponse réussie : JSON, ou null si vide", () => {
  assert.deepEqual(parseResponse(200, '{"ok":true}'), { ok: true });
  assert.equal(parseResponse(204, ""), null);
  assert.throws(() => parseResponse(200, "<html>"), (e: unknown) => e instanceof ApiError && e.message === "Réponse illisible du serveur.");
});

test("refus : message et code du serveur, ou message générique en français", () => {
  assert.throws(() => parseResponse(401, '{"error":"Connexion requise.","code":"connexion"}'), (e: unknown) =>
    e instanceof ApiError && e.status === 401 && e.code === "connexion" && e.message === "Connexion requise.");
  assert.throws(() => parseResponse(502, "Bad Gateway"), (e: unknown) =>
    e instanceof ApiError && e.code === null && e.message === "Erreur du serveur (502).");
});

test("signaux de session : seulement les refus qui changent d'écran", () => {
  const e = (status: number, code: string | null) => new ApiError("x", status, code, null);
  assert.equal(signalFor(e(409, "installation")), "installation");
  assert.equal(signalFor(e(401, "connexion")), "connexion");
  assert.equal(signalFor(e(401, "verrouille")), "verrouille");
  assert.equal(signalFor(e(503, "maintenance")), "maintenance");
  assert.equal(signalFor(e(401, null)), null, "mauvais mot de passe : l'écran reste");
  assert.equal(signalFor(e(401, "poste_inconnu")), null);
  assert.equal(signalFor(e(403, "confirmation")), null);
  assert.equal(signalFor(e(409, null)), null, "conflit d'agenda : l'écran reste");
});

test("le bus prévient les abonnés et se désabonne", () => {
  const seen: string[] = [];
  const off = onSessionSignal((s) => seen.push(s));
  emitSessionSignal("connexion");
  off();
  emitSessionSignal("maintenance");
  assert.deepEqual(seen, ["connexion"]);
});

test("Accept-Language suit la langue de l'écran, messages génériques traduits", () => {
  assert.equal((requestInit("GET", undefined, "en").headers as Record<string, string>)["Accept-Language"], "en");
  assert.equal((requestInit("POST", { a: 1 }, "fr").headers as Record<string, string>)["Accept-Language"], "fr");
  assert.throws(() => parseResponse(200, "<html>", "en"), (e: unknown) => e instanceof ApiError && e.message === "Unreadable reply from the server.");
  assert.throws(() => parseResponse(502, "Bad Gateway", "en"), (e: unknown) => e instanceof ApiError && e.message === "Server error (502).");
});

test("dépôt d'un fichier : corps binaire, X-Lama, langue, cookies du même site", () => {
  const file = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  const init = uploadInit("put", file, "en");
  const headers = init.headers as Record<string, string>;
  assert.equal(init.method, "PUT");
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.body, file);
  assert.equal(headers["X-Lama"], "1");
  assert.equal(headers["Content-Type"], "application/octet-stream");
  assert.equal(headers["Accept-Language"], "en");
});

test("refus de validation (V1-10) : la phrase du serveur est affichée telle quelle, jamais « Erreur du serveur (400) »", () => {
  assert.throws(
    () => parseResponse(400, JSON.stringify({ error: "Saisie invalide\u00a0: price." }), "fr"),
    (err: unknown) => err instanceof ApiError && err.message === "Saisie invalide\u00a0: price." && err.status === 400,
  );
});

test("version de l'écran (PWA, P-05) : X-Lama-Ecran sur toute requête, lecture, modification ou dépôt de fichier", () => {
  for (const method of ["GET", "POST", "DELETE"]) assert.equal((requestInit(method).headers as Record<string, string>)["X-Lama-Ecran"], "1", method);
  assert.equal((uploadInit("PUT", new Blob([])).headers as Record<string, string>)["X-Lama-Ecran"], "1");
});
