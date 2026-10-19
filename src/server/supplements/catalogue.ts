/**
 * Suppléments possibles d'une prestation (spec du 18/10/2026 § 3.1) : forme de la liste
 * reçue, lecture, contrôle et écriture de la liste ordonnée, et « Recopier vers… ».
 * Fonctions synchrones sur la base, appelées dans `StorageBinding.transaction` : un refus
 * lève une `SupplementError` et l'appelant annule tout.
 */
import type { Database } from "../storage.ts";
import { MessageError, type MessageKey, type Values } from "../messages.ts";
import { LISTE_MAX } from "../../shared/supplements.ts";

export interface SupplementRef {
  kind: "service" | "product";
  ref_id: number;
}

/** Refus lié aux suppléments : message du dictionnaire et statut HTTP. */
export class SupplementError extends MessageError {
  readonly status: 400 | 404 | 409;

  constructor(status: 400 | 404 | 409, key: MessageKey, values: Values = {}) {
    super(key, values);
    this.name = "SupplementError";
    this.status = status;
  }
}

type Row = Record<string, unknown>;
const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const one = (db: Database, sql: string, ...params: (string | number)[]) => db.prepare(sql).get(...params) as Row | undefined;

/** Forme de la liste reçue : au plus 30 articles ; un article répété n'est gardé qu'une fois, à sa première place. */
export function parseList(raw: unknown): SupplementRef[] {
  if (!Array.isArray(raw) || raw.length > LISTE_MAX) throw new SupplementError(400, "supplement.liste_invalide");
  const seen = new Set<string>();
  const out: SupplementRef[] = [];
  for (const item of raw) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    if ((r.kind !== "service" && r.kind !== "product") || !isId(r.ref_id)) throw new SupplementError(400, "supplement.liste_invalide");
    const key = `${r.kind}:${r.ref_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: r.kind, ref_id: r.ref_id });
  }
  return out;
}

/** Cibles de « Recopier vers… » : au moins une prestation, 200 au plus, sans doublon. */
export function parseTargets(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200 || !raw.every(isId)) throw new SupplementError(400, "supplement.cibles");
  return [...new Set(raw as number[])];
}

/** Liste d'une prestation, dans l'ordre réglé. */
export function readList(db: Database, serviceId: number): SupplementRef[] {
  const rows = db.prepare("SELECT kind, ref_id FROM service_supplements WHERE service_id = ? ORDER BY position").all(serviceId) as Row[];
  return rows.map((r) => ({ kind: r.kind as SupplementRef["kind"], ref_id: Number(r.ref_id) }));
}

/**
 * Remplace la liste d'une prestation, après contrôle : la prestation et chaque article
 * existent ; jamais la prestation elle-même ; un supplément n'a pas lui-même de
 * suppléments (une prestation de la liste n'a pas de liste, et une prestation déjà
 * supplément d'une autre, ou « supplément seulement », ne reçoit pas de liste non vide).
 */
export function writeList(db: Database, serviceId: number, items: SupplementRef[]): void {
  if (!one(db, "SELECT id FROM services WHERE id = ?", serviceId)) throw new SupplementError(404, "vente.prestation_inconnue", { id: serviceId });
  if (items.length > 0 && one(db, "SELECT 1 AS x FROM service_supplements WHERE kind = 'service' AND ref_id = ?", serviceId)) {
    throw new SupplementError(409, "supplement.deja_supplement");
  }
  if (items.length > 0 && one(db, "SELECT 1 AS x FROM services WHERE id = ? AND supplement_seulement = 1", serviceId)) {
    throw new SupplementError(409, "supplement.seulement_liste");
  }
  for (const item of items) {
    if (item.kind === "service" && item.ref_id === serviceId) throw new SupplementError(400, "supplement.lui_meme");
    const row = item.kind === "service"
      ? one(db, "SELECT name FROM services WHERE id = ?", item.ref_id)
      : one(db, "SELECT name FROM products WHERE id = ?", item.ref_id);
    if (!row) throw new SupplementError(404, "supplement.introuvable", { id: item.ref_id });
    if (item.kind === "service" && one(db, "SELECT 1 AS x FROM service_supplements WHERE service_id = ?", item.ref_id)) {
      throw new SupplementError(409, "supplement.a_une_liste", { nom: String(row.name) });
    }
  }
  db.prepare("DELETE FROM service_supplements WHERE service_id = ?").run(serviceId);
  const add = db.prepare("INSERT INTO service_supplements (service_id, kind, ref_id, position) VALUES (?, ?, ?, ?)");
  items.forEach((item, position) => add.run(serviceId, item.kind, item.ref_id, position));
}

/**
 * « Recopier vers… » : la liste de `fromId` remplace celle de chaque cible, avec les mêmes
 * contrôles que `writeList` (la prestation source n'est jamais sa propre cible). Une cible
 * refusée annule toute la copie (transaction de l'appelant). Rend le nombre de cibles copiées.
 */
export function copyList(db: Database, fromId: number, targets: number[]): number {
  if (!one(db, "SELECT id FROM services WHERE id = ?", fromId)) throw new SupplementError(404, "vente.prestation_inconnue", { id: fromId });
  const items = readList(db, fromId);
  const cibles = targets.filter((id) => id !== fromId);
  for (const target of cibles) writeList(db, target, items);
  return cibles.length;
}
