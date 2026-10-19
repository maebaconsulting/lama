import type { Database } from "../storage.ts";

/** État de la liaison avec le relais (ligne unique de `en_ligne_etat`, migrations 021 et 022). */
export type EtatLiaison = {
  curseur: string | null;
  /** Relais et salon qui ont donné le curseur (`referenceCurseur`) : le curseur est oublié quand elle change. */
  curseur_ref: string | null;
  offre_empreinte: string | null;
  offre_version: number;
  offre_publiee_le: number | null;
  plages_empreinte: string | null;
  plages_version: number;
  plages_publiees_le: number | null;
  dernier_succes_le: number | null;
  /** Forme codée (`@en_ligne.…`), traduite à l'affichage. */
  derniere_erreur: string | null;
  derniere_erreur_le: number | null;
  /** Demandes en attente sur le relais, après le dernier relevé. */
  attente_relais: number | null;
};

const COLONNES = [
  "curseur", "curseur_ref", "offre_empreinte", "offre_version", "offre_publiee_le", "plages_empreinte", "plages_version", "plages_publiees_le",
  "dernier_succes_le", "derniere_erreur", "derniere_erreur_le", "attente_relais",
] as const satisfies readonly (keyof EtatLiaison)[];

export function lireEtat(db: Database): EtatLiaison {
  const l = db.prepare("SELECT * FROM en_ligne_etat WHERE id = 1").get() as EtatLiaison | undefined;
  if (!l) throw new Error("État de la liaison absent (migration 021 non appliquée).");
  return Object.fromEntries(COLONNES.map((c) => [c, l[c]])) as EtatLiaison;
}

/** Écrit les seuls champs donnés. */
export function ecrireEtat(db: Database, champs: Partial<EtatLiaison>): void {
  const cles = COLONNES.filter((c) => Object.hasOwn(champs, c));
  if (!cles.length) return;
  db.prepare(`UPDATE en_ligne_etat SET ${cles.map((c) => `${c} = ?`).join(", ")} WHERE id = 1`).run(...cles.map((c) => champs[c] ?? null));
}

/** Référence d'un curseur : il ne vaut que pour l'adresse du relais et le salon qui l'ont donné. */
export function referenceCurseur(c: { adresse: string; salon: string }): string {
  return JSON.stringify([c.adresse, c.salon]);
}
