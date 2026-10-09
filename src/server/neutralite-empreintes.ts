/**
 * Neutralité du dépôt (distribution D-03, démo publique DP-12) : repérage de l'ancienne marque par empreintes.
 * Ni le sigle ni le nom complet ne s'écrivent ici, ni ne se recomposent : seules leurs empreintes SHA-256
 * (formes en minuscules) sont gardées, et chaque mot d'une ligne est comparé à ces empreintes. Module des
 * essais seulement (neutralite, renommage, migrations, seed) ; l'application ne le lit jamais.
 */
import { createHash } from "node:crypto";
import { openDatabase } from "./storage.ts";
import { MIGRATIONS, runMigrations } from "./migrations.ts";

/** Empreinte SHA-256 du sigle, en minuscules. */
export const EMPREINTE_SIGLE = "07d3e64ced733d45d8db82c1709e83ecd3bb0e4fdc2593fdb0bf1831b524a60e";
/** Empreinte SHA-256 du nom complet, en minuscules, mots collés sans séparateur. */
export const EMPREINTE_NOM = "123548c428ac2b01d8f7353e4b79f6860fd423ef9eeaceb53c803d0de839d9a1";

/** Empreinte SHA-256 (hexadécimal) d'un texte normalisé en minuscules. */
export function empreinte(texte: string): string {
  return createHash("sha256").update(texte.toLowerCase(), "utf8").digest("hex");
}

export type Trace = "sigle" | "nom";

/**
 * Traces de l'ancienne marque dans une ligne, par fenêtres de mots (lettres et chiffres) :
 * - nom complet : un mot, ou deux mots voisins collés, dont l'empreinte est celle du nom (toute casse, tout séparateur) ;
 * - sigle : un mot entier (toute casse : entre guillemets, en tête d'un numéro de facture, d'une variable, d'un fichier),
 *   ou la tête d'un mot suivie d'un chiffre, ou la tête en minuscules d'un mot en camelCase.
 * Un mot qui contient seulement les trois lettres par hasard (`toCp858Text`) n'est pas une trace.
 */
export function traces(ligne: string): Trace[] {
  const mots = ligne.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const trouvees = new Set<Trace>();
  mots.forEach((mot, i) => {
    if (empreinte(mot) === EMPREINTE_NOM || (i + 1 < mots.length && empreinte(mot + mots[i + 1]) === EMPREINTE_NOM)) trouvees.add("nom");
    const tete = mot.slice(0, 3);
    const suite = mot.charAt(3);
    const teteSeule = suite === "" || /[0-9]/.test(suite) || (/^[a-z]{3}$/.test(tete) && /[A-Z]/.test(suite));
    if (teteSeule && empreinte(tete) === EMPREINTE_SIGLE) trouvees.add("sigle");
  });
  return [...trouvees];
}

/** Texte fabriqué à l'exécution à partir d'octets (essais du repérage : aucun littéral lisible). */
export function texteDOctets(octets: readonly number[]): string {
  return Buffer.from(octets).toString("utf8");
}

/**
 * Série historique des factures de la première installation, telle que la migration 018 l'écrit dans une base
 * en service (par ses codes de caractères) : lue dans une base de passage, jamais écrite dans le code.
 */
export function serieHistorique(): string {
  const db = openDatabase(":memory:");
  try {
    runMigrations(db, MIGRATIONS.filter((m) => m.id < "018"));
    db.exec("INSERT INTO accounts (id, display_name, login, role, password_hash, created_at) VALUES (1, 'Admin', 'admin', 'admin', 'x', 0)");
    runMigrations(db);
    return JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'caisse.prefixe'").get() as { value: string }).value) as string;
  } finally {
    db.close();
  }
}
