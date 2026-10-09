import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import ts from "typescript";

/**
 * Garde-fou (relecture 2, audit-responsive.md D12) : DialogFooter doit
 * toujours être un enfant DIRECT de DialogContent. dialog.tsx sépare
 * l'en-tête, le corps qui défile et le pied en ne regardant QUE les enfants
 * directs de DialogContent (voir DialogContent, `React.Children.toArray`) ;
 * un DialogFooter imbriqué dans un autre élément (un <form>, par exemple)
 * lui échappe et part dans le corps qui défile avec le reste, avec le
 * même risque que le pied "sticky" corrigé en relecture 1 : le bouton
 * d'action peut sortir de l'écran (constaté dans
 * reschedule-appointment.tsx, où DialogFooter était dans le <form>).
 */
const ROOT = new URL("../..", import.meta.url).pathname; // src/client

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function tagName(el: ts.JsxTagNameExpression, sf: ts.SourceFile): string {
  return el.getText(sf);
}

/** Chemins (`fichier:ligne`) de tout DialogFooter dont le parent JSX n'est pas DialogContent. */
export function misplacedDialogFooters(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && tagName(node.openingElement.tagName, sf) === "DialogFooter") {
      const parent = node.parent;
      const okParent = ts.isJsxElement(parent) && tagName(parent.openingElement.tagName, sf) === "DialogContent";
      if (!okParent) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        found.push(`${file}:${line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

test("aucun DialogFooter n'est imbriqué dans un élément autre que DialogContent", () => {
  const files = sources(ROOT).map((f) => relative(ROOT, f));
  const offenders = files.flatMap((f) => misplacedDialogFooters(f, readFileSync(join(ROOT, f), "utf8")));
  assert.deepEqual(offenders, []);
});

test("le détecteur repère bien un DialogFooter imbriqué dans un <form>", () => {
  const sample = [
    "<DialogContent>",
    "  <DialogHeader><DialogTitle>Titre</DialogTitle></DialogHeader>",
    "  <form onSubmit={submit}>",
    "    <DialogFooter><button type=\"submit\">Go</button></DialogFooter>",
    "  </form>",
    "</DialogContent>",
  ].join("\n");
  assert.deepEqual(misplacedDialogFooters("x.tsx", sample), ["x.tsx:4"]);
});

test("le détecteur laisse passer un DialogFooter enfant direct de DialogContent", () => {
  const sample = [
    "<DialogContent>",
    "  <DialogHeader><DialogTitle>Titre</DialogTitle></DialogHeader>",
    "  <form id=\"f\" onSubmit={submit}>...</form>",
    "  <DialogFooter><button type=\"submit\" form=\"f\">Go</button></DialogFooter>",
    "</DialogContent>",
  ].join("\n");
  assert.deepEqual(misplacedDialogFooters("x.tsx", sample), []);
});
