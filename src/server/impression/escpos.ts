/**
 * Ticket en ESC/POS (impression directe, spec § 2) : les rangées de
 * `ticketRows` (les mêmes que le PDF) deviennent les octets envoyés à une
 * imprimante thermique de 80 mm (48 colonnes en police A), table de
 * caractères CP858. Module pur, sans réseau : même ticket, mêmes octets.
 */
import type { TicketRow, TicketStyle } from "../caisse/ticket.ts";
import type { PrintImage } from "./image-logo.ts";

/** Colonnes d'une ligne de 80 mm en police A (12 × 24 points, 576 points de large). */
export const COLUMNS = 48;

const ESC = 0x1b;
const GS = 0x1d;
/** Table de caractères 19 : CP858 (CP850 avec « € »), vérifiée sur l'imprimante de l'institut. */
const CODE_PAGE = 19;

/** Caractères de 0x80 à 0xFF en CP858, dans l'ordre. */
const CP858_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈ€ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00ad±\u2017¾¶§÷¸°¨·¹³²■\u00a0";
const CP858 = new Map<string, number>([...CP858_HIGH].map((ch, i) => [ch, 0x80 + i]));

/** Remplacements avant l'encodage : ce que CP858 n'a pas, écrit avec ce qu'il a. */
const SUBSTITUTES: Record<string, string> = {
  "\u0153": "oe", "\u0152": "OE", "\u00a0": " ", "\u202f": " ", "\u2212": "-", "\u2013": "-", "\u2014": "-",
  "\u2018": "'", "\u2019": "'", "\u201c": "\"", "\u201d": "\"", "\u2026": "...",
};

/** Texte prêt à encoder : remplacements, puis lettre de base pour un accent inconnu, sinon « ? ». */
export function toCp858Text(text: string): string {
  let out = "";
  for (const ch of text) {
    const sub = SUBSTITUTES[ch];
    if (sub !== undefined) { out += sub; continue; }
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x20 && cp < 0x7f) || ch === "\n" || CP858.has(ch)) { out += ch; continue; }
    const base = [...ch.normalize("NFD")].filter((c) => { const p = c.codePointAt(0)!; return (p >= 0x20 && p < 0x7f) || CP858.has(c); }).join("");
    out += base || "?";
  }
  return out;
}

/** Octets CP858 d'un texte déjà passé par `toCp858Text`. */
function encode(text: string): number[] {
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    bytes.push(cp < 0x80 ? cp : CP858.get(ch) ?? 0x3f);
  }
  return bytes;
}

/** Texte lisible d'octets CP858 (essais et journal) : chaque octet sous 0x80 tel quel, les autres par la table. */
export function decodeCp858(bytes: Uint8Array): string {
  return [...bytes].map((b) => (b < 0x80 ? String.fromCharCode(b) : [...CP858_HIGH][b - 0x80])).join("");
}

/** Découpe un texte en lignes de `width` colonnes au plus, aux espaces quand c'est possible. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      let w = word;
      while ([...w].length > width) {
        if (line) { lines.push(line); line = ""; }
        lines.push([...w].slice(0, width).join(""));
        w = [...w].slice(width).join("");
      }
      const candidate = line ? `${line} ${w}` : w;
      if ([...candidate].length <= width) line = candidate;
      else { lines.push(line); line = w; }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Libellé et montant sur `width` colonnes : le montant, jamais coupé, à
 * droite de la première ligne ; un libellé trop long continue en dessous.
 */
export function pairLines(left: string, right: string, width: number): string[] {
  const r = [...right].length;
  // Texte de droite aussi large que la ligne : jamais d'erreur, il passe seul sous le libellé.
  if (r >= width) return [...wrap(left, width), [...right].slice(0, width).join("")];
  const room = Math.max(1, width - r - 1);
  const parts = wrap(left, room);
  const first = parts[0] ?? "";
  return [`${first}${" ".repeat(width - [...first].length - r)}${right}`, ...parts.slice(1)];
}

/** Mode d'impression (`ESC !`) de chaque style : gras (0x08), double hauteur (0x10). */
const MODES: Record<TicketStyle, number> = {
  nom: 0x18, total: 0x18, titre: 0x08, numero: 0x08,
  entete: 0x00, corps: 0x00, detail: 0x00, mention: 0x00, merci: 0x00,
};

/** Image raster (`GS v 0`, mode normal) : largeur en octets, hauteur en points, petit-boutiste. */
export function rasterBytes(img: PrintImage): number[] {
  const bytesWide = img.width / 8;
  return [GS, 0x76, 0x30, 0x00, bytesWide & 0xff, bytesWide >> 8, img.height & 0xff, img.height >> 8, ...img.bits];
}

/**
 * Octets ESC/POS d'un ticket : initialisation, table CP858, rangées, avance
 * et coupe. `duplicate` : libellé imprimé en gras et centré sous le titre
 * (« DUPLICATA »), pour une réimpression. `logo` : image de l'institut,
 * imprimée centrée là où la rangée `logo` se trouve (rien sans image).
 */
export function ticketBytes(rows: TicketRow[], options: { duplicate?: string; logo?: PrintImage | null } = {}): Buffer {
  const out: number[] = [ESC, 0x40, ESC, 0x74, CODE_PAGE];
  let mode = -1;
  let align = -1;
  const setMode = (m: number) => { if (m !== mode) { out.push(ESC, 0x21, m); mode = m; } };
  const setAlign = (a: number) => { if (a !== align) { out.push(ESC, 0x61, a); align = a; } };
  const line = (text: string) => out.push(...encode(text), 0x0a);
  let duplicateDone = !options.duplicate;
  for (const row of rows) {
    if (row.type === "rule") {
      setMode(0);
      setAlign(0);
      line("-".repeat(COLUMNS));
      continue;
    }
    if (row.type === "logo") {
      // Logo de l'institut (vague B) : image tramée, centrée, puis retour à la ligne ; sans image, rien.
      if (!options.logo) continue;
      setMode(0);
      setAlign(1);
      out.push(...rasterBytes(options.logo), 0x0a);
      continue;
    }
    setMode(MODES[row.style]);
    if (row.type === "pair") {
      setAlign(0);
      for (const l of pairLines(toCp858Text(row.left), toCp858Text(row.right), COLUMNS)) line(l);
      continue;
    }
    setAlign(row.align === "center" ? 1 : 0);
    for (const l of wrap(toCp858Text(row.text), COLUMNS)) line(l);
    if (!duplicateDone && row.style === "titre") {
      setMode(0x08);
      setAlign(1);
      line(toCp858Text(options.duplicate!));
      duplicateDone = true;
    }
  }
  setMode(0);
  setAlign(0);
  // Avance pour que la dernière ligne dépasse la lame, puis coupe partielle avec avance (`GS V 66 0`).
  out.push(0x0a, 0x0a, 0x0a, GS, 0x56, 0x42, 0x00);
  return Buffer.from(out);
}

/** Impulsion d'ouverture du tiroir-caisse (`ESC p 0 25 250`) : broche 2, 50 ms puis 500 ms. */
export const OPEN_DRAWER = Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]);
