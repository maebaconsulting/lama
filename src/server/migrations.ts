import type { DatabaseSync } from "node:sqlite";
import base from "./migrations/001_base.ts";
import socle from "./migrations/002_socle.ts";
import bilingue from "./migrations/003_bilingue.ts";
import theme from "./migrations/004_theme.ts";
import caisse from "./migrations/005_caisse.ts";
import avoirs from "./migrations/006_avoirs.ts";
import cloture from "./migrations/007_cloture.ts";
import acomptes from "./migrations/008_acomptes.ts";
import whatsapp from "./migrations/009_whatsapp.ts";
import impression from "./migrations/010_impression.ts";
import sms from "./migrations/011_sms.ts";
import logos from "./migrations/012_logos.ts";
import imagesProduits from "./migrations/013_images_produits.ts";
import crm from "./migrations/014_crm.ts";
import fidelite from "./migrations/015_fidelite.ts";
import carte from "./migrations/016_carte.ts";
import acompteComptoir from "./migrations/017_acompte_comptoir.ts";
import prefixeFactures from "./migrations/018_prefixe_factures.ts";
import devise from "./migrations/019_devise.ts";
import horaires from "./migrations/020_horaires.ts";
import enLigne from "./migrations/021_en_ligne.ts";
import curseurRef from "./migrations/022_curseur_ref.ts";
import prenomEnLigne from "./migrations/023_prenom_en_ligne.ts";
import supplements from "./migrations/024_supplements.ts";

export const MIGRATIONS: { id: string; sql: string }[] = [
  { id: "001_base", sql: base },
  { id: "002_socle", sql: socle },
  { id: "003_bilingue", sql: bilingue },
  { id: "004_theme", sql: theme },
  { id: "005_caisse", sql: caisse },
  { id: "006_avoirs", sql: avoirs },
  { id: "007_cloture", sql: cloture },
  { id: "008_acomptes", sql: acomptes },
  { id: "009_whatsapp", sql: whatsapp },
  { id: "010_impression", sql: impression },
  { id: "011_sms", sql: sms },
  { id: "012_logos", sql: logos },
  { id: "013_images_produits", sql: imagesProduits },
  { id: "014_crm", sql: crm },
  { id: "015_fidelite", sql: fidelite },
  { id: "016_carte", sql: carte },
  { id: "017_acompte_comptoir", sql: acompteComptoir },
  { id: "018_prefixe_factures", sql: prefixeFactures },
  { id: "019_devise", sql: devise },
  { id: "020_horaires", sql: horaires },
  { id: "021_en_ligne", sql: enLigne },
  { id: "022_curseur_ref", sql: curseurRef },
  { id: "023_prenom_en_ligne", sql: prenomEnLigne },
  { id: "024_supplements", sql: supplements },
];

/**
 * Applique, dans l'ordre et une seule fois, les migrations absentes de `schema_migrations`.
 * `beforeApply` reçoit la liste à appliquer (pour sauvegarder avant) ; il n'est appelé que si elle n'est pas vide.
 */
export function runMigrations(db: DatabaseSync, list = MIGRATIONS, beforeApply?: (ids: string[]) => void): string[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
  const done = new Set((db.prepare("SELECT id FROM schema_migrations").all() as { id: string }[]).map((r) => r.id));
  const todo = list.filter((m) => !done.has(m.id));
  if (todo.length && beforeApply) beforeApply(todo.map((m) => m.id));
  for (const migration of todo) {
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(migration.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${migration.id} échouée\u00a0: ${(error as Error).message}`);
    }
  }
  return todo.map((m) => m.id);
}
