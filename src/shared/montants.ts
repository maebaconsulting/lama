/**
 * Montants de lama (spec du 15/10/2026, § 2) : entiers en unités mineures de
 * la devise active, écrits pour l'écran (symbole, ou rien s'il est masqué) ou
 * pour les documents (libellé ASCII toujours présent). Milliers à l'espace
 * fine insécable dans les deux langues ; décimales à la virgule en français,
 * au point en anglais. Aucune dépendance, testé sous Node.
 */
import { deviseActive } from "./devise-active.ts";

export type Langue = "fr" | "en";

const formats = new Map<number, Intl.NumberFormat>();
function format(decimales: number): Intl.NumberFormat {
  let f = formats.get(decimales);
  if (!f) {
    f = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
    formats.set(decimales, f);
  }
  return f;
}

export function separateurDecimal(lang: Langue): "," | "." {
  return lang === "en" ? "." : ",";
}

/** Nombre seul : `15 000` (XAF), `15 000,50` (EUR, fr), `15 000.50` (EUR, en). */
export function formatNombre(mineur: number, lang: Langue): string {
  const d = deviseActive();
  const unites = Math.round(Number(mineur) || 0) / 10 ** d.decimales;
  const texte = format(d.decimales).format(unites);
  return lang === "en" ? texte.replace(",", ".") : texte;
}

/** Entier sans devise (points de fidélité, quantités) : jamais de décimales. */
export function formatEntier(n: number): string {
  return format(0).format(Math.round(Number(n) || 0));
}

function avecUnite(mineur: number, lang: Langue, unite: string): string {
  const d = deviseActive();
  const signe = mineur < 0 ? "-" : "";
  const nombre = formatNombre(Math.abs(mineur), lang);
  return d.position === "avant" ? `${signe}${unite}\u00a0${nombre}` : `${signe}${nombre}\u00a0${unite}`;
}

/** Écran : `15 000 F`, `15,00 €`, `$ 15.50` ; le nombre seul si le symbole est masqué. */
export function formatMontantEcran(mineur: number, lang: Langue): string {
  const d = deviseActive();
  return d.symboleEcran ? avecUnite(mineur, lang, d.symbole) : formatNombre(mineur, lang);
}

/** Documents (ticket, avoir, reçu d'acompte, clôture, WhatsApp, journal) : libellé toujours présent. */
export function formatMontantDocument(mineur: number, lang: Langue): string {
  return avecUnite(mineur, lang, deviseActive().libelle);
}

/** Prix du catalogue (colonne `REAL`) en unités mineures entières, jamais négatif. */
export function entierMineur(price: number | null | undefined): number {
  const n = Math.round(Number(price) || 0);
  return n > 0 ? n : 0;
}

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Montant saisi, en unités mineures ; `null` si ce n'en est pas un (« abc »,
 * « -20 »), 0 pour un champ vide. Un séparateur (point, virgule, espace)
 * suivi d'exactement trois chiffres sépare les milliers ; un point ou une
 * virgule suivi d'autre chose marque les décimales : arrondies à l'unité pour
 * une devise sans centimes, refusées au-delà de deux pour les autres. Le
 * symbole ou le libellé de la devise active est toléré avant ou après le
 * nombre, et les formes du franc CFA (« F », « FCFA », « francs ») pour XAF et XOF.
 */
export function lireMontant(text: string): number | null {
  const d = deviseActive();
  const unites = [d.symbole, d.libelle, ...(d.code === "XAF" || d.code === "XOF" ? ["fcfa", "cfa", "francs", "franc", "f"] : [])]
    .sort((a, b) => b.length - a.length);
  let t = text.trim();
  for (const u of unites) {
    const e = echapper(u);
    t = t.replace(new RegExp(`^${e}\\s*(?=[\\d.,])`, "i"), "").replace(new RegExp(`([\\d.,])\\s*${e}$`, "i"), "$1");
  }
  let cleaned = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (/[.,\s]/.test(ch)) {
      let j = i + 1;
      while (j < t.length && /\d/.test(t[j])) j++;
      if (!/\s/.test(ch) && j - i - 1 !== 3) cleaned += ".";
    } else {
      cleaned += ch;
    }
  }
  if (cleaned === "") return 0;
  if (!/^(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  if (d.decimales === 0) return Math.round(Number(cleaned));
  const fraction = cleaned.split(".")[1] ?? "";
  if (fraction.length > d.decimales) return null;
  return Math.round(Number(cleaned) * 10 ** d.decimales);
}
