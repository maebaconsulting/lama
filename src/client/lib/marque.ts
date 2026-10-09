/**
 * Places de la marque dans le cadre (renommage lama, § 1) : écran d'entrée,
 * rail ouvert, rail replié (64 px) et en-tête du téléphone. Module pur, lu
 * par `MarqueCadre` ; la vague B y ajoute le logo et les initiales de
 * l'institut sans changer les écrans qui appellent la marque.
 */

export type PlaceMarque = "entree" | "rail" | "replie" | "telephone";

export interface MiseEnPlace {
  /** `colonne` : signe au-dessus du mot ; `ligne` : côte à côte ; `signe` : le signe seul. */
  disposition: "colonne" | "ligne" | "signe";
  /** Taille du signe (classes Tailwind). */
  signe: string;
  /** Taille du signe quand le réglage masque le mot ; à défaut, `signe`. */
  signeSeul?: string;
  /** Corps du mot « lama », ou `null` quand il n'y a pas la place. */
  mot: string | null;
}

export const PLACES_MARQUE: Record<PlaceMarque, MiseEnPlace> = {
  entree: { disposition: "colonne", signe: "h-24 w-24", mot: "text-[2.75rem]" },
  rail: { disposition: "colonne", signe: "h-14 w-14", signeSeul: "h-18 w-18", mot: "text-2xl" },
  replie: { disposition: "signe", signe: "h-11 w-11", mot: null },
  telephone: { disposition: "ligne", signe: "h-9 w-9", mot: "text-lg" },
};

/** Réglage « marque.ecran » de la gérante : le signe avec le mot « lama », ou le signe seul. */
export type AffichageMarque = "logo_nom" | "logo";

export const AFFICHAGES_MARQUE: readonly AffichageMarque[] = ["logo_nom", "logo"];

/** Valeur lue dans l'état public ; toute autre valeur (absente, inconnue) revient au défaut, « logo et nom ». */
export function affichageMarque(value: unknown): AffichageMarque {
  return value === "logo" ? "logo" : "logo_nom";
}

/** Le mot « lama » s'écrit-il à cette place ? Jamais dans le rail replié ; ailleurs, selon le réglage. */
export function motVisible(place: PlaceMarque, affichage: AffichageMarque): boolean {
  return PLACES_MARQUE[place].mot !== null && affichage === "logo_nom";
}

/** Taille du signe à cette place : plus grande dans le rail ouvert quand le réglage masque le mot. */
export function tailleSigne(place: PlaceMarque, affichage: AffichageMarque): string {
  const mise = PLACES_MARQUE[place];
  return !motVisible(place, affichage) && mise.signeSeul ? mise.signeSeul : mise.signe;
}

/** Initiales de l'institut : premières lettres des deux premiers mots, en majuscules ; vide si le nom est vide. */
export function initiales(nom: string): string {
  return nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((mot) => Array.from(mot)[0]!.toLocaleUpperCase("fr"))
    .join("");
}

/** Marque telle que l'état public la donne : réglage d'affichage, nom de l'institut, version des logos déposés. */
export interface MarqueEtat {
  ecran: AffichageMarque;
  nom: string;
  clair: number | null;
  sombre: number | null;
}

const version = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Lit l'état public avec prudence : toute valeur absente ou inconnue revient au défaut. */
export function marqueEtat(state: unknown): MarqueEtat {
  const m = (state && typeof state === "object" ? state : {}) as { ecran?: unknown; nom?: unknown; logos?: { clair?: unknown; sombre?: unknown } | null };
  return {
    ecran: affichageMarque(m.ecran),
    nom: typeof m.nom === "string" ? m.nom : "",
    clair: version(m.logos?.clair),
    sombre: version(m.logos?.sombre),
  };
}

export type ContenuMarque =
  | { kind: "lama" }
  | { kind: "logo"; src: string; nom: string | null }
  | { kind: "nom"; nom: string }
  | { kind: "initiales"; texte: string };

/**
 * Ce que la marque montre à cette place. Sans aucun logo déposé : lama, comme
 * avant. Rail replié : les initiales. Ailleurs : le logo sombre (suivi du nom
 * selon le réglage), à défaut le nom de l'institut, à défaut lama.
 */
export function contenuMarque(place: PlaceMarque, etat: MarqueEtat, logoEnEchec: boolean): ContenuMarque {
  if (etat.clair === null && etat.sombre === null) return { kind: "lama" };
  const nom = etat.nom.trim();
  if (place === "replie") return nom ? { kind: "initiales", texte: initiales(nom) } : { kind: "lama" };
  if (etat.sombre !== null && !logoEnEchec) {
    return { kind: "logo", src: `/api/institut/logos/sombre?v=${etat.sombre}`, nom: etat.ecran === "logo_nom" && nom ? etat.nom : null };
  }
  return nom ? { kind: "nom", nom: etat.nom } : { kind: "lama" };
}
