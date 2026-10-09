/**
 * Préfixe des factures (distribution D-01) : réglage `caisse.prefixe`, lu
 * dans la transaction de l'appelant (émission d'une facture, changement du
 * réglage) pour qu'une vente et un changement concurrents passent l'un après
 * l'autre, jamais mêlés. Sans ligne en base (installation neuve), le défaut.
 */
import type { Database } from "../storage.ts";
import { DEFAULT_INVOICE_PREFIX } from "../../shared/caisse.ts";

/** Préfixe réglé, ou le défaut tant que rien n'est écrit. */
export function invoicePrefix(db: Database): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'caisse.prefixe'").get() as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as string) : DEFAULT_INVOICE_PREFIX;
}

/** Première facture émise, qui fige le préfixe ; `null` tant qu'aucune n'existe. */
export function prefixFrozenBy(db: Database): { numero: string } | null {
  const row = db.prepare("SELECT number FROM invoices WHERE kind = 'invoice' ORDER BY id LIMIT 1").get() as { number: string } | undefined;
  return row ? { numero: row.number } : null;
}

/**
 * Préfixe d'une facture qu'on va émettre, dans la transaction d'écriture de la vente : sans ligne en base
 * (installation neuve), le défaut est écrit comme réglage avant l'insertion de la facture, pour que la série
 * déjà employée ne dépende plus jamais de la constante. Ce réglage reste modifiable jusqu'à la facture (les
 * déclencheurs acceptent l'écriture tant qu'aucune facture n'existe).
 */
export function invoicePrefixForIssue(db: Database, now: number): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'caisse.prefixe'").get() as { value: string } | undefined;
  if (row) return JSON.parse(row.value) as string;
  db.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES ('caisse.prefixe', ?, 0, ?)").run(JSON.stringify(DEFAULT_INVOICE_PREFIX), now);
  return DEFAULT_INVOICE_PREFIX;
}
