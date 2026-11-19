/**
 * Classeur .xlsx d'essai, écrit comme Excel l'enregistre : textes dans les textes partagés, nombres en
 * valeurs, dates en numéros de série avec le format de date intégré (14), cellules vides absentes.
 * Sert seulement aux essais des imports.
 */
import { strToU8, zipSync } from "fflate";

export type CelluleEssai = string | number | { date: number } | null;

const echapper = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const lettre = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : lettre(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

export function classeurEssai(lignes: CelluleEssai[][]): Uint8Array {
  const partages: string[] = [];
  const indice = (s: string) => {
    const i = partages.indexOf(s);
    return i >= 0 ? i : partages.push(s) - 1;
  };
  const rangs = lignes.map((ligne, r) => {
    const cellules = ligne.map((v, c) => {
      const ref = `${lettre(c)}${r + 1}`;
      if (v === null || v === "") return "";
      if (typeof v === "string") return `<c r="${ref}" t="s"><v>${indice(v)}</v></c>`;
      if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" s="1"><v>${v.date}</v></c>`;
    });
    return `<row r="${r + 1}">${cellules.join("")}</row>`;
  });
  return zipSync({
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "xl/workbook.xml": strToU8(`<workbook ${NS}><sheets><sheet name="Feuil1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/styles.xml": strToU8(`<styleSheet ${NS}><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`),
    "xl/sharedStrings.xml": strToU8(`<sst ${NS}>${partages.map((s) => `<si><t xml:space="preserve">${echapper(s)}</t></si>`).join("")}</sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet ${NS}><sheetData>${rangs.join("")}</sheetData></worksheet>`),
  });
}
