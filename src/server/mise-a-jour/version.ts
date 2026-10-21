import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Version publiée (spec du 21/10/2026, M-1) : X.Y.Z, sans zéro de tête, quatre chiffres au plus par nombre ; même règle que deploy/verification.sh. */
export const VERSION_PUBLIEE = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
/** Paquet de développement (`pnpm paquet`) : AAAAMMJJ-HHMM-empreinte du commit. */
export const VERSION_DEVELOPPEMENT = /^\d{8}-\d{4}-[0-9a-f]+$/;

/** Version en service : numéro, développement ou publiée, date d'installation (ms) si elle est connue. */
export type VersionInstallee = { numero: string; developpement: boolean; installee_le: number | null };

/** Vrai si `a` est strictement plus récente que `b`, toutes deux publiées ; une version de développement ne l'est jamais. */
export function plusRecente(a: string, b: string): boolean {
  const pa = VERSION_PUBLIEE.exec(a);
  const pb = VERSION_PUBLIEE.exec(b);
  if (!pa || !pb) return false;
  for (let i = 1; i <= 3; i++) {
    const ecart = Number(pa[i]) - Number(pb[i]);
    if (ecart !== 0) return ecart > 0;
  }
  return false;
}

/**
 * Version en service (M-2), lue au démarrage dans `VERSION` à la racine de la version (dossier de
 * travail de lama.service, /opt/lama/actuelle) ; date d'installation : date de ce dossier
 * (/opt/lama/versions/<version>, posé par cp -R). Sans `VERSION` lisible (développement) : la
 * version de package.json, marquée développement, sans date.
 */
export function lireVersionInstallee(racine: string): VersionInstallee {
  let installee_le: number | null = null;
  try {
    installee_le = Math.round(statSync(racine).mtimeMs);
  } catch {
    installee_le = null;
  }
  try {
    const lue = readFileSync(join(racine, "VERSION"), "utf8").trim();
    if (VERSION_PUBLIEE.test(lue)) return { numero: lue, developpement: false, installee_le };
    if (VERSION_DEVELOPPEMENT.test(lue)) return { numero: lue, developpement: true, installee_le };
  } catch {
    // Pas de fichier VERSION : lama tourne depuis le dépôt (développement).
  }
  let paquet = "0.0.0";
  try {
    const v = (JSON.parse(readFileSync(join(racine, "package.json"), "utf8")) as { version?: unknown }).version;
    if (typeof v === "string" && VERSION_PUBLIEE.test(v)) paquet = v;
  } catch {
    paquet = "0.0.0";
  }
  return { numero: paquet, developpement: true, installee_le: null };
}
