import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const ROOT = new URL("..", import.meta.url).pathname;

/** Référence de conception, en français par décision (spec § 4.2). */
const EXEMPT = new Set(["components/charte.tsx"]);

/** Dictionnaires : texte français légitime, pas du texte en dur à traduire. */
const DICTIONARIES = new Set(["i18n/fr.ts", "i18n/en.ts"]);

/** Liste d'attente des fichiers pas encore traduits : vide depuis la fin du sous-projet 3. */
const PENDING = new Set<string>([]);

/** Attributs et propriétés dont la valeur s'affiche ou se lit à voix haute. */
const TEXT_ATTRIBUTES = new Set(["placeholder", "title", "aria-label", "alt", "label", "titre", "sousTitre", "description", "message", "libelle", "question"]);
/** Fonctions d'état qui affichent leur argument. */
const TEXT_SETTERS = new Set(["setError", "setOk"]);
const LETTER = /\p{L}/u;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.(test|d)\.ts$/.test(name) ? [path] : [];
  });
}

/** Textes visibles écrits en dur dans un fichier, sous la forme `fichier:ligne : texte`. */
export function hardcoded(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const report = (node: ts.Node, raw: string) => {
    const text = raw.replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
    if (!LETTER.test(text)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    found.push(`${file}:${line + 1} : ${text.slice(0, 60)}`);
  };
  const literalText = (e: ts.Node | undefined): string | null => {
    if (!e) return null;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isTemplateExpression(e)) return [e.head.text, ...e.templateSpans.map((s) => s.literal.text)].join(" ");
    if (ts.isParenthesizedExpression(e)) return literalText(e.expression);
    if (ts.isConditionalExpression(e)) return [literalText(e.whenTrue), literalText(e.whenFalse)].filter(Boolean).join(" ") || null;
    if (ts.isBinaryExpression(e) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(e.operatorToken.kind)) {
      return literalText(e.right);
    }
    return null;
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) report(node, node.text);
    else if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const text = literalText(node.expression);
      if (text) report(node, text);
    } else if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText(sf))) {
      const init = node.initializer;
      const text = !init ? null : ts.isStringLiteral(init) ? init.text : ts.isJsxExpression(init) ? literalText(init.expression) : null;
      if (text) report(node, text);
    } else if (ts.isPropertyAssignment(node) && TEXT_ATTRIBUTES.has(node.name.getText(sf))) {
      const text = literalText(node.initializer);
      if (text) report(node, text);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && TEXT_SETTERS.has(node.expression.text)) {
      const text = literalText(node.arguments[0]);
      if (text) report(node, text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const files = sources(ROOT)
  .map((f) => relative(ROOT, f))
  .filter((f) => !DICTIONARIES.has(f) && !EXEMPT.has(f));
const scan = (f: string) => hardcoded(f, readFileSync(join(ROOT, f), "utf8"));

test("aucun texte visible écrit en dur hors de la liste d'attente (spec § 11)", () => {
  assert.deepEqual(files.filter((f) => !PENDING.has(f)).flatMap(scan), []);
});

test("la liste d'attente ne garde que des fichiers qui ont encore du texte en dur", () => {
  for (const f of PENDING) {
    assert.ok(files.includes(f), `${f} n'existe plus : le retirer de PENDING`);
    assert.ok(scan(f).length > 0, `${f} est traduit : le retirer de PENDING`);
  }
});

test("le détecteur repère texte, attributs, propriétés et messages, et ignore t() et les symboles", () => {
  const sample = [
    "const items = [{ label: \"Dashboard\" }];",
    "export function X({ t, n }: any) {",
    "  setError(\"Name is required\");",
    "  return <div title=\"Titre\">Bonjour <b>{\"Salut\"}</b>{n ? \"Oui\" : \"Non\"}",
    "    <input placeholder={`Chercher ${n}`} aria-label={t(\"x.y\")} />{\"\\u2013\"}{n || \"\\u2013\"} &middot; 12:30</div>;",
    "}",
  ].join("\n");
  assert.deepEqual(hardcoded("x.tsx", sample).map((s) => s.replace(/^x\.tsx:\d+ : /, "")), [
    "Dashboard", "Name is required", "Titre", "Bonjour", "Salut", "Oui Non", "Chercher",
  ]);
});

// Relecture finale (constat 4) : les nouvelles propriétés visibles des composants « comptoir »
// (libelle, question) n'étaient pas dans TEXT_ATTRIBUTES ; un libelle="Supprimer" en dur aurait
// passé le garde-fou à la vague 2.
test("le détecteur repère aussi libelle et question (constat 4)", () => {
  const sample = [
    "export function X() {",
    "  return <BoutonDestructif libelle=\"Supprimer\" question=\"Supprimer ce rendez-vous ?\" onConfirm={x} />;",
    "}",
  ].join("\n");
  assert.deepEqual(hardcoded("x.tsx", sample).map((s) => s.replace(/^x\.tsx:\d+ : /, "")), [
    "Supprimer", "Supprimer ce rendez-vous ?",
  ]);
});

// Écart signalé par le contrôleur (rapport de la tâche 14, section Écarts) : la fiche proposait ici un
// test qui ne fait que relire PENDING et EXEMPT (tautologique). Ce test relit plutôt toutes les
// sources contrôlées (même collecte que le garde-fou, sans filtrer par PENDING) avec hardcoded().
test("tout le client passe par t() ; seule la charte, référence de conception, reste en français", () => {
  assert.deepEqual(files.flatMap(scan), []);
  assert.deepEqual([...EXEMPT], ["components/charte.tsx"]);
});
