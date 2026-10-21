/**
 * Campagnes (mini CRM, décisions 27 et 29) : message de la gérante aux
 * clientes d'une étiquette, un envoi par destinataire dans la file WhatsApp
 * et SMS. Une étiquette est exigée (jamais d'envoi à toutes les clientes).
 * Exclues : sans numéro valable ou en « Aucun ». Fonctions synchrones,
 * appelées dans une transaction (`StorageBinding.transaction`) : la campagne
 * et ses envois sont inscrits ensemble, ou pas du tout.
 */
import { fold } from "../fold.ts";
import { coded, type Lang } from "../messages.ts";
import { enqueueSync } from "../outbox/outbox.ts";
import type { Database } from "../storage.ts";
import { WHATSAPP_KIND, type WhatsappMessage } from "../whatsapp/envoi.ts";
import { normalizePhone, silenceEnd } from "../whatsapp/numeros.ts";
import type { MessageSettings } from "../whatsapp/rendez-vous.ts";
import { firstName, renderTemplate, templateProblem } from "../whatsapp/textes.ts";

/** Longueur d'une étiquette (décision 3). */
const MAX_TAG = 30;
/** La rubrique « Messages » liste les vingt dernières campagnes (décision 27). */
export const CAMPAIGN_LIST_LIMIT = 20;

export interface CampaignRecipient { id: number; name: string; to: string; lang: Lang }
export interface CampaignAudience { recipients: CampaignRecipient[]; excluded: number }
export interface CampaignInput { tag: string; textFr: string; textEn: string }
export interface CampaignRow {
  id: number; tag: string; text_fr: string; text_en: string; recipients: number; excluded: number; created_at: number;
  /** Envois de la file : partis (à la main compris), en attente, en échec à envoyer à la main. */
  sent: number; pending: number; manual: number;
}

/** Étiquette demandée, sans espaces autour, ou `null` si elle manque ou dépasse 30 caractères. */
export function campaignTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tag = value.trim();
  return tag && [...tag].length <= MAX_TAG ? tag : null;
}

/** Demande lue et contrôlée : étiquette exigée, texte français obligatoire, anglais facultatif ; erreur codée sinon. */
export function campaignInput(body: { tag?: unknown; text_fr?: unknown; text_en?: unknown }): CampaignInput | { error: string } {
  const tag = campaignTag(body.tag);
  if (!tag) return { error: coded("campagne.etiquette_requise") };
  const textFr = typeof body.text_fr === "string" ? body.text_fr.trim() : "";
  const frProblem = templateProblem(textFr, "campagne");
  if (frProblem) return { error: frProblem };
  const textEn = typeof body.text_en === "string" ? body.text_en.trim() : "";
  if (textEn) {
    const enProblem = templateProblem(textEn, "campagne");
    if (enProblem) return { error: enProblem };
  }
  return { tag, textFr, textEn };
}

/** Clientes de l'étiquette (comparée sans accents ni majuscules) : celles qu'on peut joindre, et le nombre d'exclues. */
export function campaignAudience(db: Database, tag: string, s: Pick<MessageSettings, "indicatif" | "lang">): CampaignAudience {
  const rows = db.prepare(
    `SELECT c.id, c.name, c.phone, c.channel, c.language FROM clients c JOIN client_tags t ON t.client_id = c.id
      WHERE t.tag_key = ? ORDER BY c.name, c.id`,
  ).all(fold(tag)) as { id: number; name: string; phone: string | null; channel: string; language: string }[];
  const recipients: CampaignRecipient[] = [];
  let excluded = 0;
  for (const row of rows) {
    const to = row.channel === "none" ? null : normalizePhone(row.phone ?? "", s.indicatif);
    if (!to) {
      excluded++;
      continue;
    }
    recipients.push({ id: row.id, name: row.name, to, lang: row.language === "fr" || row.language === "en" ? row.language : s.lang });
  }
  return { recipients, excluded };
}

/**
 * Crée la campagne et met un message par destinataire en file (clé
 * `wa:campagne:{campagne}:{cliente}`), dans la langue de la cliente quand le
 * texte anglais existe, sinon en français ; pendant la fenêtre de silence,
 * premier essai à sa fin. `null` si aucune cliente ne peut être jointe.
 */
export function createCampaign(db: Database, s: MessageSettings, input: CampaignInput, opts: { accountId: number; now: number }): { id: number; tag: string; recipients: number; excluded: number } | null {
  const audience = campaignAudience(db, input.tag, s);
  if (audience.recipients.length === 0) return null;
  // Écriture gardée de l'étiquette (la première saisie, décision 3), pas celle tapée dans l'adresse.
  const stored = db.prepare("SELECT tag FROM client_tags WHERE tag_key = ? ORDER BY rowid LIMIT 1").get(fold(input.tag)) as { tag: string } | undefined;
  const tag = stored?.tag ?? input.tag;
  const info = db.prepare("INSERT INTO campaigns (tag, text_fr, text_en, recipients, excluded, account_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(tag, input.textFr, input.textEn, audience.recipients.length, audience.excluded, opts.accountId, opts.now);
  const id = Number(info.lastInsertRowid);
  const quietUntil = silenceEnd(opts.now, s.silenceStart, s.silenceEnd);
  for (const r of audience.recipients) {
    const english = r.lang === "en" && input.textEn !== "";
    const client = { prenom: firstName(r.name), nom: r.name.trim(), institut: s.institut, telephone: s.telephone };
    const text = renderTemplate(english ? input.textEn : input.textFr, client);
    // Meta : le texte rendu pour la cliente prend place dans le modèle « campagne » (W-3).
    const message: WhatsappMessage = { to: r.to, lang: english ? "en" : "fr", text, modele: "campagne", valeurs: { ...client, texte: text }, origin: { type: "campagne", clientId: r.id, campaignId: id } };
    enqueueSync(db, { kind: WHATSAPP_KIND, payload: message, dedupeKey: `wa:campagne:${id}:${r.id}`, createdBy: opts.accountId, now: opts.now, notBefore: quietUntil ?? undefined });
  }
  return { id, tag, recipients: audience.recipients.length, excluded: audience.excluded };
}

/** Au-delà de cette durée, une demande identique est une nouvelle campagne voulue. */
const REPLAY_WINDOW_MS = 60_000;

/**
 * Même campagne déjà créée par ce compte depuis moins d'une minute (requête
 * rejouée, double clic, réponse perdue) : on la renvoie au lieu d'écrire aux
 * clientes une seconde fois.
 */
export function recentDuplicate(db: Database, input: CampaignInput, opts: { accountId: number; now: number }): { id: number; tag: string; recipients: number; excluded: number } | null {
  const rows = db.prepare(
    `SELECT id, tag, recipients, excluded FROM campaigns
      WHERE account_id = ? AND text_fr = ? AND text_en = ? AND created_at > ? AND created_at <= ? ORDER BY id DESC`,
  ).all(opts.accountId, input.textFr, input.textEn, opts.now - REPLAY_WINDOW_MS, opts.now) as { id: number; tag: string; recipients: number; excluded: number }[];
  return rows.find((row) => fold(row.tag) === fold(input.tag)) ?? null;
}

/** Envois de la file d'une campagne qui remplissent la condition donnée. */
const outboxCount = (condition: string) =>
  `(SELECT COUNT(*) FROM outbox o WHERE o.dedupe_key LIKE 'wa:campagne:' || c.id || ':%' AND ${condition})`;

/** Dernières campagnes, la plus récente d'abord, avec leurs envois comptés dans la file. */
export function listCampaigns(db: Database, limit = CAMPAIGN_LIST_LIMIT): CampaignRow[] {
  return db.prepare(
    `SELECT c.id, c.tag, c.text_fr, c.text_en, c.recipients, c.excluded, c.created_at,
            ${outboxCount("o.status = 'sent' AND o.manual <> 'ignored'")} AS sent,
            ${outboxCount("o.status IN ('pending', 'sending')")} AS pending,
            ${outboxCount("o.status = 'failed' AND o.manual = ''")} AS manual
       FROM campaigns c ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
  ).all(limit) as unknown as CampaignRow[];
}
