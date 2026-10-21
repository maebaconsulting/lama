/**
 * Règles partagées de la réservation en ligne (spec du 16/10/2026 § 4.6 et § 9.3), pour le serveur et
 * l'écran de lama : thème (contraste WCAG 2.1, palette de la page), identifiant du salon, adresse du relais,
 * page du salon, code d'intégration, texte d'accord par défaut. Le thème est la copie exacte de
 * relais/noyau/theme.ts (lama n'importe rien du relais) : src/shared/en-ligne.test.ts vérifie l'accord.
 */
export const POLICES = ["lama", "classique", "elegante", "moderne"] as const;
export type Police = (typeof POLICES)[number];
export type ThemeEnLigne = { fond: string; accent: string; police: Police };

/** Mise en page de la page du salon (ajout du 19/10/2026) : en-tête (logo et nom) affiché ou non, colonne centrée ou toute la largeur. */
export const LARGEURS = ["colonne", "pleine"] as const;
export type AffichageEnLigne = { entete: boolean; largeur: (typeof LARGEURS)[number] };
export const AFFICHAGE_DEFAUT: AffichageEnLigne = { entete: true, largeur: "colonne" };

export const COULEUR = /^#[0-9A-Fa-f]{6}$/;
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

/** Couleurs de la page du salon (même calcul que le relais) : texte déduit du fond, cartes, texte discret à 4,5:1, filets. */
export function palette(t: ThemeEnLigne): Palette {
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

/** Identifiant d'un salon sur le relais (copie de relais/noyau/motifs.ts). */
export const MOTIF_SALON = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

/** Adresse du relais : https, ou http sur la machine même (essais en local), sans identifiants ; vide tant qu'elle n'est pas réglée. */
export function adresseRelaisValide(v: unknown): boolean {
  if (typeof v !== "string") return false;
  if (v === "") return true;
  if (v.length > 200) return false;
  try {
    const u = new URL(v);
    const locale = u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
    // Jamais de nom d'utilisateur ni de mot de passe : l'adresse est montrée, copiée dans le code d'intégration et le QR code.
    return (u.protocol === "https:" || locale) && u.username === "" && u.password === "" && !v.includes("@")
      && u.search === "" && u.hash === "" && !v.includes("?") && !v.includes("#");
  } catch {
    return false;
  }
}

/** Adresse sans barre finale. */
export function adresseSansBarre(adresse: string): string {
  return adresse.replace(/\/+$/, "");
}

/** Page de réservation du salon sur le relais, ou `null` tant que l'adresse ou le salon manque. */
export function pageSalon(adresse: string, salon: string): string | null {
  return adresse && salon ? `${adresseSansBarre(adresse)}/${salon}/` : null;
}

/** Code d'intégration dans une page du site de l'institut (relais/LISEZMOI.md), ou `null`. */
export function codeIntegration(adresse: string, salon: string): string | null {
  // `&`, guillemets, `<` et `>` sont échappés pour que l'extrait ne soit jamais cassé, quelle que soit l'adresse gardée.
  const attribut = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return adresse && salon ? `<script src="${attribut(adresseSansBarre(adresse))}/integrer.js" data-salon="${attribut(salon)}" async></script>` : null;
}

/** Texte d'accord sur l'usage des données, par défaut (réglable par la gérante). */
export const TEXTE_DONNEES = {
  fr: "Vos coordonnées servent seulement à traiter votre demande de rendez-vous et à vous répondre. Elles ne sont jamais transmises à des tiers.",
  en: "Your details are only used to handle your appointment request and to reply to you. They are never shared with third parties.",
};
