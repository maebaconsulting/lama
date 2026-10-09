import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

/**
 * Garde-fous D8, D9, D10 (audit-responsive.md) : les cibles tactiles doivent
 * faire au moins 44 x 44 px, sans forcément grossir l'icône affichée.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Classe Tailwind qui réduirait un `<Button>` sous 44 px (`h-0`..`h-10`, `h-10.5`, et leurs variantes `min-h-`, préfixées ou non). */
const SIZE_CLASS = /(?:^|\s)(?:[a-z]+:)?(?:h|min-h)-(?:[0-9]|10)(?:\.5)?(?=\s|$)/;

function literalText(e: ts.Expression | undefined): string | null {
  if (!e) return null;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isJsxExpression(e) && e.expression) return literalText(e.expression);
  return null;
}

/**
 * Relecture (tour 1) : le motif `<Button\b[^>]*className="[^"]*"` ne
 * traversait pas les `>` internes (par exemple ceux d'une flèche `=>` dans un
 * `onClick` écrit avant `className`), si bien qu'un `<Button>` réducteur
 * écrit sur plusieurs lignes pouvait passer inaperçu. Analyse par l'AST
 * TypeScript (comme `dialog-footer-nesting.test.ts`) : chemins
 * (`fichier:ligne : classe`) de tout `<Button>` dont le `className` réduit sa
 * hauteur sous 44 px, quelle que soit sa mise en forme.
 */
export function reducedButtons(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const check = (el: ts.JsxOpeningElement | ts.JsxSelfClosingElement) => {
    if (el.tagName.getText(sf) !== "Button") return;
    for (const attr of el.attributes.properties) {
      if (!ts.isJsxAttribute(attr) || attr.name.getText(sf) !== "className") continue;
      const text = literalText(attr.initializer);
      if (text && SIZE_CLASS.test(text)) {
        const { line } = sf.getLineAndCharacterOfPosition(el.getStart(sf));
        found.push(`${file}:${line + 1} : ${text}`);
      }
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) check(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

test("D8 : le bouton de fermeture des fenêtres fait au moins 44 x 44 px", () => {
  const text = read("./ui/dialog.tsx");
  const close = text.match(/<DialogPrimitive\.Close className="([^"]*)"/);
  assert.ok(close, "bouton de fermeture introuvable");
  assert.match(close![1], /\bh-11\b/);
  assert.match(close![1], /\bw-11\b/);
});

test("D9 : les boutons icônes des listes ne sont plus réduits à 28 px", () => {
  const files = [
    "./client-list.tsx",
    "./service-list.tsx",
    "./product-list.tsx",
    "./staff-list.tsx",
    "./appointment-list.tsx",
  ];
  for (const f of files) {
    assert.ok(!/h-7 w-7/.test(read(f)), `${f} contient encore un bouton icône de 28 px`);
  }
});

test("sous-projet 4 § 3.4 : toutes les tailles de bouton font 44 px au moins, partout", () => {
  const button = read("./ui/button.tsx");
  assert.match(button, /default: "h-11 /);
  assert.match(button, /sm: "h-11 [^"]*"/);
  assert.match(button, /lg: "h-12 /);
  assert.match(button, /icon: "h-11 w-11[" ]/);
  assert.doesNotMatch(button, /md:h-9/, "plus de bouton de 36 px à la souris");
});

test("sous-projet 4 § 3.4 : aucun écran ne réduit un bouton sous 44 px, balises multi-lignes comprises", () => {
  const dir = new URL("./", import.meta.url);
  const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".tsx"));
  const offenders = files.flatMap((f) => reducedButtons(f, readFileSync(new URL(f, dir), "utf8")));
  assert.deepEqual(offenders, []);
});

test("le détecteur repère un <Button> réducteur écrit sur plusieurs lignes, même avec une flèche `=>` avant className", () => {
  const sample = [
    "<Button",
    "  variant=\"outline\"",
    "  onClick={() => setPage(pag.page - 1)}",
    "  size=\"icon\"",
    "  className=\"h-8 w-8\"",
    ">",
    "  <ChevronLeft className=\"h-4 w-4\" />",
    "</Button>",
  ].join("\n");
  assert.deepEqual(reducedButtons("x.tsx", sample), ["x.tsx:1 : h-8 w-8"]);
});

test("le détecteur laisse passer un <Button> multi-lignes dont le className ne réduit rien (44 px)", () => {
  const sample = [
    "<Button",
    "  variant=\"destructive\"",
    "  onClick={() => {",
    "    doThing();",
    "  }}",
    "  className=\"mt-3 w-full\"",
    ">",
    "  Go",
    "</Button>",
  ].join("\n");
  assert.deepEqual(reducedButtons("x.tsx", sample), []);
});

test("D9, repris en vague 4 : la bascule « Active » d'une prestation, dans sa fiche, fait au moins 48 px de haut", () => {
  assert.match(read("./fiches/fiche-prestation.tsx"), /role="switch"[\s\S]*className=\{cn\("flex min-h-12 w-full items-center/);
});

test("retouche R2 vague 2 : les boutons du ticket (« Préparation du ticket… ») font au moins 48 px de haut, libellé sur deux lignes plutôt que coupé", () => {
  const boutons = read("./caisse/boutons-ticket.tsx");
  assert.match(boutons, /const BTN = "h-auto min-h-12 [^"]*";/, "48 px de haut (min-h-12) au moins");
  assert.match(boutons, /whitespace-normal/, "le libellé plus long passe sur deux lignes plutôt que d'être coupé");
});

test("D9 : le lien vers la fiche cliente fait au moins 44 px de haut", () => {
  assert.match(read("./appointment-detail.tsx"), /flex min-h-11 max-w-full items-center break-words text-left font-serif text-3xl/);
});

test("relecture finale : toucher le nom de la cliente ouvre sa fiche dans le panneau, sans quitter l'agenda", () => {
  const text = read("./appointment-detail.tsx");
  assert.match(text, /openPanel\("client", apt\.client_id\)/);
  assert.doesNotMatch(text, /navigate\(`\/clients\//);
});

test("D10 : le bouton « Retirer le blocage » a une zone cliquable élargie sans grossir l'icône", () => {
  const text = read("./agenda/grille.tsx");
  const index = text.indexOf('aria-label={t("agenda.retirer_blocage")}');
  assert.ok(index >= 0, "bouton « Retirer le blocage » introuvable");
  const around = text.slice(Math.max(0, index - 400), index + 500);
  // Passe V 1.0 (V1-23) : 44 px de large sur toute la hauteur du bloc, sans zone qui déborde sur les voisins.
  assert.match(around, /-mr-2 flex h-full w-11 shrink-0/, "zone de toucher de 44 px de large dans le bloc");
  assert.doesNotMatch(around, /-inset-4/, "plus de zone qui déborde sur les blocs voisins");
  assert.match(around, /<X className="h-3 w-3" aria-hidden="true" \/>/, "l'icône ne doit pas grossir");
});

test("tâche 11 : un bouton icône garde ses 44 x 44 px dans une rangée qui manque de place", () => {
  // Vu à 390 px : « Ajouter la note » du panneau réduit à 37 px de large par le champ voisin.
  assert.match(read("./ui/button.tsx"), /icon: "h-11 w-11 shrink-0"/);
});

test("relecture de la tâche 5 : « Émettre l'avoir » fait 64 px de haut, comme les autres gros boutons d'action de la caisse (h-16)", () => {
  const formulaire = read("./caisse/formulaire-avoir.tsx");
  assert.match(formulaire, /<Button className="h-auto min-h-16 whitespace-normal text-base" disabled=\{stop !== null \|\| sending\} onClick=\{send\}>/);
});

test("tâche 11, repris en vague 4 : plus aucun bouton sur les cartes de l'équipe, les actions sont dans la fiche du panneau", () => {
  // Vu à 390 px en vague 1 : boutons de la carte coupés ou cachés. Depuis la vague 4 (§ 6), la carte
  // n'a plus que la ligne qui ouvre la fiche ; Modifier, Désactiver et Supprimer sont dans la fiche.
  const staff = read("./staff-list.tsx");
  assert.doesNotMatch(staff, /<Button|Pencil|Trash2|UserX/);
  assert.match(read("./fiches/fiche-membre.tsx"), /<div className="grid grid-cols-2 gap-2">/);
});
