/**
 * Devises proposées à l'installation (spec du 15/10/2026, § 1) : une liste
 * préparée une par une, avec billets, pièces et montants rapides. Les
 * montants de lama sont des entiers en unités mineures : le franc pour le
 * FCFA, le centime pour l'euro. Aucune dépendance, testé sous Node.
 */

export type CodeDevise = "XAF" | "XOF" | "GNF" | "NGN" | "GHS" | "MAD" | "EUR" | "USD" | "GBP" | "CDF" | "KES";
export type PositionSymbole = "avant" | "apres";

export interface Devise {
  code: CodeDevise;
  /** Exposant de l'unité mineure. */
  decimales: 0 | 2;
  /** À l'écran. */
  symbole: string;
  /** Sur les documents, en ASCII (imprimante en CP858). */
  libelle: string;
  /** Position par défaut du symbole. */
  position: PositionSymbole;
  nom: { fr: string; en: string };
  /** Unités mineures, ordre décroissant. */
  billets: number[];
  pieces: number[];
  /** Montants rapides, unités mineures, ordre croissant. */
  paliers: number[];
  /** Conversion indicative des prix de démonstration, écrits en XAF. */
  facteurDemo: number;
}

type Saisie = Omit<Devise, "billets" | "pieces" | "paliers"> & { billets: number[]; pieces: number[]; paliers: number[] };

/** Valeurs saisies en unités de la devise, rangées en unités mineures. */
function devise(d: Saisie): Devise {
  const k = 10 ** d.decimales;
  const mineur = (values: number[]) => values.map((v) => Math.round(v * k));
  return { ...d, billets: mineur(d.billets), pieces: mineur(d.pieces), paliers: mineur(d.paliers) };
}

export const DEVISES: Record<CodeDevise, Devise> = {
  XAF: devise({ code: "XAF", decimales: 0, symbole: "F", libelle: "FCFA", position: "apres", nom: { fr: "Franc CFA (Afrique centrale)", en: "CFA franc (Central Africa)" }, billets: [10000, 5000, 2000, 1000], pieces: [500, 100, 50, 25, 10], paliers: [1000, 2000, 5000, 10000], facteurDemo: 1 }),
  XOF: devise({ code: "XOF", decimales: 0, symbole: "F", libelle: "FCFA", position: "apres", nom: { fr: "Franc CFA (Afrique de l'Ouest)", en: "CFA franc (West Africa)" }, billets: [10000, 5000, 2000, 1000, 500], pieces: [250, 200, 100, 50, 25, 10, 5], paliers: [1000, 2000, 5000, 10000], facteurDemo: 1 }),
  GNF: devise({ code: "GNF", decimales: 0, symbole: "FG", libelle: "GNF", position: "apres", nom: { fr: "Franc guinéen", en: "Guinean franc" }, billets: [20000, 10000, 5000, 2000, 1000, 500], pieces: [], paliers: [5000, 10000, 20000, 50000], facteurDemo: 15 }),
  NGN: devise({ code: "NGN", decimales: 2, symbole: "₦", libelle: "NGN", position: "avant", nom: { fr: "Naira nigérian", en: "Nigerian naira" }, billets: [1000, 500, 200, 100, 50, 20, 10, 5], pieces: [2, 1, 0.5], paliers: [500, 1000, 2000, 5000], facteurDemo: 2.5 }),
  GHS: devise({ code: "GHS", decimales: 2, symbole: "GH₵", libelle: "GHS", position: "avant", nom: { fr: "Cedi ghanéen", en: "Ghanaian cedi" }, billets: [200, 100, 50, 20, 10, 5], pieces: [2, 1, 0.5, 0.2, 0.1], paliers: [10, 20, 50, 100], facteurDemo: 0.02 }),
  MAD: devise({ code: "MAD", decimales: 2, symbole: "DH", libelle: "MAD", position: "apres", nom: { fr: "Dirham marocain", en: "Moroccan dirham" }, billets: [200, 100, 50, 20], pieces: [10, 5, 2, 1, 0.5, 0.2, 0.1], paliers: [50, 100, 200, 500], facteurDemo: 0.016 }),
  EUR: devise({ code: "EUR", decimales: 2, symbole: "€", libelle: "EUR", position: "apres", nom: { fr: "Euro", en: "Euro" }, billets: [200, 100, 50, 20, 10, 5], pieces: [2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01], paliers: [5, 10, 20, 50], facteurDemo: 1 / 655.957 }),
  USD: devise({ code: "USD", decimales: 2, symbole: "$", libelle: "USD", position: "avant", nom: { fr: "Dollar américain", en: "US dollar" }, billets: [100, 50, 20, 10, 5, 1], pieces: [0.25, 0.1, 0.05, 0.01], paliers: [5, 10, 20, 50], facteurDemo: 0.0017 }),
  GBP: devise({ code: "GBP", decimales: 2, symbole: "£", libelle: "GBP", position: "avant", nom: { fr: "Livre sterling", en: "Pound sterling" }, billets: [50, 20, 10, 5], pieces: [2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01], paliers: [5, 10, 20, 50], facteurDemo: 0.0013 }),
  CDF: devise({ code: "CDF", decimales: 2, symbole: "FC", libelle: "CDF", position: "apres", nom: { fr: "Franc congolais", en: "Congolese franc" }, billets: [20000, 10000, 5000, 1000, 500, 200, 100, 50], pieces: [], paliers: [1000, 5000, 10000, 20000], facteurDemo: 4.8 }),
  KES: devise({ code: "KES", decimales: 2, symbole: "KSh", libelle: "KES", position: "avant", nom: { fr: "Shilling kényan", en: "Kenyan shilling" }, billets: [1000, 500, 200, 100, 50], pieces: [20, 10, 5, 1], paliers: [100, 200, 500, 1000], facteurDemo: 0.22 }),
};

export const CODES_DEVISES: readonly CodeDevise[] = Object.keys(DEVISES) as CodeDevise[];
export const DEVISE_DEFAUT: CodeDevise = "XAF";

export function estCodeDevise(v: unknown): v is CodeDevise {
  return typeof v === "string" && Object.hasOwn(DEVISES, v);
}

/**
 * Prix de démonstration (écrit en XAF) dans la devise `code`, en unités
 * mineures, arrondi à une valeur ronde : à l'unité pour une devise sans
 * centimes ; sinon à 0,50 au-dessous de 10, à l'unité au-dessous de 100, à 5 au-delà.
 */
export function prixDemo(xaf: number, code: CodeDevise): number {
  const d = DEVISES[code];
  const x = xaf * d.facteurDemo;
  if (d.decimales === 0) return Math.round(x);
  const pas = x < 10 ? 0.5 : x < 100 ? 1 : 5;
  return Math.round((Math.round(x / pas) * pas) * 10 ** d.decimales);
}
