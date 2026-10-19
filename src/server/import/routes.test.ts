import assert from "node:assert/strict";
import { test } from "node:test";
import { avecDemoPublique, setupApp } from "../test-support.ts";
import { fichierRefuse } from "../formation/protections-demo.ts";
import { IMPORT_MAX_OCTETS } from "../../shared/import.ts";

const CLIENTES = "nom;telephone;langue;anniversaire;preferences;whatsapp;notes";
const csv = (texte: string) => Buffer.from(texte, "utf8");

async function setup(t: { after: (fn: () => void) => void }) {
  const ctx = await setupApp(t, { demo: false });
  const gerante = await ctx.as("manager");
  const compte = (ctx.db.prepare("SELECT id FROM accounts WHERE login = 'manager'").get() as { id: number }).id;
  const n = (sql: string) => (ctx.db.prepare(sql).get() as { n: number }).n;
  return { ...ctx, gerante, compte, n };
}

test("droits : gérante et administrateur seulement ; réception et praticienne refusées", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  for (const [role, attendu] of [["manager", 200], ["admin", 200], ["reception", 403], ["practitioner", 403]] as const) {
    const appel = await ctx.as(role);
    assert.equal((await appel("GET", "/api/import/clientes/modele")).status, attendu, role);
    assert.equal((await appel("POST", "/api/import/clientes/apercu", csv(`${CLIENTES}\nAwa;699000001;;;;;\n`))).status, attendu, role);
  }
});

test("modèle : CSV UTF-8 avec BOM, en pièce jointe ; type inconnu 404", async (t) => {
  const { gerante } = await setup(t);
  const r = await gerante("GET", "/api/import/produits/modele");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /^text\/csv; charset=utf-8/);
  assert.match(r.headers.get("content-disposition") ?? "", /attachment; filename="modele-produits\.csv"/);
  assert.deepEqual([...r.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(r.bytes.toString("utf8"), /;XAF\r\n$/);
  assert.equal((await gerante("GET", "/api/import/factures/modele")).status, 404);
});

test("aperçu : compteurs et lignes refusées en clair, rien n'est écrit", async (t) => {
  const { gerante, n } = await setup(t);
  const r = await gerante("POST", "/api/import/clientes/apercu", csv(`${CLIENTES}\nAwa;699000001;;;;;\nBella;12;;;;;\nAwa bis;+237699000001;;;;;\n`), { "accept-language": "fr" });
  assert.equal(r.status, 200);
  assert.equal(r.body.lignes, 3);
  assert.equal(r.body.ajouts, 1);
  assert.equal(r.body.refusees_total, 2);
  assert.equal(r.body.doublons, 1);
  assert.deepEqual(r.body.refusees, [
    { ligne: 3, motif: "Téléphone invalide.", doublon: false },
    { ligne: 4, motif: "Même téléphone qu'une ligne précédente.", doublon: true },
  ]);
  assert.equal(r.body.importable, false);
  assert.equal(n("SELECT COUNT(*) AS n FROM clients"), 0);
});

test("import refusé tant qu'une ligne est refusée : 422, rien d'écrit, rien au journal", async (t) => {
  const { gerante, n } = await setup(t);
  const r = await gerante("POST", "/api/import/clientes", csv(`${CLIENTES}\nAwa;699000001;;;;;\nBella;12;;;;;\n`), { "accept-language": "fr" });
  assert.equal(r.status, 422);
  assert.match(r.body.error, /rien n'a été écrit/);
  assert.equal(r.body.apercu.refusees_total, 1);
  assert.equal(n("SELECT COUNT(*) AS n FROM clients"), 0);
  assert.equal(n("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'import.%'"), 0);
});

test("import : tout est écrit, bilan rendu, une ligne au journal avec le compte", async (t) => {
  const { gerante, n, db, compte } = await setup(t);
  const r = await gerante("POST", "/api/import/clientes", csv(`${CLIENTES}\nAwa;699000001;;;;;\nBella;677000002;en;;;non;\n`));
  assert.equal(r.status, 200);
  assert.equal(r.body.ajouts, 2);
  assert.equal(n("SELECT COUNT(*) AS n FROM clients"), 2);
  const journal = db.prepare("SELECT account_id, target FROM audit_log WHERE action = 'import.clientes'").all().map((l) => ({ ...l }));
  assert.deepEqual(journal, [{ account_id: compte, target: "2 lignes, 2 ajouts, 0 mises à jour" }]);
});

test("tout ou rien : une erreur pendant l'écriture annule toute la transaction", async (t) => {
  const { gerante, n, db } = await setup(t);
  // Un déclencheur fait échouer la seconde insertion : la première doit être annulée avec elle.
  db.exec("CREATE TRIGGER essai_refus BEFORE INSERT ON clients WHEN NEW.name = 'Bella' BEGIN SELECT RAISE(ABORT, 'essai'); END");
  const r = await gerante("POST", "/api/import/clientes", csv(`${CLIENTES}\nAwa;699000001;;;;;\nBella;677000002;;;;;\n`));
  assert.ok(r.status >= 500, String(r.status));
  assert.equal(n("SELECT COUNT(*) AS n FROM clients"), 0);
});

test("fichier qui n'est pas en UTF-8, trop lourd, en-tête faux : 400 avec le message", async (t) => {
  const { gerante } = await setup(t);
  const latin1 = Buffer.concat([csv(`${CLIENTES}\nH`), Buffer.from([0xe9]), csv("lène;699000001;;;;;\n")]);
  const encodage = await gerante("POST", "/api/import/clientes/apercu", latin1, { "accept-language": "fr" });
  assert.equal(encodage.status, 400);
  assert.match(encodage.body.error, /CSV UTF-8/);
  const lourd = await gerante("POST", "/api/import/clientes/apercu", Buffer.alloc(IMPORT_MAX_OCTETS + 1, 0x41), { "accept-language": "fr" });
  assert.equal(lourd.status, 400);
  assert.match(lourd.body.error, /5\u00a0Mo/);
  const tropLourd = await gerante("POST", "/api/import/clientes/apercu", Buffer.alloc(IMPORT_MAX_OCTETS + 2, 0x41));
  assert.equal(tropLourd.status, 413);
  const entete = await gerante("POST", "/api/import/clientes/apercu", csv("nom;age\nAwa;30\n"), { "accept-language": "fr" });
  assert.equal(entete.status, 400);
  assert.match(entete.body.error, /Colonne inconnue/);
});

test("garde de la devise : produits sans colonne devise refusés dans une base en euros", async (t) => {
  const { gerante, db, n } = await setup(t);
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('institut.devise', ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify("EUR"));
  const r = await gerante("POST", "/api/import/produits", csv("nom;prix\nCrème;1500\n"), { "accept-language": "fr" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /XAF et la devise de l'institut est EUR/);
  assert.equal(n("SELECT COUNT(*) AS n FROM products"), 0);
  const ok = await gerante("POST", "/api/import/produits", csv("nom;prix;devise\nCrème;1500;EUR\n"));
  assert.equal(ok.status, 200);
  assert.equal(n("SELECT COUNT(*) AS n FROM products WHERE price = 1500"), 1);
});

test("produits : chaque stock changé inscrit au journal, ancienne et nouvelle valeur", async (t) => {
  const { gerante, db } = await setup(t);
  db.prepare("INSERT INTO products (name, sku, price, stock) VALUES ('Huile de coco', 'HC-1', 4000, 12)").run();
  const r = await gerante("POST", "/api/import/produits", csv("nom;reference;prix;stock\nHuile de coco;HC-1;4000;8\n"));
  assert.equal(r.status, 200);
  assert.equal(r.body.stocks_changes, 1, "le bilan compte les stocks changés");
  assert.deepEqual(db.prepare("SELECT action, target FROM audit_log WHERE action IN ('import.produits', 'produit.stock') ORDER BY id").all().map((l) => ({ ...l })), [
    { action: "import.produits", target: "1 lignes, 0 ajouts, 1 mises à jour" },
    { action: "produit.stock", target: "Huile de coco\u00a0: 12 → 8" },
  ]);
});

test("catalogue : case « désactiver les absentes », journal du catalogue", async (t) => {
  const { gerante, db } = await setup(t);
  db.prepare("INSERT INTO services (name, category, duration, price) VALUES ('Ancien soin', 'Visage', 60, 1000)").run();
  const fichier = csv("categorie;categorie_en;groupe;groupe_en;nom;nom_en;duree_min;prix;prix_max;couleur;remarque;remarque_en\nVisage;;;;Soin hydratant;;60;15000;;#4A5D73;;\n");
  const apercu = await gerante("POST", "/api/import/catalogue/apercu?desactiver=1", fichier);
  assert.deepEqual([apercu.body.ajouts, apercu.body.desactivees], [1, 1]);
  assert.equal((await gerante("POST", "/api/import/catalogue?desactiver=1", fichier)).status, 200);
  assert.equal((db.prepare("SELECT active FROM services WHERE name = 'Ancien soin'").get() as { active: number }).active, 0);
  assert.equal(db.prepare("SELECT target FROM audit_log WHERE action = 'catalogue.import'").all().length, 1);
});

test("rendez-vous : import relancé sans rien doubler ; aucun message en file", async (t) => {
  const { gerante, db, n } = await setup(t);
  db.prepare("INSERT INTO staff (id, name, email, title, color) VALUES (1, 'Awa', '', '', '#4A5D73')").run();
  db.prepare("INSERT INTO services (id, name, category, duration, price) VALUES (1, 'Soin hydratant', 'Visage', 60, 15000)").run();
  const fichier = csv("date;heure;telephone;nom_cliente;prestation;praticienne;notes\n2026-10-05;10:00;699000001;Awa Cliente;Soin hydratant;Awa;\n");
  const premier = await gerante("POST", "/api/import/rendez-vous", fichier);
  assert.equal(premier.status, 200);
  assert.deepEqual([premier.body.ajouts, premier.body.clientes_creees], [1, 1]);
  const second = await gerante("POST", "/api/import/rendez-vous", fichier, { "accept-language": "fr" });
  assert.equal(second.status, 422);
  assert.equal(second.body.apercu.doublons, 1);
  assert.equal(n("SELECT COUNT(*) AS n FROM appointments"), 1);
  assert.equal(n("SELECT COUNT(*) AS n FROM outbox"), 0);
});

test("démonstration publique : aperçu et import refusés, modèle permis", () => {
  assert.equal(fichierRefuse("POST", "/api/import/clientes"), true);
  assert.equal(fichierRefuse("POST", "/api/import/clientes/apercu"), true);
  assert.equal(fichierRefuse("GET", "/api/import/clientes/modele"), false);
});

test("5 Mo accordés seulement à une requête qui porte un cookie de session, hors démonstration publique ; sinon 64 Kio", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const moyen = Buffer.alloc(100 * 1024, 0x41);
  const gerante = await ctx.as("manager");
  assert.equal((await ctx.anonymous()("POST", "/api/import/clientes/apercu", moyen)).status, 413, "sans session, le corps est borné avant l'authentification");
  assert.equal((await ctx.anonymous()("POST", "/api/import/clientes/apercu", moyen, { cookie: "lama_session=faux" })).status, 401, "cookie présent : lu, puis refusé par l'authentification");
  assert.equal((await gerante("POST", "/api/import/clientes/apercu", moyen)).status, 400, "session : 5 Mo permis, la route juge le fichier");
  await avecDemoPublique(true, async () => {
    const demo = await setupApp(t, { demo: true });
    const appel = await demo.as("manager");
    assert.equal((await appel("POST", "/api/import/clientes/apercu", moyen)).status, 413, "démonstration publique : limite habituelle");
  });
});

test("modèle déposé tel quel : la ligne d'exemple est refusée, rien n'est écrit", async (t) => {
  const { gerante, n } = await setup(t);
  for (const type of ["catalogue", "clientes", "produits"] as const) {
    const modele = await gerante("GET", `/api/import/${type}/modele`);
    const r = await gerante("POST", `/api/import/${type}`, modele.bytes, { "accept-language": "fr" });
    assert.equal(r.status, 422, type);
    assert.deepEqual(r.body.apercu.refusees, [{ ligne: 2, motif: "Ligne d'exemple du modèle, à supprimer.", doublon: false }], type);
  }
  assert.equal(n("SELECT COUNT(*) AS n FROM clients"), 0);
  assert.equal(n("SELECT COUNT(*) AS n FROM products"), 0);
  assert.equal(n("SELECT COUNT(*) AS n FROM services"), 0);
});

test("catalogue : suppléments reconnus à l'aperçu ; nom introuvable refusé en clair, « Importer » refusé, rien d'écrit", async (t) => {
  const { gerante, db, n } = await setup(t);
  db.prepare("INSERT INTO products (name, price) VALUES ('Perles', 500)").run();
  const entete = "categorie;categorie_en;groupe;groupe_en;nom;nom_en;duree_min;prix;prix_max;couleur;remarque;remarque_en;supplement_seulement;supplements_possibles";
  const refuse = csv(`${entete}\nCoiffure;;;;Nattes;;60;15000;;#4A5D73;;;non;Paillettes\n`);
  const apercu = await gerante("POST", "/api/import/catalogue/apercu", refuse, { "accept-language": "fr" });
  assert.equal(apercu.status, 200);
  assert.deepEqual(apercu.body.refusees, [{ ligne: 2, motif: "supplément introuvable\u00a0: «\u00a0Paillettes\u00a0» (ni prestation ni produit de ce nom).", doublon: false }]);
  assert.equal(apercu.body.importable, false);
  assert.equal((await gerante("POST", "/api/import/catalogue", refuse)).status, 422);
  assert.equal(n("SELECT COUNT(*) AS n FROM services"), 0);
  const bon = csv(`${entete}\nCoiffure;;;;Nattes;;60;15000;;#4A5D73;;;non;Perles|Mèches\nCoiffure;;;;Mèches;;0;5000;;#4A5D73;;;oui;\n`);
  const ok = await gerante("POST", "/api/import/catalogue/apercu", bon);
  assert.deepEqual([ok.body.ajouts, ok.body.refusees_total, ok.body.avertissements_total, ok.body.importable], [2, 0, 0, true]);
  assert.equal(n("SELECT COUNT(*) AS n FROM services"), 0, "aperçu : rien d'écrit");
  assert.equal((await gerante("POST", "/api/import/catalogue", bon)).status, 200);
  assert.equal(n("SELECT COUNT(*) AS n FROM service_supplements"), 2);
  const cascade = await gerante("POST", "/api/import/catalogue/apercu", csv(`${entete}\nCoiffure;;;;Chignon;;60;15000;;#4A5D73;;;non;Nattes\n`), { "accept-language": "fr" });
  assert.deepEqual(cascade.body.refusees, [{ ligne: 2, motif: "«\u00a0Nattes\u00a0» a ses propres suppléments\u00a0: un supplément n'en a pas lui-même.", doublon: false }]);
});
