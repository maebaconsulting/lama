import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Entrées de la caisse (sous-projet 5 § 4.1, § 3.4) : « Encaisser » dans la
 * fiche d'un rendez-vous, « Vente » dans « Aujourd'hui » et l'agenda, groupe
 * « À encaisser » ; « Payé » vu de tous, suppression masquée une fois payé.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const aujourdhui = read("../accueil/aujourdhui.tsx");
const agenda = read("../calendar-view.tsx");
const fiche = read("../appointment-detail.tsx");
const badges = read("../status-badge.tsx");
const boutons = read("./boutons-ticket.tsx");

test("« Aujourd'hui » : bouton « Vente » (téléphone compris) et groupe « À encaisser » juste après « À traiter »", () => {
  assert.match(aujourdhui, /\{canSell\(account\.role\) && \(\s*<Button variant="outline" onClick=\{\(\) => navigate\(pathFor\("vente", lang\)\)\}>/);
  assert.match(aujourdhui, /\{ key: "aTraiter", labelKey: "accueil\.groupe_a_traiter" \},\s*\{ key: "aEncaisser", labelKey: "accueil\.groupe_a_encaisser" \},/);
  assert.match(aujourdhui, /onCash=\{key === "aEncaisser" && canSell\(account\.role\) \? \(\) => navigate\(pathFor\("vente", lang, apt\.id\)\) : null\}/);
  assert.match(aujourdhui, /\{onCash \? \(\s*<Button className="w-full @2xl:w-32 @2xl:shrink-0" onClick=\{onCash\}>\{t\("caisse\.encaisser"\)\}<\/Button>/);
});

test("agenda : bouton « Vente » pour qui vend", () => {
  assert.match(agenda, /\{canSell\(account\.role\) && \(\s*<Button variant="outline" size="sm" className=\{cn\("w-full md:w-auto", commands\.block && "col-span-2"\)\} onClick=\{\(\) => navigate\(pathFor\("vente", lang\)\)\}>/, "au téléphone, sur toute la largeur : jamais d'orphelin");
});

test("fiche du rendez-vous : « Encaisser » pour un soin en cours ou terminé et pas encore payé ; « Payé » et numéro de facture ; plus de suppression", () => {
  assert.match(fiche, /const cashable = canChargeAppointment\(account, apt, checkout\.data === true\) && !apt\.paid && \(apt\.status === "in_progress" \|\| apt\.status === "completed"\);/);
  assert.match(fiche, /\{cashable && \(\s*<Button size="lg" variant=\{commands\.changeStatus && step \? "outline" : "default"\} className="w-full" onClick=\{\(\) => navigate\(pathFor\("vente", lang, apt\.id\)\)\}>/);
  assert.match(fiche, /\{Boolean\(apt\.paid\) && <PayeBadge \/>\}/);
  assert.match(fiche, /\{apt\.invoice_number && \(\s*<Ligne libelle=\{t\("caisse\.facture"\)\}>/);
  // Correctif final (point 1) : une facture émise (même entièrement reprise par un avoir) masque « Supprimer », pas seulement « payé ».
  assert.match(fiche, /\{commands\.remove && !apt\.invoiced && \(/);
  assert.match(badges, /export function PayeBadge\(\)/);
});

test("retouche R2 : fiche payée, le total facturé d'abord, boutons du ticket pleine largeur", () => {
  assert.match(fiche, /apt\.invoice_number && apt\.invoice_total != null/, "distingue la fiche payée avec facture du cas de repli");
  assert.match(fiche, /<Ligne libelle=\{t\("rdv\.total_facture"\)\}>/);
  assert.match(fiche, /t\("rdv\.prestations_prevues", \{ montant: formatPrice\(apt\.total_price, lang\) \}\)/);
  assert.doesNotMatch(fiche, /max-w-xs/, "retouche 3 : plus de largeur plafonnée sur les boutons du ticket");
});

test("retouche R4 : « Préparation du ticket… » pendant la fabrication du PDF", () => {
  assert.match(boutons, /t\("caisse\.preparation_ticket"\)/);
  assert.match(boutons, /aria-busy=\{busy === "imprimer" \? "true" : undefined\}/);
  assert.match(boutons, /aria-busy=\{busy === "telecharger" \? "true" : undefined\}/);
  assert.match(boutons, /min-h-12/, "48 px de haut au moins");
  assert.match(boutons, /whitespace-normal/, "le libellé plus long passe sur deux lignes plutôt que d'être coupé");
});
