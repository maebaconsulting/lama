import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Passe de finition V 1.0, vague E (V1-47 à V1-53, V1-56, V1-57) : libellés
 * à l'allure de `Label`, champs empilés au téléphone, 44 px sur tablette,
 * titres au style des pages de fiches, bouton de création dans les états
 * vides, bouton seul sur toute la largeur.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("V1-47 : la légende « Anniversaire » a l'allure des autres libellés", () => {
  assert.match(read("./create-client.tsx"), /<legend className="etiquette leading-snug text-encre-grise">\{t\("crm\.anniversaire"\)\}<\/legend>/);
});

test("V1-48 : « Recevoir les messages par » a l'allure d'un libellé", () => {
  assert.match(read("./fiches/whatsapp-cliente.tsx"), /<p id=\{`canal-\$\{client\.id\}`\} className="etiquette leading-snug text-encre-grise">\{t\("cliente\.canal"\)\}<\/p>/);
});

test("V1-49 : les libellés en capitales gardent un interligne lisible sur deux lignes", () => {
  const label = read("./ui/label.tsx");
  assert.match(label, /"etiquette leading-snug text-encre-grise /);
  assert.doesNotMatch(label, /leading-none/);
});

test("V1-50 : catégories française et anglaise du produit empilées, comme pour une prestation", () => {
  const produit = read("./create-product.tsx");
  assert.doesNotMatch(produit, /<div className="grid grid-cols-2 gap-3">\s*<div className="space-y-1\.5">\s*<Label htmlFor="fpr-categorie">/);
  assert.match(produit, /<div className="space-y-1\.5">\s*<Label htmlFor="fpr-categorie">[\s\S]*?<\/div>\s*<div className="space-y-1\.5">\s*<Label htmlFor="fpr-categorie-en">/);
});

test("V1-51 : e-mail et téléphone sur une colonne au téléphone, deux à partir de 640 px", () => {
  assert.match(read("./create-client.tsx"), /<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">\s*<div className="space-y-1\.5">\s*<Label htmlFor="nc-email-cliente">/);
  assert.match(read("./create-staff.tsx"), /<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">\s*<div className="space-y-1\.5">\s*<Label htmlFor="fe-email">/);
});

test("V1-52 : recherche et filtre des rendez-vous à 44 px sur tablette", () => {
  const liste = read("./appointment-list.tsx");
  assert.doesNotMatch(liste, /sm:h-9/);
  assert.match(liste, /className="h-11 pl-9"/);
  assert.match(liste, /className=\{cn\(SELECT, "sm:w-auto"\)\}/);
});

test("V1-53 : titres des rendez-vous et de l'agenda au style des pages de fiches", () => {
  assert.match(read("./fiches/liste-fiches.tsx"), /<h1 className="font-serif text-3xl leading-tight">/, "modèle des pages de fiches");
  assert.match(read("./appointment-list.tsx"), /<h1 className="font-serif text-3xl leading-tight">\{t\("menu\.rendez_vous"\)\}<\/h1>/);
  assert.match(read("./calendar-view.tsx"), /<h1 className="sr-only font-serif text-3xl leading-tight md:not-sr-only md:mr-auto">\{t\("menu\.agenda"\)\}<\/h1>/);
});

test("V1-56 : prestations et produits vides proposent la création à la gérante, jamais pendant une recherche", () => {
  assert.match(
    read("./service-list.tsx"),
    /<EtatVide\s+message=\{services\.length === 0 \? t\("prestation\.aucune"\) : t\("prestation\.aucune_trouvee"\)\}\s+action=\{commands\.manage && !search \? \{ libelle: t\("prestation\.ajouter"\), onClick: \(\) => setCreating\(true\) \} : undefined\}\s*\/>/,
  );
  assert.match(
    read("./product-list.tsx"),
    /<EtatVide\s+message=\{productsSearch \? t\("produit\.aucun"\) : t\("produit\.aucun_encore"\)\}\s+action=\{commands\.manage && !productsSearch \? \{ libelle: t\("produit\.ajouter"\), onClick: \(\) => setCreating\(true\) \} : undefined\}\s*\/>/,
  );
});

test("V1-57 : « Voir son agenda » sur toute la largeur quand « Modifier » n'est pas proposé", () => {
  assert.match(read("./fiches/fiche-membre.tsx"), /<Button className=\{cn\(ACTION, !commands\.manage && "col-span-2"\)\} onClick=\{voirAgenda\}>\{t\("equipe\.voir_agenda"\)\}<\/Button>/);
});
