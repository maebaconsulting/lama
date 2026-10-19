/**
 * Impression directe des tickets (spec du 03/10/2026), côté écran : type des
 * documents et message à montrer après une émission avec la case « Imprimer
 * le ticket ». Fonctions pures, testées sous Node.
 */
import type { Key } from "../i18n/translate.ts";

export type PrintKind = "invoice" | "credit" | "deposit" | "closing";

/** Ce que le serveur ajoute au document émis avec `print: true`. */
export interface PrintOutcome {
  printed?: boolean;
  print_error?: string;
}

/** Message après l'émission : ticket imprimé, ou raison de l'échec ; `null` si l'impression n'était pas demandée. */
export function issueNotice(outcome: PrintOutcome | null | undefined): { ok: Key } | { error: string } | null {
  if (!outcome) return null;
  if (outcome.printed === true) return { ok: "impression.imprime" };
  if (outcome.print_error) return { error: outcome.print_error };
  return null;
}

// Avoir et acompte : le formulaire se referme et la fiche du document s'ouvre
// ensuite ; le résultat de l'impression faite à l'émission y passe par ici,
// lu une seule fois par les boutons du ticket de ce document.
const kept = new Map<string, PrintOutcome>();

/** Garde le résultat de l'impression faite à l'émission d'un document. */
export function keepOutcome(kind: PrintKind, id: number, outcome: PrintOutcome): void {
  if (outcome.printed !== undefined || outcome.print_error !== undefined) kept.set(`${kind}:${id}`, { printed: outcome.printed, print_error: outcome.print_error });
}

/** Résultat gardé pour ce document, rendu une seule fois. */
export function takeOutcome(kind: PrintKind, id: number): PrintOutcome | undefined {
  const outcome = kept.get(`${kind}:${id}`);
  kept.delete(`${kind}:${id}`);
  return outcome;
}
