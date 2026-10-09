/** Types des réponses des routes des Réglages (plan 2A). */

/**
 * Réglage tel que le serveur l'envoie. Pour un réglage qu'une donnée peut
 * figer (préfixe des factures, distribution D-01) : `editable` (la personne
 * peut encore l'écrire) et `frozen` (la facture qui le fige, ou `null`).
 */
export interface Setting { key: string; secret: boolean; value: unknown; set: boolean; editable?: boolean; frozen?: { numero: string } | null }

export interface DeviceRow { id: number; name: string; created_at: number; last_seen_at: number | null; revoked: number }

export interface OutboxItem {
  id: number;
  kind: string;
  status: "pending" | "sending" | "sent" | "failed";
  /** Sort donné à la main (WhatsApp, sous-projet 7) : vide, « marqué comme envoyé » ou « ignoré ». */
  manual: "" | "sent" | "ignored";
  attempts: number;
  next_attempt_at: number;
  last_error: string;
  created_at: number;
  sent_at: number | null;
}

export interface OutboxReply { items: OutboxItem[]; online: boolean; pending: number }

export interface AuditEntry { id: number; at: number; account_id: number | null; account_name: string | null; action: string; target: string; ip: string }

export interface BackupDestination { last_ok_at: number | null; alert: boolean; configured: boolean }

export interface BackupStatus { last_ok_at: number | null; alert: boolean; destinations: { usb: BackupDestination; drive: BackupDestination } }

export interface BackupHistory { at: number; destination: "usb" | "drive"; status: "ok" | "failed" | "pending"; file: string; message: string }

export interface BackupsReply { history: BackupHistory[]; files: { quotidiennes: string[]; mensuelles: string[] } }
