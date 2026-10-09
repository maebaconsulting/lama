import assert from "node:assert/strict";
import { test } from "node:test";
import { refusEcranPerime, screenFor, type GateInput } from "./gate.ts";
import { ApiError } from "./http.ts";
import { readFileSync } from "node:fs";
import { fr } from "../i18n/fr.ts";
import { en } from "../i18n/en.ts";
import type { AuthState } from "./auth-types.ts";

const account = { id: 1, display_name: "Grace", login: "grace", role: "reception" as const, staff_id: null, active: 1, has_pin: true, locked_until: null };
const device = { id: 3, name: "Tablette réception" };
const state = (s: Partial<AuthState>): AuthState => ({ installed: true, account: null, device: null, session: null, marque: { ecran: "logo_nom", nom: "", logos: { clair: null, sombre: null } }, ...s });
const gate = (g: Partial<GateInput>): GateInput => ({ state: null, maintenance: false, unreachable: false, wantsPassword: false, ...g });

test("maintenance d'abord, quel que soit l'état", () => {
  assert.equal(screenFor(gate({ maintenance: true, state: state({ account }) })), "maintenance");
  assert.equal(screenFor(gate({ maintenance: true })), "maintenance");
});

test("sans état : chargement, ou serveur injoignable", () => {
  assert.equal(screenFor(gate({})), "chargement");
  assert.equal(screenFor(gate({ unreachable: true })), "injoignable");
});

test("installation tant qu'aucun compte n'existe", () => {
  assert.equal(screenFor(gate({ state: state({ installed: false }) })), "installation");
});

test("session ouverte : l'app, même sur un poste", () => {
  assert.equal(screenFor(gate({ state: state({ account, device }) })), "app");
});

test("poste partagé sans session : la liste de l'équipe, sauf si on demande le mot de passe", () => {
  assert.equal(screenFor(gate({ state: state({ device }) })), "poste");
  assert.equal(screenFor(gate({ state: state({ device }), wantsPassword: true })), "connexion");
});

test("appareil personnel sans session : connexion", () => {
  assert.equal(screenFor(gate({ state: state({}) })), "connexion");
});

test("un état déjà connu reste affiché si le serveur devient injoignable", () => {
  assert.equal(screenFor(gate({ state: state({ account }), unreachable: true })), "app");
});

test("écran périmé (409 ecran_perime) à la porte d'entrée : le message du serveur, pas « Serveur injoignable »", () => {
  const message = "Cet écran date d'une version précédente de lama\u00a0: rechargez la page.";
  assert.equal(refusEcranPerime(new ApiError(message, 409, "ecran_perime", null)), message);
  // Les autres échecs restent « injoignable » : réseau coupé, autre refus.
  assert.equal(refusEcranPerime(new ApiError("Réseau", 0, "reseau", null)), null);
  assert.equal(refusEcranPerime(new ApiError("Autre", 409, "conflit", null)), null);
  assert.equal(refusEcranPerime(new Error("boom")), null);
  assert.equal(refusEcranPerime(null), null);
  const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
  assert.match(lire("../hooks/use-auth.ts"), /setRefus\(refusEcranPerime\(error\)\);\s*setUnreachable\(true\);/);
  assert.match(lire("../components/auth/porte.tsx"), /<Injoignable onRetry=\{gate\.reload\} refus=\{gate\.refus\} \/>/);
  assert.match(lire("../components/auth/etats.tsx"), /sousTitre=\{refus \?\? t\("etat\.injoignable\.texte"\)\}/);
  for (const dico of [fr, en]) assert.ok(dico["etat.ecran_perime.titre"]);
});
