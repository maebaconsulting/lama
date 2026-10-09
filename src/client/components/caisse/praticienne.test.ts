import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { auditTarget } from "../../lib/libelles.ts";
import { caisseValue, caisseValues, CAISSE_KEYS } from "../../lib/reglages-caisse.ts";
import { canChargeAppointment, mayOpen } from "../../lib/roles.ts";

/**
 * Encaissement par la praticienne (demande produit du 30/09/2026),
 * côté écran : réglage de la rubrique « Caisse », « Encaisser » dans la fiche
 * de son propre rendez-vous seulement, écran « Vente » atteint depuis cette
 * fiche seulement (jamais le comptoir), pas de « Nouvelle vente » après
 * l'émission. Le serveur vérifie tout (praticienne-api.test.ts).
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const fiche = read("../appointment-detail.tsx");
const vente = read("./vente.tsx");
const emise = read("./emise.tsx");
const reglages = read("../reglages/caisse.tsx");

test("« Encaisser » : gérante et réception toujours ; praticienne sur son propre rendez-vous, réglage activé", () => {
  const apt = { staff_id: 4 };
  assert.equal(canChargeAppointment({ role: "reception", staff_id: null }, apt, false), true);
  assert.equal(canChargeAppointment({ role: "practitioner", staff_id: 4 }, apt, false), false, "réglage désactivé");
  assert.equal(canChargeAppointment({ role: "practitioner", staff_id: 4 }, apt, true), true);
  assert.equal(canChargeAppointment({ role: "practitioner", staff_id: 5 }, apt, true), false, "rendez-vous d'une autre");
  assert.equal(canChargeAppointment({ role: "practitioner", staff_id: null }, { staff_id: null }, true), false, "compte sans fiche de l'équipe");
  assert.equal(canChargeAppointment({ role: "admin", staff_id: null }, apt, true), false);
  // Correctif final (point 1) : un acompte en attente, la praticienne ne voit plus « Encaisser » (la gérante et la réception, si).
  assert.equal(canChargeAppointment({ role: "practitioner", staff_id: 4 }, { ...apt, deposit_held: 1 }, true), false, "acompte en attente");
  assert.equal(canChargeAppointment({ role: "reception", staff_id: null }, { ...apt, deposit_held: 1 }, false), true, "la réception encaisse malgré l'acompte : elle décide");
  assert.match(fiche, /const cashable = canChargeAppointment\(account, apt, checkout\.data === true\) && !apt\.paid/);
  assert.match(fiche, /account\.role === "practitioner" \? api<SaleSettings>\("GET", "\/api\/sales\/settings"\)\.then\(\(s\) => s\.practitioner_checkout\) : Promise\.resolve\(false\)/);
});

test("écran « Vente » : la praticienne seulement avec un rendez-vous (depuis sa fiche), jamais le comptoir ; pas de « Nouvelle vente »", () => {
  assert.equal(mayOpen("practitioner", "vente", "12"), true);
  assert.equal(mayOpen("practitioner", "vente", null), false);
  assert.equal(mayOpen("practitioner", "vente"), false);
  assert.equal(mayOpen("reception", "vente", null), true);
  assert.match(vente, /allowNew=\{canSell\(account\.role\)\}/);
  assert.match(vente, /apt\.invoice_number \? t\("caisse\.rdv_deja_paye", \{ numero: apt\.invoice_number \}\) : t\("caisse\.rdv_deja_paye_court"\)/, "numéro caché à la praticienne : la phrase se passe de lui");
  assert.match(emise, /t\(allowNew \? "caisse\.retour_aujourdhui" : "caisse\.retour_ma_journee"\)/, "la praticienne revient à « Ma journée »");
  assert.match(emise, /\{allowNew && <Button className="h-16 w-full text-base" onClick=\{onNew\}>\{t\("caisse\.nouvelle_vente"\)\}<\/Button>\}/);
});

test("correctif 1 : si elle ne peut plus encaisser ce rendez-vous, retour à « Ma journée » plutôt qu'un ticket pré-rempli ou un comptoir", () => {
  assert.match(vente, /import \{ canChargeAppointment, canSell, homePath \} from "@\/lib\/roles";/);
  assert.match(vente, /if \(blocked \|\| notFound\) navigate\(homePath\(account\.role\)\);/);
  assert.match(vente, /if \(blocked \|\| notFound\) return <EtatChargement \/>;/);
  assert.match(vente, /const ouverture = apt && unpaid && etape === "ticket" && !issued && !pending && !blocked \? openFor\(ticket, apt\.id\) : "keep";/);
});

/**
 * Défaut trouvé à la relecture du correctif final (retouches-brief.md, commit 1) : la réponse
 * réduite du serveur (réglage désactivé, § 6 ci-dessus) ne dit que `practitioner_checkout` ;
 * l'ancien `blocked` attendait le rendez-vous avant de juger, donc l'écran s'affichait entre-temps
 * avec des réglages réduits et Paiement plantait (`settings.methods` absent). Corrigé en bloquant
 * dès que le réglage est faux, sans attendre le rendez-vous ; tant qu'il reste à charger (réglage
 * activé) ou qu'il est introuvable, un état de chargement remplace le ticket et le paiement.
 */
test("retouche : réglage désactivé bloque sans attendre le rendez-vous ; non chargé ou introuvable, état de chargement", () => {
  assert.match(vente, /const blocked = account\.role === "practitioner" && settings\.data !== null\s*&& \(!settings\.data\.practitioner_checkout \|\| \(apt !== null && !canChargeAppointment\(account, apt, settings\.data\.practitioner_checkout\)\)\);/, "bloqué dès le réglage faux, sans apt !== null en préalable");
  assert.match(vente, /const notFound = account\.role === "practitioner" && appointment\.error !== null;/, "rendez-vous introuvable : même renvoi");
  assert.match(vente, /const waiting = account\.role === "practitioner" && !blocked && !notFound && apt === null;/, "ni ticket ni paiement tant que le rendez-vous n'est pas encore su (chargement ou refus)");
  assert.match(vente, /if \(waiting\) return <EtatChargement \/>;/);
  // Après l'étape « émise » (une facture déjà reçue ne doit jamais être cachée par l'attente du rendez-vous).
  assert.ok(vente.indexOf('if (etape === "emise" && issued)') < vente.indexOf("if (waiting) return <EtatChargement />;"), "une facture déjà émise s'affiche sans attendre le rendez-vous");
});

test("réglage « Encaissement par la praticienne » : case de la rubrique « Caisse », oui ou non, libellé traduit au journal", () => {
  assert.ok((CAISSE_KEYS as readonly string[]).includes("caisse.encaissement_praticienne"));
  assert.equal(caisseValues([{ key: "caisse.encaissement_praticienne", secret: false, value: true, set: true }], "fr")["caisse.encaissement_praticienne"], "oui");
  assert.deepEqual(caisseValue("caisse.encaissement_praticienne", "non"), { value: false });
  assert.equal(auditTarget("caisse.encaissement_praticienne", "fr"), "Encaissement par la praticienne");
  assert.equal(auditTarget("caisse.encaissement_praticienne", "en"), "Practitioner checkout");
  // Retouche P1 (critique.md du 1er octobre 2026) : aide ajoutée sous le libellé (caisse.test.ts).
  assert.match(reglages, /<Case id="caisse-encaissement-praticienne" label=\{t\("reglages_caisse\.encaissement_praticienne"\)\} hint=\{t\("reglages_caisse\.encaissement_praticienne_aide"\)\} checked=\{form\["caisse\.encaissement_praticienne"\] === "oui"\} onChange=\{flag\("caisse\.encaissement_praticienne"\)\} \/>/);
});

test("correctif final (point 1) : un acompte en attente, la praticienne voit une phrase à la place d'« Encaisser »", () => {
  assert.match(fiche, /const depositHeld = account\.role === "practitioner" && Boolean\(apt\.deposit_held\) && !apt\.paid && \(apt\.status === "in_progress" \|\| apt\.status === "completed"\) && canChargeAppointment\(account, \{ \.\.\.apt, deposit_held: 0 \}, checkout\.data === true\);/);
  assert.match(fiche, /\{!cashable && depositHeld && <p className="text-sm text-encre-grise">\{t\("rdv\.acompte_praticienne"\)\}<\/p>\}/);
});

// Retouche de fin de vague 3b : la phrase ne se montre que si « Encaisser » lui aurait été proposé
// sans l'acompte (réglage activé, son propre rendez-vous, statut permis) ; sinon rien ne lui dit à
// tort qu'elle pourrait encaisser si l'acompte n'existait pas.
test("retouche : la phrase de l'acompte seulement quand « Encaisser » lui aurait été proposé sans l'acompte", () => {
  const apt = { staff_id: 4 };
  assert.equal(canChargeAppointment({ role: "practitioner", staff_id: 4 }, { ...apt, deposit_held: 0 }, true), true, "réglage activé, son rendez-vous : aurait vu « Encaisser »");
  assert.equal(canChargeAppointment({ role: "practitioner", staff_id: 4 }, { ...apt, deposit_held: 0 }, false), false, "réglage désactivé : n'aurait jamais vu « Encaisser »");
  assert.equal(canChargeAppointment({ role: "practitioner", staff_id: 5 }, { ...apt, deposit_held: 0 }, true), false, "rendez-vous d'une autre praticienne");
});

test("report de la vague 3a : pas de « Changer » de cliente au ticket de la praticienne, que le serveur refuserait", () => {
  const ticket = read("./ticket-vente.tsx");
  assert.match(ticket, /const \{ account \} = useAuth\(\);/);
  assert.match(ticket, /\{account\.role !== "practitioner" && \(\s*<Button variant="link" className="-my-2 shrink-0 px-0" onClick=\{\(\) => setFenetre\("cliente"\)\}>/);
});
