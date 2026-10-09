/**
 * Encres de la charte « Le carnet de rendez-vous ».
 * Toute couleur affichée pour un statut, une praticienne ou une prestation passe par ici.
 */
import type { Key } from "../i18n/translate.ts";

export const STATUS_INKS: Record<string, string> = {
  booked: "#5B6B7A",      // gris-bleu
  confirmed: "#3F5E4A",   // vert sapin
  in_progress: "#2E3A5C", // bleu nuit
  completed: "#161514",   // cuir
  cancelled: "#7A1F1F",   // encre rouge
  no_show: "#7A6556",     // brun taupe
};

export const STAFF_INKS: readonly { name: string; hex: string; labelKey: Key }[] = [
  { name: "ardoise", hex: "#4A5D73", labelKey: "encre.ardoise" },
  { name: "sauge", hex: "#4F6552", labelKey: "encre.sauge" },
  { name: "prune", hex: "#6B4660", labelKey: "encre.prune" },
  { name: "pétrole", hex: "#2F5D62", labelKey: "encre.petrole" },
  { name: "lilas", hex: "#6D6480", labelKey: "encre.lilas" },
  { name: "bouteille", hex: "#35544A", labelKey: "encre.bouteille" },
  { name: "rose", hex: "#8C5A6B", labelKey: "encre.rose" },
  { name: "anthracite", hex: "#4B4B4B", labelKey: "encre.anthracite" },
];

export const FALLBACK_INK = "#4B4B4B";
const STATUS_FALLBACK = "#6E6A64";
const HEX6 = /^#[0-9a-f]{6}$/i;

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste WCAG entre deux couleurs `#RRGGBB`. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/**
 * Mélange de deux couleurs `#RRGGBB` comme `color-mix(in srgb, a p%, b)`
 * (`weightA` = p / 100, entre 0 et 1) : sert au test des contrastes du thème sombre.
 */
export function mixSrgb(a: string, b: string, weightA: number): string {
  const [ca, cb] = [channels(a), channels(b)];
  return "#" + ca.map((v, i) => Math.round((v * weightA + cb[i] * (1 - weightA)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * Variable CSS d'une encre, lue par les classes `encre`, `encre-fond` et
 * `encre-lisere` (styles.css) qui l'éclaircissent en thème sombre.
 */
export function encreVars(hex: string): Record<string, string> {
  return { "--encre": hex };
}

/** Teinte (0-360) et saturation (0-1) HSL. */
function hueSat(hex: string): [number, number] {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return [0, 0];
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, d / (1 - Math.abs(2 * l - 1))];
}

const CHROMATIC = STAFF_INKS.filter(({ hex }) => hueSat(hex)[1] >= 0.08);

/**
 * Encre de la charte pour une couleur stockée (praticienne, prestation).
 * Une encre conforme est gardée ; une couleur vive est ramenée à l'encre de teinte la plus proche ;
 * un gris ou une valeur invalide donne l'anthracite.
 */
export function toInk(color: string | null | undefined): string {
  if (!color || !HEX6.test(color)) return FALLBACK_INK;
  const exact = STAFF_INKS.find(({ hex }) => hex.toLowerCase() === color.toLowerCase());
  if (exact) return exact.hex;
  const [hue, sat] = hueSat(color);
  if (sat < 0.08) return FALLBACK_INK;
  let best = FALLBACK_INK;
  let bestDistance = Infinity;
  for (const { hex } of CHROMATIC) {
    const raw = Math.abs(hueSat(hex)[0] - hue);
    const distance = Math.min(raw, 360 - raw);
    if (distance < bestDistance) { bestDistance = distance; best = hex; }
  }
  return best;
}

export function statusInk(status: string): string {
  return STATUS_INKS[status] ?? STATUS_FALLBACK;
}
