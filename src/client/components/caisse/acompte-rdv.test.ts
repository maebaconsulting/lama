import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { depositSource } from "../../lib/ticket-pdf.ts";

/**
 * Acomptes dans la fiche d'un rendez-vous (sous-projet 5 § 6.2), câblés sur
 * `lib/acompte.ts` (testé en exécution) : gérante et réception seulement,
 * « Encaisser un acompte », reçu imprimable, « Rembourser » ou « Garder ».
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const ecran = read("./acompte-rdv.tsx");
const fiche = read("../appointment-detail.tsx");

test("fiche d'un rendez-vous : section des acomptes pour la gérante et la réception seulement, avant le détail", () => {
  assert.match(fiche, /\{canSell\(account\.role\) && <AcompteRdv key=\{`acompte-\$\{apt\.id\}`\} apt=\{apt\} \/>\}\n\n {6}<dl /);
  assert.match(ecran, /if \(deposits\.length === 0 && !canTake\) return null;/, "rien quand il n'y a ni acompte ni geste possible");
  assert.match(ecran, /useLoad\(\(\) => api<\{ deposits: Deposit\[\] \}>\("GET", `\/api\/deposits\?appointment_id=\$\{apt\.id\}`\)\.then\(\(r\) => r\.deposits\), \["invoices", "appointments"\]\)/);
});

test("encaisser : identifiant tiré à l'ouverture, plafond des prestations prévues, envoi bloqué tant que le formulaire n'est pas juste, bouton de 64 px", () => {
  assert.match(ecran, /setDraft\(startDeposit\(methods, newRequestId\(\)\)\)/);
  assert.match(ecran, /const stop = draft \? depositBlocker\(draft, apt\.total_price\) : null;/);
  assert.match(ecran, /disabled=\{stop !== null \|\| sending\} onClick=\{\(\) => send\("\/api\/deposits", \{ \.\.\.depositBody\(apt\.id, draft\), \.\.\.\(settings\.data\?\.printer === true && print \? \{ print: true \} : \{\}\) \}\)\}/);
  assert.match(ecran, /className="h-auto min-h-16 w-full whitespace-normal text-base" disabled=\{stop !== null/);
});

test("reçu de chaque acompte : « Imprimer » et « Télécharger » ; rembourser ou garder par la gérante, la réception prévenue", () => {
  assert.match(ecran, /<BoutonsTicket source=\{depositSource\(d\)\} direct=\{\{ kind: "deposit", id: d\.id \}\} \/>/);
  assert.deepEqual(depositSource({ id: 3, number: "AC-2026-000003" }), { path: "/api/deposits/3/pdf", fileName: "AC-2026-000003.pdf" });
  assert.match(ecran, /\{canSettle\(account\.role, apt, d\) && !settle && \(/);
  assert.match(ecran, /send\(`\/api\/deposits\/\$\{d\.id\}\/settle`, settleBody\(d, settle\)\)/);
  assert.match(ecran, /\{awaitsManager\(account\.role, apt, d\) && <p className="text-sm text-encre-rouge">\{t\("acompte\.gerante_seule"\)\}<\/p>\}/);
});

// Mineur 5 (relecture finale) : rendez-vous annulé ou cliente absente, l'acompte en attente ne se
// « déduit » plus de rien ; libellé qui convient plutôt.
test("statut de l'acompte en attente : « déduit à l'encaissement » sauf rendez-vous annulé ou cliente absente", () => {
  assert.match(ecran, /function statusText\(t: \(key: Key, values\?: Record<string, string \| number>\) => string, d: Deposit, appointmentStatus: string\): string \{/);
  assert.match(ecran, /if \(d\.status === "held" && \(appointmentStatus === "cancelled" \|\| appointmentStatus === "no_show"\)\) return t\("acompte\.statut\.held_attente"\);/);
  assert.match(ecran, /\{statusText\(t, d, apt\.status\)\}/);
});

// Retouche P3 (critique.md) : au téléphone (390 px), le bas du formulaire sortait de l'écran sans
// indice de défilement. Le panneau défile toujours naturellement ; le bouton de validation reste
// collé en bas du formulaire (motif de paiement.tsx), pour qu'il soit toujours atteignable.
test("formulaire d'acompte au téléphone : bouton de validation collé en bas du formulaire, toujours visible", () => {
  assert.match(ecran, /<div className="sticky bottom-0 space-y-2 bg-background pb-1 pt-2">\s*\{settings\.data\?\.printer === true && <Case id="acompte-imprimer"[^\n]*\n\s*<Button className="h-auto min-h-16 w-full whitespace-normal text-base" disabled=\{stop !== null \|\| sending\} onClick=\{\(\) => send\("\/api\/deposits", \{ \.\.\.depositBody\(apt\.id, draft\), \.\.\.\(settings\.data\?\.printer === true && print \? \{ print: true \} : \{\}\) \}\)\}>/);
  assert.ok(ecran.indexOf('sticky bottom-0 space-y-2 bg-background') < ecran.lastIndexOf('{t("commun.annuler")}'), "le bouton collé précède « Annuler » du formulaire d'acompte (dernier de l'écran)");
});
