/**
 * Champs du mini CRM sur la fiche d'une cliente (décisions 1 à 4) :
 * anniversaire `MM-JJ` sans année (vide pour l'effacer, 29 février accepté),
 * préférences (500 caractères), étiquettes, numéro de carte (§ 5). Rend les colonnes à écrire et les
 * étiquettes, ou la clé du message de refus ; un champ absent n'est pas touché.
 */
import type { MessageKey } from "../messages.ts";
import { CARD_FORMAT, normalizeCard } from "../../shared/carte.ts";
import { normalizeTags } from "./etiquettes.ts";

export const MAX_PREFERENCES = 500;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Vrai pour un jour et un mois qui existent (`MM-JJ`), le 29 février compris. */
export function birthdayValid(value: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1];
}

export interface CrmFields {
  columns: { birthday?: string; preferences?: string; card?: string | null };
  tags?: string[];
}

/** Lit `birthday`, `preferences` et `tags` d'un corps de requête déjà restreint au rôle (`restrictFields`). */
export function readCrmFields(body: Record<string, unknown>): CrmFields | { error: MessageKey } {
  const columns: CrmFields["columns"] = {};
  if (body.birthday !== undefined) {
    if (typeof body.birthday !== "string" || (body.birthday !== "" && !birthdayValid(body.birthday))) return { error: "cliente.anniversaire_format" };
    columns.birthday = body.birthday;
  }
  if (body.preferences !== undefined) {
    if (typeof body.preferences !== "string") return { error: "cliente.preferences_longueur" };
    const text = body.preferences.trim();
    if ([...text].length > MAX_PREFERENCES) return { error: "cliente.preferences_longueur" };
    columns.preferences = text;
  }
  if (body.card !== undefined) {
    // Numéro de carte (§ 5) : vide ou null le retire ; sinon nettoyé puis contrôlé.
    if (body.card !== null && typeof body.card !== "string") return { error: "cliente.carte_format" };
    const card = body.card === null ? "" : normalizeCard(body.card);
    if (card !== "" && !CARD_FORMAT.test(card)) return { error: "cliente.carte_format" };
    columns.card = card === "" ? null : card;
  }
  if (body.tags === undefined) return { columns };
  const read = normalizeTags(body.tags);
  if ("error" in read) return read;
  return { columns, tags: read.tags };
}
