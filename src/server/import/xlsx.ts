/**
 * Lecture des classeurs Excel (.xlsx) pour les imports : la première feuille du classeur devient des
 * enregistrements, comme ceux d'un CSV, puis suit exactement le même chemin (`tableauDepuis`). Un .xlsx
 * est une archive zip de fichiers XML (Office Open XML) : seuls le classeur, ses liens, les textes
 * partagés, les styles et les feuilles sont décompressés, chacun borné, pour qu'une archive piégée ne
 * remplisse pas la mémoire (fflate n'écrit jamais au-delà de la taille déclarée).
 *
 * Valeurs rendues sous la forme qu'attendent les imports : nombres sans séparateur ni décimales parasites
 * (15000, pas 15000.000000000002), dates en AAAA-MM-JJ, heures en HH:MM, cases vrai/faux en oui/non.
 */
import { unzipSync } from "fflate";
import { IMPORT_MAX_OCTETS } from "../../shared/import.ts";
import { MAX_ENREGISTREMENTS, type Motif } from "./csv.ts";

/** Taille décompressée déclarée au plus, par fichier et pour l'ensemble du classeur. */
export const XLSX_MAX_FICHIER = 40 * 1024 * 1024;
const XLSX_MAX_TOTAL = 80 * 1024 * 1024;
/** Colonnes lues au plus : les modèles en ont une quinzaine. */
export const XLSX_MAX_COLONNES = 200;
/** Caractères d'une cellule au plus : la limite d'Excel lui-même. */
export const XLSX_MAX_CELLULE = 32_767;
/**
 * Caractères décodés au plus pour toute la feuille. Un texte partagé n'est écrit qu'une fois dans le
 * fichier mais peut être cité par chaque cellule : sans ce total, un classeur de quelques Ko donnerait des
 * millions de caractères, recopiés ensuite par chaque contrôle des lignes.
 */
export const XLSX_MAX_TEXTE = 4 * IMPORT_MAX_OCTETS;

/** Vrai pour une archive zip (signature `PK\x03\x04`) : un .xlsx, ou un autre fichier zippé que la lecture refusera. */
export function estZip(octets: Uint8Array): boolean {
  return octets.length >= 4 && octets[0] === 0x50 && octets[1] === 0x4b && octets[2] === 0x03 && octets[3] === 0x04;
}

/** Vrai pour un ancien classeur Excel 97-2003 (.xls, conteneur OLE `D0 CF 11 E0`). */
export function estXlsAncien(octets: Uint8Array): boolean {
  return octets.length >= 4 && octets[0] === 0xd0 && octets[1] === 0xcf && octets[2] === 0x11 && octets[3] === 0xe0;
}

type Resultat = { ok: true; enregistrements: string[][] } | { ok: false; erreur: Motif };
const illisible = (): Resultat => ({ ok: false, erreur: { motif: "import.xlsx_illisible" } });

/** Élément lu : texte de ses attributs, contenu, et position de l'élément entier dans le texte (`debut` inclus, `fin` exclue). */
interface Element { attributs: string; contenu: string; debut: number; fin: number }

/**
 * Éléments `nom` d'un texte XML (préfixe d'espace de noms toléré : `c` ou `x:c`), dans l'ordre, avec le
 * texte de leurs attributs et leur contenu. Parcours linéaire par `indexOf` : une balise non fermée arrête
 * la lecture au lieu de faire relire le reste du fichier à chaque balise (temps quadratique d'une
 * expression régulière paresseuse sur une feuille piégée de plusieurs dizaines de Mo).
 */
function* elements(xml: string, nom: string): Generator<Element> {
  const ouvrante = new RegExp(`<((?:[A-Za-z_][\\w.-]*:)?${nom})(?=[\\s/>])`, "g");
  for (let m = ouvrante.exec(xml); m; m = ouvrante.exec(xml)) {
    const finBalise = xml.indexOf(">", m.index);
    if (finBalise < 0) return;
    const attributs = xml.slice(m.index + m[0].length, finBalise);
    if (attributs.endsWith("/")) {
      yield { attributs: attributs.slice(0, -1), contenu: "", debut: m.index, fin: finBalise + 1 };
      ouvrante.lastIndex = finBalise + 1;
      continue;
    }
    const fermante = `</${m[1]}>`;
    const fin = xml.indexOf(fermante, finBalise + 1);
    if (fin < 0) return;
    yield { attributs, contenu: xml.slice(finBalise + 1, fin), debut: m.index, fin: fin + fermante.length };
    ouvrante.lastIndex = fin + fermante.length;
  }
}

const premier = (xml: string, nom: string): Element | undefined => elements(xml, nom).next().value ?? undefined;

/** Valeur d'un attribut dans le texte d'une balise ouvrante ; préfixe d'espace de noms toléré (`r:id`). */
function attribut(attributs: string, nom: string): string | null {
  const m = new RegExp(`(?:^|\\s)(?:[A-Za-z_][\\w.-]*:)?${nom}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attributs);
  return m ? decoderXml(m[1] ?? m[2]) : null;
}

/** Entités XML et échappements `_xHHHH_` d'Office (retour chariot, caractères de contrôle). */
export function decoderXml(s: string): string {
  return s
    .replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e as "amp"];
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** Texte d'un élément `<si>` ou `<is>` : ses `<t>`, mis bout à bout (texte enrichi), sans la phonétique `<rPh>`. */
function texteRiche(xml: string): string {
  let texte = "";
  // Les `<t>` de la phonétique sont dans `<rPh>` ; ceux du texte, directement dans l'élément ou dans ses `<r>`.
  let sansPhonetique = "";
  let suite = 0;
  for (const e of elements(xml, "rPh")) {
    sansPhonetique += xml.slice(suite, e.debut);
    suite = e.fin;
  }
  sansPhonetique += xml.slice(suite);
  for (const t of elements(sansPhonetique, "t")) texte += decoderXml(t.contenu);
  return texte;
}

/** Textes partagés du classeur, dans l'ordre de leurs numéros. */
function textesPartages(xml: string | undefined): string[] {
  if (!xml) return [];
  const textes: string[] = [];
  for (const si of elements(xml, "si")) textes.push(texteRiche(si.contenu));
  return textes;
}

/** Formats intégrés d'Excel qui affichent une date ou une heure. */
const FORMATS_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** Vrai si un format personnalisé affiche une date ou une heure : d, m, y, h ou s (codes anglais, quelle que soit la langue d'Excel) hors texte entre guillemets, échappements et crochets ([Red], [$-40C]). */
export function formatEstDate(code: string): boolean {
  if (/\[(h+|m+|s+)\]/i.test(code)) return true;
  const nu = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[[^\]]*\]/g, "");
  return /[dmyhs]/i.test(nu.replace(/General/gi, ""));
}

/** Pour chaque style de cellule (`s`), vrai si son format affiche une date ou une heure. */
function stylesDate(xml: string | undefined): boolean[] {
  if (!xml) return [];
  const personnalises = new Map<number, string>();
  for (const f of elements(xml, "numFmt")) {
    const id = Number(attribut(f.attributs, "numFmtId"));
    const code = attribut(f.attributs, "formatCode");
    if (Number.isInteger(id) && code !== null) personnalises.set(id, code);
  }
  const bloc = premier(xml, "cellXfs");
  if (!bloc) return [];
  const dates: boolean[] = [];
  for (const xf of elements(bloc.contenu, "xf")) {
    const id = Number(attribut(xf.attributs, "numFmtId") ?? "0");
    const code = personnalises.get(id);
    dates.push(code !== undefined ? formatEstDate(code) : FORMATS_DATE.has(id));
  }
  return dates;
}

const deux = (n: number) => String(n).padStart(2, "0");

/**
 * Date ou heure d'un numéro de série Excel : AAAA-MM-JJ, HH:MM (secondes si présentes), ou les deux.
 * Calendrier de 1900 (avec le faux 29 février 1900 d'Excel) ou de 1904 (anciens classeurs Mac).
 */
export function dateDeSerie(serie: number, depuis1904: boolean): string {
  const jours = Math.floor(serie);
  let secondes = Math.round((serie - jours) * 86_400);
  let j = jours;
  if (secondes === 86_400) { j++; secondes = 0; }
  const heure = secondes === 0 ? "" : `${deux(Math.floor(secondes / 3600))}:${deux(Math.floor(secondes / 60) % 60)}${secondes % 60 ? `:${deux(secondes % 60)}` : ""}`;
  if (j === 0 && !depuis1904) return heure || "00:00";
  const origine = depuis1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, j >= 60 ? 30 : 31);
  const d = new Date(origine + j * 86_400_000);
  const jour = `${d.getUTCFullYear()}-${deux(d.getUTCMonth() + 1)}-${deux(d.getUTCDate())}`;
  return heure ? `${jour} ${heure}` : jour;
}

/** Date ISO d'une cellule de type `d` (2026-11-26T10:00:00) : AAAA-MM-JJ, suivie de HH:MM si l'heure n'est pas minuit. */
export function dateIso(v: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v.trim());
  if (!m) return v;
  const [, jour, h = "00", min = "00", s = "00"] = m;
  if (h === "00" && min === "00" && s === "00") return jour;
  return `${jour} ${h}:${min}${s === "00" ? "" : `:${s}`}`;
}

/** Nombre écrit sans les décimales parasites du binaire (0.1 + 0.2), sans notation exponentielle pour les entiers usuels. */
export function nombre(v: string): string {
  const n = Number(v);
  if (v.trim() === "" || !Number.isFinite(n)) return v;
  return String(Number(n.toPrecision(15)));
}

/** Numéro de colonne (0 pour A) d'une référence de cellule (`B3`) ; `null` si elle n'en porte pas. */
function colonneDe(ref: string | null): number | null {
  const m = ref === null ? null : /^([A-Z]{1,3})\d*$/i.exec(ref);
  if (!m) return null;
  let n = 0;
  for (const c of m[1].toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Chemin, dans l'archive, de la première feuille du classeur (ordre des onglets), d'après ses liens. */
function cheminPremiereFeuille(classeur: string, liens: string | undefined): string | null {
  const feuille = premier(classeur, "sheet");
  const id = feuille ? attribut(feuille.attributs, "id") : null;
  if (!id || !liens) return null;
  for (const lien of elements(liens, "Relationship")) {
    if (attribut(lien.attributs, "Id") !== id) continue;
    const cible = attribut(lien.attributs, "Target");
    if (!cible) return null;
    return cible.startsWith("/") ? cible.slice(1) : `xl/${cible.replace(/^\.\//, "")}`;
  }
  return null;
}

const UTILES = /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/;

/**
 * Enregistrements de la première feuille d'un classeur .xlsx : une ligne du tableur par enregistrement
 * (lignes vides gardées, pour que les numéros cités soient ceux du tableur), chaque ligne complétée de
 * cellules vides jusqu'à la largeur de la première ligne (une cellule vide n'existe pas dans le fichier).
 */
export function lireXlsx(octets: Uint8Array): Resultat {
  let fichiers: Record<string, Uint8Array>;
  let total = 0;
  let tropGros = false;
  try {
    fichiers = unzipSync(octets, {
      filter: (f) => {
        if (!UTILES.test(f.name)) return false;
        total += f.originalSize;
        if (f.originalSize > XLSX_MAX_FICHIER || total > XLSX_MAX_TOTAL) tropGros = true;
        return !tropGros;
      },
    });
  } catch {
    return illisible();
  }
  if (tropGros) return { ok: false, erreur: { motif: "import.xlsx_trop_gros" } };
  const texte = (nom: string) => (fichiers[nom] ? new TextDecoder("utf-8").decode(fichiers[nom]) : undefined);
  const classeur = texte("xl/workbook.xml");
  if (!classeur) return illisible();
  const chemin = cheminPremiereFeuille(classeur, texte("xl/_rels/workbook.xml.rels")) ?? "xl/worksheets/sheet1.xml";
  const feuille = texte(chemin);
  if (feuille === undefined) return illisible();
  const pr = premier(classeur, "workbookPr");
  const depuis1904 = pr !== undefined && ["1", "true"].includes(attribut(pr.attributs, "date1904") ?? "");
  const partages = textesPartages(texte("xl/sharedStrings.xml"));
  const dates = stylesDate(texte("xl/styles.xml"));

  const lignes: string[][] = [];
  let numeroLigne = 0;
  let texteTotal = 0;
  for (const ligne of elements(feuille, "row")) {
    const r = Number(attribut(ligne.attributs, "r"));
    numeroLigne = Number.isInteger(r) && r > numeroLigne ? r : numeroLigne + 1;
    if (numeroLigne > MAX_ENREGISTREMENTS) return { ok: false, erreur: { motif: "import.trop_de_lignes" } };
    const cellules: string[] = [];
    let colonne = -1;
    for (const c of elements(ligne.contenu, "c")) {
      colonne = colonneDe(attribut(c.attributs, "r")) ?? colonne + 1;
      const type = attribut(c.attributs, "t") ?? "n";
      const brute = premier(c.contenu, "v")?.contenu;
      let valeur: string;
      if (type === "inlineStr") valeur = texteRiche(premier(c.contenu, "is")?.contenu ?? "");
      else if (brute === undefined) continue;
      else if (type === "s") valeur = partages[Number(brute)] ?? "";
      else if (type === "b") valeur = brute.trim() === "1" ? "oui" : "non";
      else if (type === "str" || type === "e") valeur = decoderXml(brute);
      else if (type === "d") valeur = dateIso(decoderXml(brute));
      else {
        const s = Number(attribut(c.attributs, "s") ?? "0");
        const n = Number(brute);
        valeur = dates[s] && Number.isFinite(n) && n >= 0 ? dateDeSerie(n, depuis1904) : nombre(decoderXml(brute));
      }
      if (valeur === "") continue;
      if (valeur.length > XLSX_MAX_CELLULE) return { ok: false, erreur: { motif: "import.xlsx_cellule", valeurs: { ligne: numeroLigne, max: "32\u00a0767" } } };
      texteTotal += valeur.length;
      if (texteTotal > XLSX_MAX_TEXTE) return { ok: false, erreur: { motif: "import.xlsx_trop_gros" } };
      if (colonne >= XLSX_MAX_COLONNES) return { ok: false, erreur: { motif: "import.xlsx_colonnes", valeurs: { max: XLSX_MAX_COLONNES } } };
      while (cellules.length < colonne) cellules.push("");
      cellules[colonne] = valeur;
    }
    while (lignes.length < numeroLigne - 1) lignes.push([]);
    lignes.push(cellules);
  }
  const largeur = lignes[0]?.length ?? 0;
  for (const l of lignes) while (l.length < largeur) l.push("");
  return { ok: true, enregistrements: lignes };
}
