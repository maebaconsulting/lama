import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseRoute, pathFor } from "../../lib/routes.ts";

/**
 * Écran « Caisse du jour » (sous-projet 5 § 6.3), câblé sur
 * `lib/caisse-jour.ts` (testé en exécution) : adresse dans les deux langues,
 * jour choisi, clôture enregistrée une seule fois, clôtures et leur ticket,
 * « Après clôture », documents ouverts dans le panneau.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const ecran = read("./caisse-jour.tsx");
const app = read("../../app.tsx");

test("adresse : /caisse et /till, branchée dans l'application", () => {
  assert.deepEqual(parseRoute("/caisse"), { view: "caisse", id: null });
  assert.deepEqual(parseRoute("/till"), { view: "caisse", id: null });
  assert.equal(pathFor("caisse", "en"), "/till");
  assert.match(app, /case "caisse": return <CaisseJour \/>;/);
  assert.match(app, /view !== "vente" && view !== "caisse";/, "pas de « + » flottant sur le champ des espèces comptées");
});

test("jour affiché : aujourd'hui à Douala, jours passés par les flèches, jamais un jour à venir", () => {
  assert.match(ecran, /const \[day, setDay\] = useState\(clock\.day\);/);
  assert.match(ecran, /api<CashDay>\("GET", `\/api\/cash\/day\?date=\$\{day\}`\), \["invoices"\]\)/);
  assert.match(ecran, /disabled=\{day >= clock\.day\} onClick=\{\(\) => setDay\(shiftDay\(day, 1\)\)\}/);
  assert.match(ecran, /const data = report\.data && report\.data\.day === day \? report\.data : null;/, "jamais les chiffres d'un autre jour pendant le chargement");
});

test("clôture : identifiant tiré une fois, espèces comptées lues par parseCounted, écart dit tout de suite, serveur seul juge", () => {
  assert.match(ecran, /const \[requestId\] = useState\(\(\) => newRequestId\(\)\);/);
  assert.match(ecran, /const value = parseCounted\(counted\);/);
  assert.match(ecran, /api\("POST", "\/api\/cash\/closings", \{ request_id: requestId, day: report\.day, cash_counted: value, note \}\)/);
  assert.match(ecran, /\{value === null \? t\("caisse_jour\.saisir_especes"\) : ecart\(expected, value\)\}/);
  assert.match(ecran, /\{canClose\(data, clock\.day\) && !closing && \(/);
  assert.match(ecran, /className="h-16 w-full text-base" onClick=\{\(\) => setClosing\(true\)\}>\{t\("caisse_jour\.cloturer"\)\}/, "bouton de 64 px");
});

test("clôtures enregistrées avec leur ticket, « Après clôture », documents ouverts dans le panneau", () => {
  assert.match(ecran, /<BoutonsTicket source=\{closingSource\(closing\)\} \/>/);
  assert.match(ecran, /t\(closed \? "caisse_jour\.apres_cloture" : "caisse_jour\.encaisse"\)/);
  assert.match(ecran, /onClick=\{\(\) => openPanel\("invoice", d\.id\)\}/);
  assert.match(ecran, /\{movedMethods\(summary\)\.map\(\(m\) => \(/);
  assert.match(ecran, /<Montant valeur=\{signedPrice\(m\.net, lang\)\} \/>/, "net négatif avec le moins typographique");
});

/**
 * Retouche P2 (critique.md du 1er octobre 2026) : la note de clôture s'affichait à l'écran sans
 * étiquette (« Billet de 500 manquant » toute seule), alors que le ticket imprimé l'annonce
 * (`ticket.note`, « Note : … »). Même préfixe à l'écran désormais, clé courte à parité.
 */
test("retouche P2 : la note de clôture préfixée de « Note : », à parité avec le ticket imprimé", () => {
  assert.match(ecran, /\{closing\.note && <p className="break-words pt-1 text-muted-foreground">\{t\("caisse_jour\.note_texte", \{ note: closing\.note \}\)\}<\/p>\}/);
  const fr = read("../../i18n/fr.ts");
  const en = read("../../i18n/en.ts");
  assert.match(fr, /"caisse_jour\.note_texte": "Note\\u00a0: \{note\}",/);
  assert.match(en, /"caisse_jour\.note_texte": "Note: \{note\}",/);
});

/**
 * Retouche P2 (critique.md du 1er octobre 2026) : avec un nombre impair de moyens de paiement
 * mouvementés (le cas le plus courant à Douala : espèces, carte, Orange Money), la grille à deux
 * colonnes du téléphone laissait le dernier moyen seul sur sa ligne, un vide ivoire à sa droite.
 * Le dernier occupe désormais toute la largeur quand le compte est impair ; `@3xl` (4 colonnes)
 * reste inchangé.
 */
test("retouche P2 : le dernier moyen d'un nombre impair occupe toute la largeur (pas de rangée orpheline)", () => {
  assert.match(ecran, /\{movedMethods\(summary\)\.map\(\(m\) => \(/, "la signature de map reste inchangée (pas de nouvel index)");
  assert.match(ecran, /className="flex min-w-0 flex-col gap-1 rounded-sm bg-muted px-4 py-3 odd:last:col-span-2 @3xl:col-span-1"/);
});

test("acomptes reçus et remboursés (vague 3b) : une ligne chacun, seulement s'il y en a eu, remboursés en négatif", () => {
  assert.match(ecran, /\{summary\.deposits\.received\.count > 0 && \(/);
  assert.match(ecran, /tn\("caisse_jour\.acomptes", summary\.deposits\.received\.count\)/);
  assert.match(ecran, /tn\("caisse_jour\.acomptes_rembourses", summary\.deposits\.refunded\.count\)/);
  assert.match(ecran, /signedPrice\(-summary\.deposits\.refunded\.total, lang\)/);
});
