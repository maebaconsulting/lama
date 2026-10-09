import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** Envoi d'un produit par WhatsApp depuis les fiches (images des produits, spec du 04/10/2026, § 2). */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const envoi = read("./envoi-produit.tsx");
const cliente = read("../fiches/whatsapp-cliente.tsx");
const fiche = read("../fiches/fiche-produit.tsx");
const liste = read("../reglages/a-envoyer.tsx");

test("même envoi depuis les deux fiches : texte prérempli par le serveur, modifiable, puis POST ; réception et gérante seulement", () => {
  assert.match(envoi, /api<\{ text: string; image_version: number \| null \}>\("GET", `\/api\/products\/\$\{produit\}\/whatsapp\?client_id=\$\{cliente\}`\)/);
  assert.match(envoi, /await api\("POST", `\/api\/products\/\$\{produit\}\/whatsapp`, \{ client_id: cliente, text \}\);/);
  assert.match(envoi, /<Textarea id="envoi-produit-texte"/);
  assert.match(cliente, /<FenetreEnvoiProduit clientId=\{client\.id\} onClose=\{\(\) => setJoindre\(false\)\} \/>/);
  assert.match(fiche, /\{canSeeManual\(account\.role\) && \(/);
  assert.match(fiche, /<FenetreEnvoiProduit productId=\{product\.id\} onClose=\{\(\) => setEnvoi\(false\)\} \/>/);
});

test("refus du serveur (cliente sans numéro, numéro impossible) : raison affichée, nouveau choix possible sans fermer la fenêtre", () => {
  assert.match(envoi, /<Erreur message=\{error\} \/>/);
  assert.match(envoi, /onClick=\{changer\}>\{t\(productId === undefined \? "whatsapp\.changer_produit" : "whatsapp\.changer_cliente"\)\}<\/Button>/);
});

test("« À envoyer à la main » : photo téléchargée sous le nom du produit avant d'ouvrir WhatsApp ; jamais de bouton SMS pour un document ou une photo", () => {
  assert.match(liste, /else if \(manualAttachment\(item\) === "photo"\) await downloadPhoto\(item\.product!\);/);
  assert.match(liste, /photoFileName\(product\.name, blob\.type\)/);
  assert.match(liste, /\{manualAttachment\(item\) === null && item\.to && <Button/);
});

test("double appui sur « Envoyer » : garde posée de façon synchrone avant tout await, relâchée en fin d'envoi", () => {
  assert.match(envoi, /const sending = useRef\(false\);/);
  assert.match(envoi, /if \(sending\.current \|\| busy[^\n]*\) return;\n\s*sending\.current = true;\n\s*setError\(null\);/);
  assert.match(envoi, /finally \{\n\s*sending\.current = false;\n\s*setBusy\(false\);/);
});

test("aide de la fenêtre neutre (la ligne sous le texte dit si la photo part) ; erreur de recherche effacée à la frappe", () => {
  assert.doesNotMatch(read("../../i18n/fr.ts"), /part avec sa photo/);
  assert.match(envoi, /const q = search\.trim\(\);\n\s*setError\(null\);/);
});
