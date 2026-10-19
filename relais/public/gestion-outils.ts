import { MOTIF_ORIGINE } from "../noyau/motifs.ts";
import { tg, type CleGestion } from "./gestion-textes.ts";
import type { Lang } from "./textes.ts";

/** Logique pure des écrans de gestion. */

/** Au-delà, lama devrait avoir rappelé le relais (échanges chaque minute) : la liaison est dite silencieuse. */
const SILENCE_MIN = 5;

/** Origines saisies une par ligne : vides ignorées, doublons retirés, invalides mises à part. */
export function lireOrigines(texte: string): { origines: string[]; invalides: string[] } {
  const lignes = [...new Set(texte.split("\n").map((l) => l.trim()).filter(Boolean))];
  return { origines: lignes.filter((l) => MOTIF_ORIGINE.test(l)), invalides: lignes.filter((l) => !MOTIF_ORIGINE.test(l)) };
}

export function etatLiaison(dernier: number | null, maintenant: number): { cle: CleGestion; duree: number } {
  if (dernier === null) return { cle: "liaison.jamais", duree: 0 };
  const minutes = Math.floor((maintenant - dernier) / 60_000);
  return { cle: minutes > SILENCE_MIN ? "liaison.silencieuse" : "liaison.recente", duree: minutes };
}

export function duree(minutes: number, lang: Lang): string {
  if (minutes < 1) return tg(lang, "duree.instant");
  if (minutes < 60) return tg(lang, "duree.minutes", { n: minutes });
  if (minutes < 24 * 60) return tg(lang, "duree.heures", { n: Math.floor(minutes / 60) });
  return tg(lang, "duree.jours", { n: Math.floor(minutes / (24 * 60)) });
}

export function adressePage(origine: string, salon: string): string {
  return `${origine}/${salon}/`;
}

export function codeIntegration(origine: string, salon: string): string {
  return `<script src="${origine}/integrer.js" data-salon="${salon}" async></script>`;
}

/** Instant (millisecondes) lisible dans le fuseau du navigateur\u00a0: « 17/10/2026 à 14:32 » ou « 10/17/2026 at 14:32 ». */
export function dateHeure(instant: number, lang: Lang): string {
  const d = new Date(instant);
  const deux = (n: number) => String(n).padStart(2, "0");
  const heure = `${deux(d.getHours())}:${deux(d.getMinutes())}`;
  return lang === "fr"
    ? `${deux(d.getDate())}/${deux(d.getMonth() + 1)}/${d.getFullYear()} à ${heure}`
    : `${deux(d.getMonth() + 1)}/${deux(d.getDate())}/${d.getFullYear()} at ${heure}`;
}
