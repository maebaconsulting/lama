/**
 * Registre de la fidélité (mini CRM, spec § 2, décisions 11 à 21) : écritures
 * signées jamais modifiées (`loyalty_entries`, migration 015), solde = leur
 * somme, peut être négatif. Fonctions synchrones sur la base (`Database`),
 * appelées dans `StorageBinding.transaction` : celles d'une vente ou d'un
 * avoir sont écrites dans la transaction du document, toute erreur annule tout.
 */
import type { Database } from "../storage.ts";
import { crmActive, getSetting } from "../settings.ts";
import { nextTier, pointsFor, reprisePoints, type LoyaltyRule, type Tier } from "../../shared/fidelite.ts";

export type LoyaltyKind = "gain" | "recompense" | "reprise" | "restitution" | "correction";

/** Réglages de la fidélité au moment de l'appel. */
export interface LoyaltySettings {
  active: boolean;
  /** Vrai quand la fidélité est inactive à cause du mini CRM désactivé (refus dit « Mini CRM désactivé. »). */
  crmOff?: boolean;
  rule: LoyaltyRule;
  tiers: Tier[];
}

/**
 * Réglages de la fidélité (valeurs par défaut de la spec tant que la gérante n'y a pas touché).
 * Mini CRM désactivé (interrupteur général) : la fidélité est tenue pour inactive partout
 * (ni gain, ni récompense, ni correction, ni solde affiché), sa case restant inchangée.
 */
export async function readLoyaltySettings(): Promise<LoyaltySettings> {
  const crm = await crmActive();
  return {
    active: (await getSetting<boolean>("fidelite.active")) && crm,
    crmOff: !crm,
    rule: { tranche: await getSetting<number>("fidelite.tranche"), points: await getSetting<number>("fidelite.points") },
    tiers: await getSetting<Tier[]>("fidelite.paliers"),
  };
}

/** Écriture du registre telle que la fiche la montre. */
export interface LoyaltyEntry {
  id: number;
  kind: LoyaltyKind;
  points: number;
  note: string;
  created_at: number;
  invoice_id: number | null;
  /** Numéro de la facture ou de l'avoir de l'écriture ; `null` pour une correction. */
  invoice_number: string | null;
  account_name: string | null;
}

/** Fidélité de la synthèse de la fiche (`ClientSummary.loyalty`). */
export interface LoyaltySummary {
  balance: number;
  next_tier: { points: number; montant: number; missing: number } | null;
}

type Row = Record<string, unknown>;

/** Solde d'une cliente : somme de ses écritures (0 sans écriture ; peut être négatif). */
export function loyaltyBalance(db: Database, clientId: number): number {
  const row = db.prepare("SELECT COALESCE(SUM(points), 0) AS balance FROM loyalty_entries WHERE client_id = ?").get(clientId) as { balance: number };
  return Number(row.balance);
}

/** Écrit une écriture ; zéro point n'écrit rien (la table refuse une écriture nulle). */
function addEntry(db: Database, e: { clientId: number; invoiceId: number | null; kind: LoyaltyKind; points: number; note?: string; accountId: number | null; now: number }): void {
  if (e.points === 0) return;
  db.prepare("INSERT INTO loyalty_entries (client_id, invoice_id, kind, points, note, account_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(e.clientId, e.invoiceId, e.kind, e.points, e.note ?? "", e.accountId, e.now);
}

/** Correction à la main (décision 18) : points signés et motif, sans document. */
export function recordCorrection(db: Database, input: { clientId: number; points: number; note: string; accountId: number; now: number }): void {
  addEntry(db, { clientId: input.clientId, invoiceId: null, kind: "correction", points: input.points, note: input.note, accountId: input.accountId, now: input.now });
}

/** Dernières écritures d'une cliente, la plus récente d'abord, avec le numéro du document et le nom de la personne. */
export function loyaltyEntries(db: Database, clientId: number, limit = 20): LoyaltyEntry[] {
  const rows = db.prepare(
    `SELECT e.id, e.kind, e.points, e.note, e.created_at, e.invoice_id, i.number AS invoice_number, a.display_name AS account_name
       FROM loyalty_entries e
       LEFT JOIN invoices i ON i.id = e.invoice_id
       LEFT JOIN accounts a ON a.id = e.account_id
      WHERE e.client_id = ? ORDER BY e.id DESC LIMIT ?`,
  ).all(clientId, limit) as Row[];
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind as LoyaltyKind,
    points: Number(r.points),
    note: String(r.note ?? ""),
    created_at: Number(r.created_at),
    invoice_id: r.invoice_id === null ? null : Number(r.invoice_id),
    invoice_number: (r.invoice_number as string | null) ?? null,
    account_name: (r.account_name as string | null) ?? null,
  }));
}

/** Solde et prochain palier d'une cliente (synthèse de la fiche). */
export function loyaltySummary(db: Database, clientId: number, tiers: readonly Tier[]): LoyaltySummary {
  const balance = loyaltyBalance(db, clientId);
  return { balance, next_tier: nextTier(balance, tiers) };
}

/**
 * Écritures d'une vente (décisions 12, 14, 15), dans la transaction de la
 * facture : la récompense utilisée (moins les points du palier) puis le gain
 * (règle sur le total TTC après remise, pourboire exclu). Sans cliente, rien.
 */
export function recordSaleLoyalty(db: Database, input: { invoiceId: number; clientId: number | null; totalTtc: number; rewardPoints: number; rule: LoyaltyRule; accountId: number; now: number }): void {
  if (input.clientId === null) return;
  const base = { clientId: input.clientId, invoiceId: input.invoiceId, accountId: input.accountId, now: input.now };
  if (input.rewardPoints > 0) addEntry(db, { ...base, kind: "recompense", points: -input.rewardPoints });
  addEntry(db, { ...base, kind: "gain", points: pointsFor(input.totalTtc, input.rule) });
}

/**
 * Écritures d'un avoir (décision 17), dans sa transaction : reprise au
 * prorata des points gagnés par la facture (arrondie au point supérieur,
 * jamais plus que ce que les avoirs précédents ont laissé) ; si l'avoir
 * annule la facture, tout ce qui reste est repris et les points de la
 * récompense utilisée sont restitués. Un avoir partiel ne restitue rien.
 * Fondé sur les seules écritures du registre (jamais sur le motif de la
 * remise) ; écrit même si la fidélité est désactivée depuis la vente.
 */
export function recordCreditLoyalty(db: Database, input: { creditId: number; invoiceId: number; clientId: number | null; creditTtc: number; invoiceTtc: number; completes: boolean; accountId: number; now: number }): void {
  if (input.clientId === null) return;
  const own = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'gain' THEN points END), 0) AS gained,
            COALESCE(-SUM(CASE WHEN kind = 'recompense' THEN points END), 0) AS reward
       FROM loyalty_entries WHERE invoice_id = ?`,
  ).get(input.invoiceId) as { gained: number; reward: number };
  const before = db.prepare(
    `SELECT COALESCE(-SUM(e.points), 0) AS taken
       FROM loyalty_entries e JOIN invoices a ON a.id = e.invoice_id
      WHERE a.credited_invoice_id = ? AND e.kind = 'reprise'`,
  ).get(input.invoiceId) as { taken: number };
  const base = { clientId: input.clientId, invoiceId: input.creditId, accountId: input.accountId, now: input.now };
  const taken = reprisePoints(Number(own.gained), Number(before.taken), input.creditTtc, input.invoiceTtc, input.completes);
  addEntry(db, { ...base, kind: "reprise", points: -taken });
  if (input.completes && Number(own.reward) > 0) addEntry(db, { ...base, kind: "restitution", points: Number(own.reward) });
}

/** Fidélité d'un document au ticket (décision 19) : points par nature et solde figé. */
export interface TicketLoyalty {
  earned: number;
  reward: number;
  taken: number;
  restored: number;
  /** Solde de la cliente juste après les écritures de ce document (identifiants inférieurs ou égaux à sa dernière). */
  balance: number;
}

/**
 * Écritures d'un document (facture ou avoir, un paramètre : son identifiant) :
 * nombre, points par nature, et solde figé de la cliente. Une seule requête,
 * partagée par `documentLoyalty` (dans une transaction) et `readInvoice`
 * (lecture par `@clawnify/db`, sans accès à la base synchrone).
 */
export const DOCUMENT_LOYALTY_SQL = `WITH d AS (SELECT id, client_id, kind, points FROM loyalty_entries WHERE invoice_id = ?)
SELECT COUNT(*) AS n,
       COALESCE(SUM(CASE WHEN kind = 'gain' THEN points END), 0) AS earned,
       COALESCE(-SUM(CASE WHEN kind = 'recompense' THEN points END), 0) AS reward,
       COALESCE(-SUM(CASE WHEN kind = 'reprise' THEN points END), 0) AS taken,
       COALESCE(SUM(CASE WHEN kind = 'restitution' THEN points END), 0) AS restored,
       (SELECT COALESCE(SUM(e.points), 0) FROM loyalty_entries e
         WHERE e.client_id = (SELECT client_id FROM d LIMIT 1) AND e.id <= (SELECT MAX(id) FROM d)) AS balance
  FROM d`;

/** Ligne lue par `DOCUMENT_LOYALTY_SQL` en fidélité du ticket ; `null` si le document n'a aucune écriture. */
export function ticketLoyalty(row: Record<string, unknown> | null | undefined): TicketLoyalty | null {
  if (!row || Number(row.n) === 0) return null;
  return { earned: Number(row.earned), reward: Number(row.reward), taken: Number(row.taken), restored: Number(row.restored), balance: Number(row.balance) };
}

/** Fidélité d'un document lue dans le registre ; `null` sans écriture (rien n'est imprimé). */
export function documentLoyalty(db: Database, invoiceId: number): TicketLoyalty | null {
  return ticketLoyalty(db.prepare(DOCUMENT_LOYALTY_SQL).get(invoiceId) as Record<string, unknown> | undefined);
}