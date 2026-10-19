import assert from "node:assert/strict";
import { test } from "node:test";
import { initDB, run } from "@clawnify/db";
import { PNG } from "pngjs";
import { Offre } from "../../../relais/noyau/contrat.ts";
import { SEMAINE_DEFAUT } from "../../shared/horaires.ts";
import { saveLogo, deleteLogo } from "../institut/logos.ts";
import { MessageError } from "../messages.ts";
import { sqliteStorage } from "../storage.ts";
import { baseEssai, CONFIG_ESSAI } from "./essais-en-ligne.ts";
import { construireOffre, deIdentifiant, empreinte, LOGO_HAUTEUR, LOGO_LARGEUR, LOGO_MAX_OCTETS, logoPourOffre, offreVide, reduireLogo } from "./offre.ts";

test("offre : seules les prestations et praticiennes ouvertes en ligne, conforme au contrat du relais", () => {
  const o = construireOffre(baseEssai(), CONFIG_ESSAI, null);
  assert.deepEqual(o.prestations.map((p) => p.id), ["s2", "s1"], "par catégorie puis par nom");
  assert.deepEqual(o.prestations[1], { id: "s1", nom: { fr: "Soin visage", en: "Facial" }, categorie: { fr: "Visage", en: "Face" }, description: { fr: "", en: "" }, duree: 60, prix: 25000 });
  assert.deepEqual(o.praticiennes, [
    { id: "p1", prenom: "Awa", photo: null, prestations: ["s1", "s2"] },
    { id: "p2", prenom: "Bella", photo: null, prestations: ["s1"] },
  ]);
  assert.equal(o.institut.telephone, "+237699000000");
  assert.equal(o.institut.fuseau, "Africa/Douala");
  assert.deepEqual(o.institut.devise, { code: "XAF", decimales: 0, symbole: "F", position: "apres" });
  assert.deepEqual(o.institut.horaires, SEMAINE_DEFAUT);
  assert.equal("theme" in o.institut, false, "sans thème : charte de lama");
  const r = Offre.safeParse({ version: 1, ...o });
  assert.ok(r.success, JSON.stringify(r.error?.issues));
});

test("offre : praticienne sans prestation ouverte, prestation que personne ne pratique, prix nul et catégorie vide", () => {
  const db = baseEssai();
  db.exec("DELETE FROM staff_services WHERE service_id = 2");
  db.exec("UPDATE services SET category = '', category_en = '' WHERE id = 1");
  db.exec("INSERT INTO services (id, name, duration, price, en_ligne) VALUES (4, 'Essai gratuit', 30, 0, 1)");
  const o = construireOffre(db, CONFIG_ESSAI, null);
  assert.deepEqual(o.prestations.map((p) => p.id), ["s1"], "s2 n'est plus pratiquée, s4 n'a pas de prix");
  assert.deepEqual(o.prestations[0].categorie, { fr: "Prestations", en: "Services" });
  db.exec("UPDATE staff SET active = 0 WHERE id IN (1, 2)");
  assert.deepEqual(construireOffre(db, CONFIG_ESSAI, null).prestations, [], "plus personne en ligne : rien à réserver");
});

test("offre : thème publié tel quel ; nom de l'institut vide refusé avant toute publication", () => {
  const theme = { fond: "#F3EDE3", accent: "#141312", police: "elegante" as const };
  assert.deepEqual(construireOffre(baseEssai(), { ...CONFIG_ESSAI, theme }, null).institut.theme, theme);
  assert.throws(() => construireOffre(baseEssai(), { ...CONFIG_ESSAI, institut: { ...CONFIG_ESSAI.institut, nom: "" } }, null), (e: unknown) => e instanceof MessageError && e.key === "en_ligne.nom_manquant");
  const vide = offreVide(CONFIG_ESSAI, null);
  assert.deepEqual([vide.prestations, vide.praticiennes], [[], []]);
  assert.ok(Offre.safeParse({ version: 2, ...vide }).success);
});

/** PNG de bruit, impossible à compresser (octets de poids fort du générateur : les bits de poids faible se répètent vite). */
function bruit(largeur: number, hauteur: number): Buffer {
  const png = new PNG({ width: largeur, height: hauteur });
  let g = 1;
  for (let i = 0; i < png.data.length; i++) {
    g = (g * 1103515245 + 12345) % 2 ** 31;
    png.data[i] = (g >>> 16) & 255;
  }
  return PNG.sync.write(png);
}

test("logo réduit : un logo de plusieurs mégaoctets tient sous 200 ko et l'offre sous 1 Mo", () => {
  const brut = bruit(900, 900);
  assert.ok(brut.length > 1024 * 1024, "logo lourd au départ");
  const logo = reduireLogo(brut, "image/png");
  assert.ok(logo?.startsWith("data:image/png;base64,"));
  const octets = Buffer.from(logo!.slice(logo!.indexOf(",") + 1), "base64");
  assert.ok(octets.length <= LOGO_MAX_OCTETS, `${octets.length} octets`);
  const lu = PNG.sync.read(octets);
  assert.ok(lu.width <= LOGO_LARGEUR && lu.height <= LOGO_HAUTEUR);
  const o = { version: 1, ...construireOffre(baseEssai(), CONFIG_ESSAI, logo) };
  assert.ok(Offre.safeParse(o).success, "accepté par le contrat (200 ko au plus)");
  assert.ok(Buffer.byteLength(JSON.stringify(o)) <= 1024 * 1024);
  assert.equal(reduireLogo(Buffer.from("pas une image"), "image/png"), null);
  const petit = PNG.sync.read(Buffer.from(reduireLogo(bruit(100, 40), "image/png")!.split(",")[1], "base64"));
  assert.deepEqual([petit.width, petit.height], [100, 40], "jamais agrandi");
});

test("empreinte stable, qui change avec l'offre ; identifiants du contrat lus", () => {
  const db = baseEssai();
  const a = construireOffre(db, CONFIG_ESSAI, null);
  assert.equal(empreinte(a), empreinte(structuredClone(a)));
  db.exec("UPDATE services SET price = 26000 WHERE id = 1");
  assert.notEqual(empreinte(construireOffre(db, CONFIG_ESSAI, null)), empreinte(a));
  assert.equal(deIdentifiant("s12", "s"), 12);
  assert.equal(deIdentifiant("p3", "p"), 3);
  for (const ref of ["p3", "s0", "x1", "s12a", ""]) assert.equal(deIdentifiant(ref, "s"), null, ref);
});

test("invariant : un logo de 320 × 128 points, même non compressé, tient sous la limite du contrat", () => {
  // Garde de `reduireLogo` (renvoie null si trop lourd) pratiquement inatteignable : 163 840 octets bruts au plus.
  assert.ok(LOGO_LARGEUR * LOGO_HAUTEUR * 4 < LOGO_MAX_OCTETS);
});

test("logo de l'offre : variante choisie selon le thème, repli, mémoire invalidée par les versions", async () => {
  const db = baseEssai();
  initDB({ STORAGE: sqliteStorage(db) });
  const dimensions = (logo: string | null) => {
    assert.ok(logo?.startsWith("data:image/png;base64,"));
    const octets = Buffer.from(logo.slice(logo.indexOf(",") + 1), "base64");
    assert.ok(octets.length <= LOGO_MAX_OCTETS);
    const png = PNG.sync.read(octets);
    return [png.width, png.height];
  };
  const clair = { fond: "#F3EDE3", accent: "#141312", police: "lama" as const };
  const sombre = { fond: "#141312", accent: "#F3EDE3", police: "lama" as const };
  const lourd = bruit(900, 900);
  const petit = bruit(100, 40);
  assert.equal(await logoPourOffre(null), null, "aucun logo");
  await saveLogo("clair", "image/png", lourd, null, 1);
  assert.deepEqual(dimensions(await logoPourOffre(null)), [128, 128], "logo lourd réduit");
  assert.deepEqual(dimensions(await logoPourOffre(sombre)), [128, 128], "fond sombre sans logo sombre : repli sur le clair");
  await saveLogo("sombre", "image/png", petit, null, 2);
  assert.deepEqual(dimensions(await logoPourOffre(sombre)), [100, 40], "fond sombre : logo sombre");
  assert.deepEqual(dimensions(await logoPourOffre(clair)), [128, 128], "fond clair : logo clair");
  assert.deepEqual(dimensions(await logoPourOffre(null)), [128, 128], "sans thème : logo clair");
  assert.deepEqual(dimensions(await logoPourOffre(sombre)), [100, 40]);
  // Mêmes versions : pas de nouvelle réduction (octets changés sous la main, résultat inchangé).
  await run("UPDATE institut_logos SET octets = ? WHERE variante = 'sombre'", [bruit(50, 20)]);
  assert.deepEqual(dimensions(await logoPourOffre(sombre)), [100, 40], "résultat mémorisé");
  await saveLogo("sombre", "image/png", bruit(50, 20), null, 3);
  assert.deepEqual(dimensions(await logoPourOffre(sombre)), [50, 20], "nouvelle version : nouvelle réduction");
  // Première variante illisible : repli sur l'autre.
  await saveLogo("sombre", "image/png", Buffer.from("pas une image"), null, 4);
  assert.deepEqual(dimensions(await logoPourOffre(sombre)), [128, 128], "sombre illisible : repli sur le clair");
  // Le null est mémorisé aussi : aucun logo lisible tant que les versions ne bougent pas.
  await saveLogo("clair", "image/png", Buffer.from("pas une image"), null, 5);
  assert.equal(await logoPourOffre(sombre), null);
  await run("UPDATE institut_logos SET octets = ? WHERE variante = 'clair'", [petit]);
  assert.equal(await logoPourOffre(sombre), null, "null mémorisé");
  await saveLogo("clair", "image/png", petit, null, 6);
  assert.deepEqual(dimensions(await logoPourOffre(sombre)), [100, 40], "nouvelle version du clair");
  await deleteLogo("clair");
  await deleteLogo("sombre");
  assert.equal(await logoPourOffre(null), null, "logos retirés");
});
