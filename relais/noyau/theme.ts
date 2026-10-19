/**
 * Thème d'un salon (contrat v1, ajout du 18/10/2026, spec § 9.3) : couleurs de fond et d'accent, police,
 * rapports de contraste (WCAG 2.1) et palette de la page. Module pur. La même règle est écrite côté lama
 * (src/shared/en-ligne.ts), et un essai de lama vérifie que les deux s'accordent couleur par couleur.
 */
export const POLICES = ["lama", "classique", "elegante", "moderne"] as const;
export type Police = (typeof POLICES)[number];
export type Theme = { fond: string; accent: string; police: Police };

export const COULEUR = /^#[0-9A-Fa-f]{6}$/;
/** Texte sur le fond, et accent (boutons, choix) sur le fond. */
export const CONTRASTE_TEXTE = 4.5;
export const CONTRASTE_ACCENT = 3;

const NOIR = "#000000";
const BLANC = "#FFFFFF";

function rvb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lineaire(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative d'une couleur `#RRGGBB`. */
export function luminance(hex: string): number {
  const [r, v, b] = rvb(hex);
  return 0.2126 * lineaire(r) + 0.7152 * lineaire(v) + 0.0722 * lineaire(b);
}

/** Rapport de contraste de deux couleurs, de 1 à 21. */
export function contraste(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Couleur du texte sur `fond` : noir ou blanc, la plus contrastée. */
export function texteSur(fond: string): string {
  return contraste(NOIR, fond) >= contraste(BLANC, fond) ? NOIR : BLANC;
}

export type ProblemeTheme = "couleur" | "police" | "contraste_texte" | "contraste_accent";

/** Premier défaut d'un thème, ou `null` s'il est acceptable. */
export function problemeTheme(t: { fond?: unknown; accent?: unknown; police?: unknown }): ProblemeTheme | null {
  if (typeof t.fond !== "string" || !COULEUR.test(t.fond) || typeof t.accent !== "string" || !COULEUR.test(t.accent)) return "couleur";
  if (typeof t.police !== "string" || !(POLICES as readonly string[]).includes(t.police)) return "police";
  if (contraste(texteSur(t.fond), t.fond) < CONTRASTE_TEXTE) return "contraste_texte";
  if (contraste(t.accent, t.fond) < CONTRASTE_ACCENT) return "contraste_accent";
  return null;
}

/** `a` mêlée de `part` (0 à 1) de `b`, en `#RRGGBB` majuscules. */
export function melange(a: string, b: string, part: number): string {
  const x = rvb(a);
  const y = rvb(b);
  return `#${x.map((c, i) => Math.round(c + (y[i] - c) * part).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export type Palette = { fond: string; texte: string; accent: string; surAccent: string; papier: string; grise: string; filet: string; rouge: string; vert: string };

/** Encres d'erreur et de confirmation : celle de la charte si elle reste lisible (4,5:1 sur le fond et les cartes), une plus claire sinon, à défaut le texte. */
const ROUGES = ["#7A1F1F", "#E0877D"];
const VERTS = ["#3F5E4A", "#9CC5A8"];
const lisible = (choix: string[], fond: string, papier: string, repli: string) =>
  choix.find((c) => contraste(c, fond) >= CONTRASTE_TEXTE && contraste(c, papier) >= CONTRASTE_TEXTE) ?? repli;

/**
 * Couleurs de la page : texte déduit du fond, cartes un peu plus claires que le fond, texte discret
 * (le plus estompé qui tienne 4,5:1 sur le fond et sur les cartes, sinon le texte lui-même), filets, encres
 * d'erreur et de confirmation lisibles (sur un fond sombre, l'encre rouge de la charte ne se lirait plus).
 */
export function palette(t: Theme): Palette {
  const fond = t.fond.toUpperCase();
  const texte = texteSur(fond);
  const clair = texte === NOIR;
  const papier = melange(fond, BLANC, clair ? 0.55 : 0.08);
  let grise = texte;
  for (const part of [0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1]) {
    const essai = melange(texte, fond, part);
    if (contraste(essai, fond) >= CONTRASTE_TEXTE && contraste(essai, papier) >= CONTRASTE_TEXTE) {
      grise = essai;
      break;
    }
  }
  return {
    fond, texte, accent: t.accent.toUpperCase(), surAccent: texteSur(t.accent), papier, grise, filet: melange(fond, texte, 0.18),
    rouge: lisible(ROUGES, fond, papier, texte), vert: lisible(VERTS, fond, papier, texte),
  };
}

/** Règle CSS du thème : variables lues par relais/public/styles.css. */
export function styleTheme(t: Theme): string {
  const p = palette(t);
  return `:root{--fond:${p.fond};--texte:${p.texte};--accent:${p.accent};--sur-accent:${p.surAccent};--papier:${p.papier};--encre-grise:${p.grise};--filet:${p.filet};--encre-rouge:${p.rouge};--vert-confirme:${p.vert};color-scheme:${p.texte === NOIR ? "light" : "dark"}}`;
}

/**
 * Page d'un salon à ses couleurs et à sa police, posées par le serveur avant tout script (aucune page ne
 * s'affiche d'abord dans la charte de lama). Sans thème, la page telle quelle. Les couleurs sont déjà validées
 * (`#RRGGBB`) et la police est un nom de la liste : rien d'autre n'entre dans la page.
 */
export function pageAvecTheme(html: string, t: Theme | null | undefined): string {
  if (!t) return html;
  return html
    .replace(/<html\b([^>]*)>/, `<html$1 data-police="${t.police}">`)
    .replace(/(<meta name="theme-color" content=")#[0-9A-Fa-f]{6}(")/, `$1${t.fond.toUpperCase()}$2`)
    .replace("</head>", `<style id="theme-salon">${styleTheme(t)}</style></head>`);
}
