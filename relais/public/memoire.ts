import type { Lang } from "./textes.ts";

/** Coordonnées gardées sur le téléphone, à la demande de la cliente (spec § 3). Jamais indispensables. */
export type Coordonnees = { prenom: string; nom: string; telephone: string; langue: Lang };
export type Stockage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const CLE = "lama-relais-coordonnees";

function stockageNavigateur(): Stockage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function lireCoordonnees(stockage: Stockage | null = stockageNavigateur()): Coordonnees | null {
  try {
    const v = JSON.parse(stockage?.getItem(CLE) ?? "null") as Partial<Coordonnees> | null;
    if (v && typeof v.nom === "string" && typeof v.telephone === "string" && (v.langue === "fr" || v.langue === "en")) {
      // Mémoire d'avant le 18/10/2026 : un seul champ « Nom et prénom », impossible à couper sans deviner ; la cliente les retape.
      if (typeof v.prenom !== "string") return { prenom: "", nom: "", telephone: v.telephone, langue: v.langue };
      return { prenom: v.prenom, nom: v.nom, telephone: v.telephone, langue: v.langue };
    }
  } catch {
    // Stockage bloqué (navigation privée) ou contenu abîmé : la page fonctionne sans.
  }
  return null;
}

export function ecrireCoordonnees(c: Coordonnees | null, stockage: Stockage | null = stockageNavigateur()): void {
  try {
    if (c) stockage?.setItem(CLE, JSON.stringify(c));
    else stockage?.removeItem(CLE);
  } catch {
    // Stockage bloqué : rien à garder.
  }
}

const CLE_LANGUE = "lama-relais-langue";

/** Langue choisie par la cliente sur ce téléphone, ou `null`. */
export function lireLangue(stockage: Stockage | null = stockageNavigateur()): Lang | null {
  try {
    const v = stockage?.getItem(CLE_LANGUE);
    return v === "fr" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

export function ecrireLangue(lang: Lang, stockage: Stockage | null = stockageNavigateur()): void {
  try {
    stockage?.setItem(CLE_LANGUE, lang);
  } catch {
    // Stockage bloqué : la langue ne sera pas retenue.
  }
}
