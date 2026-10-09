import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Passe de finition V 1.0, vague B (écran) : erreurs gardées dans la fenêtre
 * (V1-11), refus de suppression affiché (V1-14), « Réessayer » et états de
 * chargement (V1-16 à V1-18, V1-20, V1-21), seuil de stock à 0 (V1-19).
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

for (const file of ["create-client.tsx", "create-service.tsx", "create-product.tsx", "create-staff.tsx", "create-appointment.tsx"]) {
  test(`${file} : l'erreur reste dans la fenêtre, au-dessus des boutons, jamais dans le bandeau global (V1-11)`, () => {
    const text = read(`./${file}`);
    assert.match(text, /import \{ Erreur(, useAmenerALaVue)? \} from "\.\/champ";/);
    assert.match(text, /const \[error, setError\] = useState<string \| null>\(null\);/);
    assert.doesNotMatch(text, /const \{[^}]*\bsetError\b[^}]*\} = useApp\(\);/, "setError du bandeau global encore pris dans useApp");
    const erreur = text.indexOf("<Erreur message={error} />");
    assert.ok(erreur > 0, "<Erreur message={error} /> absent");
    assert.ok(erreur < text.indexOf("<DialogFooter>"), "l'erreur doit précéder les boutons");
    assert.match(text, /setError\(null\);/, "l'erreur précédente s'efface à l'envoi");
  });
}

test("formulaire produit : le seuil d'alerte passe par lowStockValue (V1-19)", () => {
  const text = read("./create-product.tsx");
  assert.match(text, /low_stock_alert: lowStockValue\(lowStockAlert\),/);
  assert.doesNotMatch(text, /parseInt\(lowStockAlert\) \|\| 5/);
});

test("liste des rendez-vous : un refus de suppression est affiché (V1-14)", () => {
  const text = read("./appointment-list.tsx");
  assert.match(text, /deleteAppointment, openPanel, setError,/);
  assert.match(text, /const supprimer = \(id: number\) => deleteAppointment\(id\)\.catch\(\(err: Error\) => setError\(err\.message\)\);/, "le refus reste affiché, dans `supprimer` (confirmation des corbeilles)");
});

test("acomptes d'un rendez-vous : l'échec de lecture s'affiche avec « Réessayer » (V1-16)", () => {
  const text = read("./caisse/acompte-rdv.tsx");
  assert.match(text, /import \{ EtatErreur, Montant \} from "\.\.\/comptoir";/);
  const garde = text.indexOf("if (list.error && !list.data) return <EtatErreur message={list.error} onRetry={() => void list.reload()} />;");
  assert.ok(garde > 0, "garde d'erreur absente");
  assert.ok(garde < text.indexOf("if (deposits.length === 0 && !canTake) return null;"), "l'erreur doit passer avant le retour vide");
});

test("campagne : chargement affiché pendant le calcul, jamais « Envoyer à 0 clientes » (V1-17)", () => {
  const text = read("./campagnes/fenetre-campagne.tsx");
  assert.match(text, /import \{ EtatChargement \} from "\.\.\/comptoir";/);
  assert.match(text, /\{preview === null && !error && <EtatChargement \/>\}/);
  assert.match(text, /\{preview !== null && <Button type="button" disabled=\{!ready\} onClick=\{\(\) => setConfirming\(true\)\}>/);
});

test("envoi d'un produit : chargement affiché entre le choix et la réponse (V1-18)", () => {
  const text = read("./produits/envoi-produit.tsx");
  assert.match(text, /import \{ EtatChargement \} from "\.\.\/comptoir";/);
  assert.match(text, /\{choisi && text === null && !error && <EtatChargement \/>\}/);
});

for (const [file, titre] of [
  ["institut.tsx", "reglages.rubrique.institut"],
  ["caisse.tsx", "reglages.rubrique.caisse"],
  ["fidelite.tsx", "reglages.rubrique.fidelite"],
] as const) {
  test(`réglages ${file} : titre visible pendant le chargement, « Réessayer » en échec (V1-20)`, () => {
    const text = read(`./reglages/${file}`);
    assert.doesNotMatch(text, /return <Erreur message=\{loadError\} \/>;/);
    assert.match(text, /import \{ EtatChargement, EtatErreur \} from "\.\.\/comptoir";/);
    // Ancré sur la garde de rendu (la garde de l'effet de chargement porte le même début de ligne).
    const garde = text.slice(text.indexOf("if (!form || !baseline) {\n    return ("));
    assert.match(garde, new RegExp(`^if \\(!form \\|\\| !baseline\\) \\{\\s*return \\(\\s*<Rubrique titre=\\{t\\("${titre.replace(/\./g, "\\.")}"\\)\\}`));
    assert.match(garde, /\{loadError \? <EtatErreur message=\{loadError\} onRetry=\{\(\) => void reload\(\)\} \/> : <EtatChargement \/>\}/);
  });
}

for (const file of ["fournisseur-whatsapp.tsx", "fournisseur-sms.tsx"]) {
  test(`réglages ${file} : chargement puis « Réessayer » en échec, sous le titre du bloc parent (V1-20)`, () => {
    const text = read(`./reglages/${file}`);
    assert.doesNotMatch(text, /return <Erreur message=\{loadError\} \/>;/);
    assert.match(text, /if \(!form \|\| !baseline\) return loadError \? <EtatErreur message=\{loadError\} onRetry=\{\(\) => void reload\(\)\} \/> : <EtatChargement \/>;/);
  });
}

test("Connexions : « Pas encore configuré… » seulement une fois le statut lu (V1-21)", () => {
  const text = read("./reglages/connexions.tsx");
  assert.match(text, /\{statut\.data && \(\s*<p className="text-sm">\s*\{drive\?\.configured \?/);
});

test("vérification au navigateur (V1-11) : un refus en fin de corps défilant est amené à l'écran", () => {
  const champ = read("./champ.tsx");
  assert.match(champ, /export function useAmenerALaVue<T extends HTMLElement>\(trigger: unknown\)/);
  assert.match(champ, /if \(trigger\) ref\.current\?\.scrollIntoView\?\.\(\{ block: "nearest" \}\);\n  \}, \[trigger\]\);/);
  assert.match(champ, /const ref = useAmenerALaVue<HTMLParagraphElement>\(message && visible \? message : null\);\n  return message && visible \? <p ref=\{ref\} role="alert"/, "toute <Erreur> d'une fenêtre est amenée à l'écran");
  for (const file of ["./create-appointment.tsx", "./reschedule-appointment.tsx", "./agenda/bloquer-creneau.tsx"]) {
    const text = read(file);
    assert.match(text, /const conflictRef = useAmenerALaVue<HTMLDivElement>\(conflicts\);/, file);
    assert.match(text, /<div ref=\{conflictRef\} role="alert"/, `${file} : le créneau pris est amené à l'écran`);
  }
});

test("décision 8 (V1-12) : prix ou coût illisible refusé dans la fenêtre, jamais enregistré à 0 F", () => {
  const product = read("./create-product.tsx");
  assert.match(product, /const problem = nameProblem\(name\) \?\? amountProblem\(price, "prix"\) \?\? amountProblem\(cost, "cout"\);\n    if \(problem\) \{ setError\(t\(problem\)\); return; \}/);
  const service = read("./create-service.tsx");
  assert.match(service, /const problem = nameProblem\(name\) \?\? amountProblem\(price, "prix"\);\n    if \(problem\) \{ setError\(t\(problem\)\); return; \}/);
});
