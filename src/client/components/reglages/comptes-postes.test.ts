import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { en } from "../../i18n/en.ts";
import { fr } from "../../i18n/fr.ts";

/**
 * Comptes et postes sur le motif des fiches (sous-projet 4 § 7.1, § 6) :
 * liste (cartes au téléphone, lignes denses dès 36 rem), fiche dans le
 * panneau avec les actions. Report D5 : le « Modifier » d'un compte n'est
 * plus dans une colonne hors de l'écran.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const comptes = read("./comptes.tsx");
const ficheCompte = read("./fiche-compte.tsx");
const postes = read("./postes.tsx");
const fichePoste = read("./fiche-poste.tsx");
const app = read("../../app.tsx");

test("comptes : plus de tableau (D5), une ligne par compte qui ouvre sa fiche dans le panneau, marquée quand elle est ouverte", () => {
  assert.doesNotMatch(comptes, /<Table\b/);
  assert.match(comptes, /<div className="@container">\s*<ListeFiches libelle=\{t\("reglages\.rubrique\.comptes"\)\}>/);
  assert.match(comptes, /onOpen=\{\(\) => openPanel\("account", a\.id\)\}/);
  assert.match(comptes, /actif=\{isOpen\(panel, "account", a\.id\)\}/);
  assert.match(comptes, /attenue=\{a\.active !== 1\}/, "compte désactivé grisé");
  assert.match(comptes, /export function Edition\(/, "la modification s'ouvre depuis la fiche");
});

test("fiche d'un compte : Modifier et Débloquer selon les règles du serveur, fiche disparue dite", () => {
  assert.match(ficheCompte, /const commands = accountCommands\(moi, cible, now\);/);
  assert.match(ficheCompte, /\{modifier && <Button[^\n]*?\{t\("commun\.modifier"\)\}/);
  assert.match(ficheCompte, /\{commands\.unlock && <Button[^\n]*?\{t\("comptes\.debloquer"\)\}/);
  assert.match(ficheCompte, /<Edition\b/);
  assert.match(ficheCompte, /t\("fiche\.introuvable"\)/);
  assert.match(ficheCompte, /useLoad\(\(\) => api<\{ accounts: Account\[\] \}>\("GET", "\/api\/accounts"\), \["accounts"\]\)/, "relue aux signaux du serveur");
});

test("postes : une ligne par poste qui ouvre sa fiche ; révocation dans la fiche, au trait rouge, puis mot de passe", () => {
  assert.doesNotMatch(postes, /<Table\b/);
  assert.match(postes, /onOpen=\{\(\) => openPanel\("device", d\.id\)\}/);
  assert.match(postes, /actif=\{isOpen\(panel, "device", d\.id\)\}/);
  assert.doesNotMatch(postes, /DELETE/, "plus de révocation depuis la ligne");
  assert.match(fichePoste, /<BoutonDestructif libelle=\{t\("postes\.revoquer"\)\} question=\{t\("postes\.question_revocation"\)\}/);
  assert.match(fichePoste, /await confirm\(\(\) => api\("DELETE", `\/api\/devices\/\$\{poste\.id\}`\)\)/);
  assert.match(fichePoste, /\{!poste\.revoked && \(/, "un poste révoqué n'a plus d'action");
  assert.match(postes, /attenue=\{d\.revoked === 1\}/, "poste révoqué grisé");
});

test("panneau : compte et poste ouverts sur les Réglages pour les rôles qui ont la rubrique, administrateur compris", () => {
  const settings = app.indexOf("settingsPanelAllowed(role, panel.kind)");
  const activity = app.indexOf("if (!loadsActivity(role)) return null;");
  assert.ok(settings > 0 && activity > settings, "les fiches des Réglages passent avant la garde de l'activité");
  assert.match(app, /if \(view !== "reglages" \|\| !settingsPanelAllowed\(role, panel\.kind\)\) return null;/);
  assert.match(app, /<FicheCompte key=\{itemId\} id=\{itemId\} \/>/);
  assert.match(app, /<FichePoste key=\{itemId\} id=\{itemId\} \/>/);
});

test("fiche d'un poste : « jamais » en texte courant Jost, encre grise ; une vraie date reste en chiffres Garamond (retouche 10)", () => {
  assert.match(
    fichePoste,
    /\{poste\.last_seen_at\s*\?\s*<span className="chiffres-tabulaires">\{dateHeure\(poste\.last_seen_at, lang\)\}<\/span>\s*:\s*<span className="text-encre-grise">\{t\("commun\.jamais"\)\}<\/span>\}/,
  );
});

test("libellés des fiches des Réglages dans les deux langues", () => {
  for (const key of ["panneau.compte", "panneau.poste", "postes.vu_le", "postes.question_revocation"] as const) {
    assert.ok(key in fr && key in en, key);
  }
  assert.equal(fr["postes.question_revocation"], "Révoquer ce poste\u00a0? Il devra être déclaré de nouveau.");
});
