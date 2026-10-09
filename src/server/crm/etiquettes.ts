/**
 * Étiquettes libres des clientes (mini CRM, décision 3) : 30 caractères au
 * plus, 10 par cliente, sans couleur ; deux étiquettes qui ne diffèrent que
 * par les accents ou les majuscules sont la même (`tag_key = fold(tag)`) et
 * l'écriture gardée est la première saisie dans l'institut. Une étiquette
 * disparaît quand plus aucune cliente ne la porte. Fonctions synchrones sur
 * la base, appelées dans `StorageBinding.transaction`.
 */
import type { Database } from "../storage.ts";
import type { MessageKey } from "../messages.ts";
import { fold } from "../fold.ts";

export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;

/** Lit une liste d'étiquettes : espaces resserrés, vides ignorées, doublons repliés retirés, plafonds contrôlés. */
export function normalizeTags(input: unknown): { tags: string[] } | { error: MessageKey } {
  if (!Array.isArray(input) || input.some((t) => typeof t !== "string")) return { error: "cliente.etiquettes_format" };
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of input as string[]) {
    const tag = raw.replace(/\s+/g, " ").trim();
    if (tag === "") continue;
    // Longueur en caractères (comme `length()` de SQLite), pas en unités UTF-16.
    if ([...tag].length > MAX_TAG_LENGTH) return { error: "cliente.etiquette_longueur" };
    const key = fold(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tags.length > MAX_TAGS) return { error: "cliente.etiquettes_nombre" };
  return { tags };
}

/** Étiquettes d'une cliente, dans l'ordre de saisie. */
export function readTags(db: Database, clientId: number): string[] {
  const rows = db.prepare("SELECT tag FROM client_tags WHERE client_id = ? ORDER BY rowid").all(clientId) as { tag: string }[];
  return rows.map((r) => r.tag);
}

/**
 * Remplace les étiquettes d'une cliente par `tags` (déjà lues par
 * `normalizeTags`) ; une étiquette déjà portée par une autre cliente reprend
 * son écriture (la première saisie).
 */
export function writeTags(db: Database, clientId: number, tags: string[]): void {
  db.prepare("DELETE FROM client_tags WHERE client_id = ?").run(clientId);
  const spelling = db.prepare("SELECT tag FROM client_tags WHERE tag_key = ? ORDER BY rowid LIMIT 1");
  const insert = db.prepare("INSERT INTO client_tags (client_id, tag, tag_key) VALUES (?, ?, ?)");
  for (const tag of tags) {
    const key = fold(tag);
    const existing = spelling.get(key) as { tag: string } | undefined;
    insert.run(clientId, existing?.tag ?? tag, key);
  }
}

/** Étiquettes existantes avec leur nombre de clientes : les plus portées d'abord, puis par nom (pour les puces et la saisie). */
export function listTagCounts(db: Database): { tag: string; count: number }[] {
  const rows = db.prepare(
    `SELECT (SELECT t2.tag FROM client_tags t2 WHERE t2.tag_key = t.tag_key ORDER BY t2.rowid LIMIT 1) AS tag, COUNT(*) AS count
       FROM client_tags t GROUP BY t.tag_key ORDER BY count DESC, t.tag_key ASC`,
  ).all() as { tag: string; count: number }[];
  return rows.map((r) => ({ tag: String(r.tag), count: Number(r.count) }));
}

/** Étiquettes d'une cliente `c` (alias SQL), dans l'ordre de saisie, en tableau JSON (`tags_json`, lu par `withTags`). */
export const TAGS_SQL = "(SELECT json_group_array(tag) FROM (SELECT tag FROM client_tags WHERE client_id = c.id ORDER BY rowid)) AS tags_json";

/** Ligne d'une cliente lue avec `TAGS_SQL` : `tags_json` remplacé par `tags` (tableau). */
export function withTags(row: Record<string, unknown>): Record<string, unknown> {
  const { tags_json: raw, ...rest } = row;
  return { ...rest, tags: typeof raw === "string" ? (JSON.parse(raw) as string[]) : [] };
}
