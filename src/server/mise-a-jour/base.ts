import type { Database } from "../storage.ts";

/** Ligne unique de `mise_a_jour_etat` (migration 025). */
export type BaseMiseAJour = {
  verifie_le: number | null;
  version: string | null;
  publiee_le: number | null;
  note_fr: string | null;
  note_en: string | null;
  /** Forme codée (`@mise_a_jour.…`), traduite à l'affichage. */
  erreur: string | null;
  /** Identifiant de la dernière opération inscrite au journal. */
  operation_journalisee: string | null;
};

const COLONNES = ["verifie_le", "version", "publiee_le", "note_fr", "note_en", "erreur", "operation_journalisee"] as const satisfies readonly (keyof BaseMiseAJour)[];

export function lireBase(db: Database): BaseMiseAJour {
  const ligne = db.prepare("SELECT * FROM mise_a_jour_etat WHERE id = 1").get() as BaseMiseAJour | undefined;
  if (!ligne) throw new Error("État de la mise à jour absent (migration 025 non appliquée).");
  return Object.fromEntries(COLONNES.map((c) => [c, ligne[c]])) as BaseMiseAJour;
}

/** Écrit les seuls champs donnés. */
export function ecrireBase(db: Database, champs: Partial<BaseMiseAJour>): void {
  const cles = COLONNES.filter((c) => Object.hasOwn(champs, c));
  if (!cles.length) return;
  db.prepare(`UPDATE mise_a_jour_etat SET ${cles.map((c) => `${c} = ?`).join(", ")} WHERE id = 1`).run(...cles.map((c) => champs[c] ?? null));
}
