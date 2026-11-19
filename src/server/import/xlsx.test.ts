import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { lireFichier } from "./fichier.ts";
import { dateDeSerie, dateIso, decoderXml, estZip, formatEstDate, lireXlsx, nombre, XLSX_MAX_CELLULE, XLSX_MAX_COLONNES, XLSX_MAX_FICHIER, XLSX_MAX_TEXTE } from "./xlsx.ts";

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

interface Classeur {
  feuilles?: { nom: string; xml: string }[];
  partages?: string[];
  styles?: string;
  date1904?: boolean;
}

/** Classeur .xlsx minimal, construit comme Excel l'écrit : classeur, liens, textes partagés, styles, feuilles. */
function classeur({ feuilles = [], partages, styles, date1904 }: Classeur): Uint8Array {
  const fichiers: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook ${NS}>${date1904 ? '<workbookPr date1904="1"/>' : ""}<sheets>${feuilles.map((f, i) => `<sheet name="${f.nom}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${feuilles.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`),
  };
  feuilles.forEach((f, i) => { fichiers[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet ${NS}><sheetData>${f.xml}</sheetData></worksheet>`); });
  if (partages) fichiers["xl/sharedStrings.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><sst ${NS} count="${partages.length}">${partages.join("")}</sst>`);
  if (styles) fichiers["xl/styles.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><styleSheet ${NS}>${styles}</styleSheet>`);
  return zipSync(fichiers);
}

const lire = (c: Classeur) => {
  const r = lireXlsx(classeur(c));
  assert.ok(r.ok, JSON.stringify(r));
  return r.enregistrements;
};

/** Styles : 0 général, 1 date intégrée (14), 2 heure intégrée (20), 3 date personnalisée, 4 montant « FCFA » (pas une date). */
const STYLES = '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy;@"/><numFmt numFmtId="165" formatCode="#,##0 &quot;FCFA&quot;"/></numFmts>'
  + '<cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="20"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs>';

test("signature : un .xlsx est reconnu à son contenu zip, pas à son nom", () => {
  assert.ok(estZip(classeur({ feuilles: [{ nom: "A", xml: "" }] })));
  assert.ok(!estZip(new TextEncoder().encode("nom;telephone\n")));
});

test("textes partagés, texte en ligne, formule, nombre, case vrai/faux et cellules vides absentes du fichier", () => {
  const partages = ["<si><t>nom</t></si>", "<si><t>prix</t></si>", "<si><t>actif</t></si>", '<si><r><t>Soin </t></r><r><rPr><b/></rPr><t xml:space="preserve">éclat &amp; «\u00a0lumière\u00a0»</t></r><rPh><t>ソ</t></rPh></si>'];
  const lignes = lire({
    partages,
    feuilles: [{ nom: "Catalogue", xml:
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>15000</v></c><c r="C2" t="b"><v>1</v></c></row>'
      + '<row r="3"><c r="A3" t="inlineStr"><is><t>Brushing</t></is></c><c r="B3" t="str"><f>B2/2</f><v>7500</v></c><c r="C3" t="b"><v>0</v></c></row>'
      + '<row r="4"><c r="B4"><v>0.30000000000000004</v></c></row>' }],
  });
  assert.deepEqual(lignes, [
    ["nom", "prix", "actif"],
    ["Soin éclat & «\u00a0lumière\u00a0»", "15000", "oui"],
    ["Brushing", "7500", "non"],
    ["", "0.3", ""],
  ]);
});

test("lignes et colonnes sautées : les numéros restent ceux du tableur, la ligne est complétée à la largeur de l'en-tête", () => {
  const lignes = lire({
    feuilles: [{ nom: "A", xml:
      '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="B1" t="inlineStr"><is><t>b</t></is></c><c r="C1" t="inlineStr"><is><t>c</t></is></c></row>'
      + '<row r="4" spans="1:3"><c r="C4" t="inlineStr"><is><t>z</t></is></c><c r="D4" s="0"/></row>' }],
  });
  assert.deepEqual(lignes, [["a", "b", "c"], ["", "", ""], ["", "", ""], ["", "", "z"]]);
});

test("dates et heures : selon le format de la cellule, en AAAA-MM-JJ et HH:MM ; un montant « FCFA » reste un nombre", () => {
  const lignes = lire({
    styles: STYLES,
    feuilles: [{ nom: "A", xml: '<row r="1"><c r="A1" s="1"><v>46352</v></c><c r="B1" s="2"><v>0.4166666666666667</v></c><c r="C1" s="3"><v>46352.5</v></c><c r="D1" s="4"><v>25000</v></c><c r="E1" s="0"><v>46352</v></c></row>' }],
  });
  assert.deepEqual(lignes, [["2026-11-26", "10:00", "2026-11-26 12:00", "25000", "46352"]]);
});

test("numéros de série : calendrier de 1900 (faux 29 février d'Excel) et de 1904 ; secondes gardées, minuit arrondi", () => {
  assert.equal(dateDeSerie(1, false), "1900-01-01");
  assert.equal(dateDeSerie(59, false), "1900-02-28");
  assert.equal(dateDeSerie(61, false), "1900-03-01");
  assert.equal(dateDeSerie(45658, false), "2025-01-01");
  assert.equal(dateDeSerie(0, true), "1904-01-01");
  assert.equal(dateDeSerie(44196, true), "2025-01-01");
  assert.equal(dateDeSerie(0.5208449074074074, false), "12:30:01");
  assert.equal(dateDeSerie(46351.99999999, false), "2026-11-26");
  assert.deepEqual(lire({ date1904: true, styles: STYLES, feuilles: [{ nom: "A", xml: '<row r="1"><c r="A1" s="1"><v>44196</v></c></row>' }] }), [["2025-01-01"]]);
});

test("formats : codes de date et d'heure reconnus, texte entre guillemets, couleurs et monnaies ignorés", () => {
  for (const code of ["dd/mm/yyyy", "d-mmm-yy", "hh:mm", "[h]:mm:ss", "[$-40C]dddd d mmmm yyyy", "yyyy-mm-dd;@"]) assert.ok(formatEstDate(code), code);
  for (const code of ["General", "0.00", '#,##0 "FCFA"', "[Red]#,##0", "@", '0" jours"', "0.00E+00"]) assert.ok(!formatEstDate(code), code);
});

test("cellule de type date ISO, nombres sans décimales parasites, entités et échappements d'Office", () => {
  assert.equal(dateIso("2026-11-26T00:00:00"), "2026-11-26");
  assert.equal(dateIso("2026-11-26T10:00:00Z"), "2026-11-26 10:00");
  assert.equal(nombre("15000.000000000002"), "15000");
  assert.equal(nombre("237699000000"), "237699000000");
  assert.equal(nombre("abc"), "abc");
  assert.equal(decoderXml("a&lt;b&gt;&quot;c&apos;&#233;&#xE8;_x000D_"), "a<b>\"c'éè\r");
});

test("première feuille dans l'ordre des onglets, même si son fichier ne s'appelle pas sheet1 ; préfixes d'espace de noms tolérés", () => {
  const z = zipSync({
    "xl/workbook.xml": strToU8(`<x:workbook ${NS.replace('xmlns="', 'xmlns:x="')}><x:sheets><x:sheet name="Liste" sheetId="2" r:id="rId7"/><x:sheet name="Autre" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId7" Target="/xl/worksheets/liste.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>mauvaise</t></is></c></row></sheetData></worksheet>'),
    "xl/worksheets/liste.xml": strToU8('<x:worksheet><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>bonne</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>'),
  });
  assert.deepEqual(lireXlsx(z), { ok: true, enregistrements: [["bonne"]] });
});

test("refus : archive sans classeur (.ods, .docx), archive abîmée, classeur trop large, archive qui gonfle au-delà du plafond", () => {
  assert.deepEqual(lireXlsx(zipSync({ "content.xml": strToU8("<office/>") })), { ok: false, erreur: { motif: "import.xlsx_illisible" } });
  const abime = classeur({ feuilles: [{ nom: "A", xml: "" }] }).slice(0, 60);
  assert.deepEqual(lireXlsx(abime), { ok: false, erreur: { motif: "import.xlsx_illisible" } });
  const large = lireXlsx(classeur({ feuilles: [{ nom: "A", xml: `<row r="1"><c r="A1"><v>1</v></c><c r="${"HA"}1"><v>2</v></c></row>` }] }));
  assert.deepEqual(large, { ok: false, erreur: { motif: "import.xlsx_colonnes", valeurs: { max: XLSX_MAX_COLONNES } } });
  const gonfle = zipSync({ "xl/workbook.xml": strToU8("<workbook/>"), "xl/worksheets/sheet1.xml": new Uint8Array(XLSX_MAX_FICHIER + 1) });
  assert.deepEqual(lireXlsx(gonfle), { ok: false, erreur: { motif: "import.xlsx_trop_gros" } });
});

test("fichier d'import : .xlsx et CSV aboutissent au même tableau ; ancien .xls et CSV Windows-1252 refusés avec leur motif", () => {
  const COLS = { obligatoires: ["nom", "telephone"], facultatives: ["notes"] } as const;
  const xlsx = lireFichier(classeur({ feuilles: [{ nom: "A", xml:
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Nom</t></is></c><c r="B1" t="inlineStr"><is><t>Téléphone</t></is></c><c r="C1" t="inlineStr"><is><t>notes</t></is></c></row>'
    + '<row r="2"><c r="A2" t="inlineStr"><is><t>Awa</t></is></c><c r="B2"><v>699000000</v></c></row>' }] }), COLS);
  const csv = lireFichier(new TextEncoder().encode("﻿nom;telephone;notes\r\nAwa;699000000;\r\n"), COLS);
  assert.ok(xlsx.ok && csv.ok);
  assert.deepEqual(xlsx.tableau, csv.tableau);
  assert.deepEqual(lireFichier(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), COLS), { ok: false, erreur: { motif: "import.xls" } });
  assert.deepEqual(lireFichier(new Uint8Array([0x6e, 0x6f, 0x6d, 0xe9]), COLS), { ok: false, erreur: { motif: "import.encodage" } });
});

test("phonétique retirée par sa position : un texte identique hors de la phonétique est gardé", () => {
  const lignes = lire({
    partages: ["<si><t>Soin </t><rPh sb=\"0\" eb=\"1\"><t>Soin </t></rPh><t>doux</t></si>"],
    feuilles: [{ nom: "A", xml: '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' }],
  });
  assert.deepEqual(lignes, [["Soin doux"]]);
});

test("feuille piégée de balises jamais fermées : lecture arrêtée tout de suite, pas de temps quadratique", () => {
  const piege = "<row r=\"1\"><c r=\"A1\"><v>1</v></c></row>" + "<row><c><v>".repeat(400_000);
  const debut = performance.now();
  const r = lireXlsx(classeur({ feuilles: [{ nom: "A", xml: piege }] }));
  assert.ok(performance.now() - debut < 3000, `${Math.round(performance.now() - debut)} ms`);
  assert.deepEqual(r, { ok: true, enregistrements: [["1"]] });
});

test("plafonds du texte décodé : cellule de plus de 32 767 caractères refusée ; texte partagé répété au-delà du total refusé", () => {
  const longue = lireXlsx(classeur({ feuilles: [{ nom: "A", xml: `<row r="1"><c r="A1" t="inlineStr"><is><t>${"a".repeat(XLSX_MAX_CELLULE + 1)}</t></is></c></row>` }] }));
  assert.deepEqual(longue, { ok: false, erreur: { motif: "import.xlsx_cellule", valeurs: { ligne: 1, max: "32\u00a0767" } } });
  // Un seul texte partagé de 30 000 caractères, cité par 1 000 cellules : 30 millions de caractères pour un fichier minuscule.
  const cellules = Array.from({ length: 1000 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="s"><v>0</v></c></row>`).join("");
  const gonfle = lireXlsx(classeur({ partages: [`<si><t>${"b".repeat(30_000)}</t></si>`], feuilles: [{ nom: "A", xml: cellules }] }));
  assert.deepEqual(gonfle, { ok: false, erreur: { motif: "import.xlsx_trop_gros" } });
  assert.ok(XLSX_MAX_TEXTE < 30_000_000);
});
