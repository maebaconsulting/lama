/**
 * Gestionnaire `whatsapp` de la file d'envoi (sous-projet 7 § 3) : un seul
 * type d'envoi, charge neutre (`WhatsappMessage`), fournisseur lu dans les
 * réglages à chaque envoi, débit limité (un envoi à la fois, au moins 4 s
 * plus un tirage de 0 à 4 s). Un message automatique devenu sans objet
 * (cliente passée à « Aucun », rendez-vous annulé, déplacé ou passé, anniversaire ou absence dépassés, relance décochée) est ignoré.
 */
import { get, run } from "@clawnify/db";
import { doualaDay } from "../../shared/caisse.ts";
import { logAudit } from "../audit.ts";
import { birthdaysOf } from "../crm/relances.ts";
import { coded, type Lang } from "../messages.ts";
import { PermanentError, TemporaryError, type Throttle } from "../outbox/outbox.ts";
import { readProductPhoto } from "../produits/images.ts";
import { crmActive, getSetting } from "../settings.ts";
import type { SmsProvider } from "../sms/passerelle.ts";
import type { DocumentFile, WhatsappProvider } from "./fournisseur.ts";
import { appointmentAt, silenceEnd } from "./numeros.ts";
import type { DocumentKind } from "./textes.ts";
import { createWaha } from "./waha.ts";
import { estFormation } from "../formation/mode.ts";

export const WHATSAPP_KIND = "whatsapp";

/** Canal choisi sur la fiche cliente (spec du 04/10/2026, § 1). */
export type Channel = "whatsapp" | "sms" | "none";

/** Nature d'un message de la file ; anniversaire, absence et campagne viennent du mini CRM (décision 22), transfert de la spec du 04/10/2026, en_ligne de la réservation en ligne (geste de la réception, ou accusé d'une demande de rappel). */
export type MessageOrigin = "confirmation" | "rappel" | "ticket" | "libre" | "produit" | "anniversaire" | "absence" | "campagne" | "transfert" | "en_ligne";

export interface WhatsappMessage {
  /** Numéro international, chiffres seuls ; vide si le numéro saisi est impossible à normaliser. */
  to: string;
  lang: Lang;
  /** Texte final, variables déjà remplacées. */
  text: string;
  /** Vague 2 : le PDF est produit au moment de l'envoi. */
  document?: { kind: DocumentKind; id: number };
  /** Produit recommandé (images des produits) : la photo est lue au moment de l'envoi, jamais gardée dans la file. */
  product?: { id: number };
  /**
   * `at` : instant du rendez-vous (ms) quand le message a été écrit, pour reconnaître un rendez-vous déplacé.
   * Mini CRM : `birthday` (`MM-JJ`) et `lastVisit` (`aaaa-mm-jj`) tels qu'à l'écriture, pour reconnaître une
   * relance devenue sans objet ; `campaignId` relie un envoi à sa campagne.
   * Transfert : `staffId`, la praticienne annoncée.
   */
  origin: { type: MessageOrigin; appointmentId?: number; clientId?: number; at?: number; birthday?: string; lastVisit?: string; campaignId?: number; staffId?: number; demandeId?: number };
}

/** Messages automatiques (décision 22) : silence respecté, cliente en « Aucun » ignorée, règle « sans objet » à l'envoi. */
export const AUTOMATIC_TYPES: readonly MessageOrigin[] = ["confirmation", "rappel", "anniversaire", "absence", "campagne", "transfert"];

export function isAutomatic(m: WhatsappMessage): boolean {
  return AUTOMATIC_TYPES.includes(m.origin.type);
}

/** Messages soumis au silence à chaque essai : les automatiques, et ceux de la réservation en ligne (geste de la réception ou accusé), sans la règle « sans objet ». */
export function isSilenced(m: WhatsappMessage): boolean {
  return isAutomatic(m) || m.origin.type === "en_ligne";
}

/** Débit (spec § 3, « Débit ») : `ready` pour la file, `sent` à chaque appel au fournisseur ; 2 s après un SMS (spec du 04/10/2026, § 2). */
export interface Pacer extends Throttle { sent(now: number, channel?: "whatsapp" | "sms"): void }

export function createPacer({ minMs = 4000, jitterMs = 4000, smsMs = 2000, random = Math.random }: { minMs?: number; jitterMs?: number; smsMs?: number; random?: () => number } = {}): Pacer {
  let next = 0;
  return {
    ready: (now) => now >= next,
    sent: (now, channel = "whatsapp") => { next = channel === "sms" ? Math.max(next, now + smsMs) : now + minMs + Math.floor(random() * jitterMs); },
  };
}

/** Fournisseur choisi par l'administrateur ; `null` pour « aucun ». */
export async function providerFromSettings(fetchImpl: typeof fetch = fetch): Promise<WhatsappProvider | null> {
  // Base de formation (D-17) : aucun fournisseur, même réglé ; rien ne part.
  if (estFormation()) return null;
  const choice = await getSetting<string>("whatsapp.fournisseur");
  if (choice !== "waha") return null;
  return createWaha({
    baseUrl: await getSetting<string>("waha.adresse"),
    apiKey: (await getSetting<string | null>("waha.cle")) ?? "",
    session: await getSetting<string>("waha.session"),
    fetch: fetchImpl,
  });
}

const OVER = ["cancelled", "completed", "no_show"];

/**
 * Vrai si le message automatique n'a plus lieu d'être envoyé : cliente
 * passée à « Aucun » (tous les types automatiques) ; pour une confirmation,
 * un rappel ou un transfert, rendez-vous annulé, terminé ou absente, cliente
 * changée depuis l'écriture du message, rendez-vous déplacé ou déjà passé ; pour un
 * transfert en plus, praticienne du rendez-vous qui n'est plus celle du
 * message ; pour un anniversaire,
 * relance décochée, date changée ou jour passé à Douala (message en retard) ; pour une absence, relance décochée,
 * visite depuis ou rendez-vous à venir (décision 26) ; pour ces deux relances et
 * pour une campagne, mini CRM désactivé entre-temps (interrupteur général),
 * seule condition d'une campagne. Sert à l'envoi (`createWhatsappHandler`) et à la liste
 * « À envoyer à la main » (`routes.ts`), pour qu'un message devenu faux ne
 * soit ni expédié ni montré.
 */
export async function withoutPurpose(m: WhatsappMessage, now: number): Promise<boolean> {
  const client = await get<{ channel: Channel; birthday: string }>("SELECT channel, birthday FROM clients WHERE id = ?", [m.origin.clientId ?? 0]);
  if (!client || client.channel === "none") return true;
  // Mini CRM désactivé entre-temps (interrupteur général) : relances et campagnes en file sont sans objet.
  if ((m.origin.type === "anniversaire" || m.origin.type === "absence" || m.origin.type === "campagne") && !(await crmActive())) return true;
  if (m.origin.type === "campagne") return false;
  if (m.origin.type === "anniversaire") {
    return !(await getSetting<boolean>("relances.anniversaire")) || client.birthday !== m.origin.birthday
      || !birthdaysOf(doualaDay(now)).includes(m.origin.birthday ?? "");
  }
  if (m.origin.type === "absence") return absenceOver(m, now);
  const apt = await get<{ status: string; scheduled_date: string; start_time: string; client_id: number; staff_id: number | null }>(
    "SELECT status, scheduled_date, start_time, client_id, staff_id FROM appointments WHERE id = ?", [m.origin.appointmentId ?? 0],
  );
  if (!apt || OVER.includes(apt.status)) return true;
  // La cliente du rendez-vous a changé depuis l'écriture du message : celui-ci visait l'ancienne.
  if (apt.client_id !== (m.origin.clientId ?? -1)) return true;
  // Transfert (décision 11) : transféré depuis à une autre praticienne (nouveau transfert, retour par « Déplacer »).
  if (m.origin.type === "transfert" && apt.staff_id !== (m.origin.staffId ?? -1)) return true;
  const at = appointmentAt(apt.scheduled_date, apt.start_time);
  return at !== m.origin.at || at <= now;
}

/** Relance d'absence sans objet : case décochée, dernière visite changée depuis l'écriture, ou rendez-vous à venir. */
async function absenceOver(m: WhatsappMessage, now: number): Promise<boolean> {
  if (!(await getSetting<boolean>("relances.absence"))) return true;
  const clientId = m.origin.clientId ?? 0;
  const last = await get<{ day: string | null }>("SELECT MAX(scheduled_date) AS day FROM appointments WHERE client_id = ? AND status = 'completed'", [clientId]);
  if ((last?.day ?? null) !== (m.origin.lastVisit ?? null)) return true;
  const upcoming = await get<{ id: number }>(
    "SELECT id FROM appointments WHERE client_id = ? AND status IN ('booked', 'confirmed', 'in_progress') AND scheduled_date >= ? LIMIT 1",
    [clientId, doualaDay(now)],
  );
  return Boolean(upcoming);
}

/**
 * Production du PDF d'un document au moment de l'envoi (vague 2,
 * `pdf-document.ts`) : le fichier, `"annulee"` pour une facture entièrement
 * reprise par un avoir (plus lieu de l'envoyer), `null` s'il n'existe pas.
 */
export type DocumentSource = (doc: NonNullable<WhatsappMessage["document"]>) => Promise<DocumentFile | "annulee" | null>;

/** Photo d'un produit au moment de l'envoi : `{ photo: null }` sans photo, `null` pour un produit supprimé (`readProductPhoto`). */
export type ProductPhotoSource = (id: number) => Promise<{ photo: DocumentFile | null } | null>;

const H = 3600e3;
/** Au plus 20 h après la création : la file abandonne tout envoi au bout de 24 h, le SMS doit être tenté avant. */
const LATEST_DEADLINE_MS = 20 * H;
/** Hors ligne, WhatsApp est retenté toutes les 30 s : au retour d'internet, le message part sans attendre le délai habituel. */
const OFFLINE_RETRY_MS = 30e3;

/**
 * Instant à partir duquel un message texte bloqué sur WhatsApp part par SMS
 * (spec du 04/10/2026, § 2, « Échéance ») : rendez-vous moins
 * `appointmentMinutes`, message libre création plus `freeMinutes`, et au
 * plus tard 20 h après la création.
 */
export function smsDeadline(m: WhatsappMessage, createdAt: number, s: { appointmentMinutes: number; freeMinutes: number }): number {
  const base = m.origin.at !== undefined ? m.origin.at - s.appointmentMinutes * 60e3 : createdAt + s.freeMinutes * 60e3;
  return Math.min(base, createdAt + LATEST_DEADLINE_MS);
}

/**
 * Gestionnaire des messages (sous-projet 7 § 3 ; SMS : spec du 04/10/2026,
 * § 2). Ordre : message sans objet ignoré, silence, canal de la cliente lu à
 * l'envoi (« Aucun » : seuls les messages automatiques sont ignorés, le message
 * libre, le document et le produit sont des gestes volontaires), puis WhatsApp, puis SMS
 * selon l'échec et l'échéance. Sans fournisseur SMS, rien ne change par
 * rapport au sous-projet 7. Un document ne part jamais par SMS. Un produit
 * recommandé part avec sa photo, lue au moment de l'envoi ; sans photo, comme
 * un message libre ; produit supprimé : ignoré. Une photo ne part jamais par SMS.
 */
export function createWhatsappHandler(
  deps: { provider: () => Promise<WhatsappProvider | null>; sms?: () => Promise<SmsProvider | null>; document?: DocumentSource; productPhoto?: ProductPhotoSource },
  pacer: Pacer,
) {
  const smsOf = deps.sms ?? (async () => null);
  const photoOf = deps.productPhoto ?? readProductPhoto;

  /** Envoi par SMS ; tout échec est définitif (décision 8), avec la raison de WhatsApp quand il a été tenté. */
  async function sendSms(sms: SmsProvider, m: WhatsappMessage, ctx: { id: number; now: number }, whatsappError: Error | null): Promise<void> {
    pacer.sent(ctx.now, "sms");
    try {
      await sms.sendText(m.to, m.text);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new PermanentError(whatsappError ? coded("sms.echec_apres_whatsapp", { whatsapp: whatsappError.message, sms: reason }) : reason);
    }
    await noteChannel(ctx.id, "sms");
  }

  /** Canal noté après l'envoi : jamais fatal (un envoi parti ne doit pas être retenté), jamais le texte au journal. */
  async function noteChannel(id: number, channel: "whatsapp" | "sms"): Promise<void> {
    try {
      await run("UPDATE outbox SET channel = ? WHERE id = ?", [channel, id]);
    } catch (error) {
      console.error(`Canal ${channel} non noté pour l'envoi ${id}`, error instanceof Error ? error.name : "erreur");
    }
  }

  return async (m: WhatsappMessage, ctx: { id: number; now: number; createdAt: number; online: boolean }): Promise<void> => {
    const automatic = isAutomatic(m);
    if (automatic && await withoutPurpose(m, ctx.now)) {
      // Marqué « ignoré » ; la file le passe ensuite à « envoyé » sans rien expédier.
      await run("UPDATE outbox SET manual = 'ignored' WHERE id = ?", [ctx.id]);
      return;
    }
    if (isSilenced(m)) {
      const start = await getSetting<string>("whatsapp.silence_debut");
      const end = await getSetting<string>("whatsapp.silence_fin");
      const silenceUntil = silenceEnd(ctx.now, start, end);
      // Reprise à la fin exacte du silence : le SMS de secours ne doit pas attendre les délais habituels de la file.
      if (silenceUntil !== null) throw new TemporaryError(coded("whatsapp.silence"), { retryAt: silenceUntil });
    }
    // Produit recommandé : photo lue maintenant ; produit supprimé depuis la demande, plus rien à envoyer.
    let photo: DocumentFile | null = null;
    if (m.product) {
      const found = await photoOf(m.product.id);
      if (!found) {
        await run("UPDATE outbox SET manual = 'ignored' WHERE id = ?", [ctx.id]);
        return;
      }
      photo = found.photo;
    }
    // Une pièce jointe (document ou photo) ne part jamais par SMS.
    const attachment = Boolean(m.document) || photo !== null;
    const client = await get<{ channel: Channel }>("SELECT channel FROM clients WHERE id = ?", [m.origin.clientId ?? 0]);

    if (!m.to) {
      // Sans passerelle SMS, mêmes raisons qu'avant : fournisseur WhatsApp absent d'abord, puis numéro invalide.
      if (!(await smsOf()) && !(await deps.provider())) throw new PermanentError(coded("whatsapp.sans_fournisseur"));
      throw new PermanentError(coded("whatsapp.numero_invalide"));
    }

    if (client?.channel === "sms") {
      if (m.document) throw new PermanentError(coded("sms.document_cliente_sms"));
      if (photo) throw new PermanentError(coded("sms.photo_cliente_sms"));
      const sms = await smsOf();
      if (!sms) throw new PermanentError(coded("sms.sans_fournisseur"));
      return sendSms(sms, m, ctx, null);
    }

    // WhatsApp (canal « whatsapp », ou geste volontaire pour une cliente « Aucun »).
    let whatsappError: Error | null = null;
    try {
      // Fournisseur résolu avant le contrôle d'internet : « aucun fournisseur WhatsApp » reste définitif, en ligne ou non.
      const provider = await deps.provider();
      if (!provider) throw new PermanentError(coded("whatsapp.sans_fournisseur"));
      if (!ctx.online) throw new TemporaryError(coded("whatsapp.pas_internet"));
      await sendWhatsapp(provider, m, ctx, photo);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (error instanceof IgnoredDocument) return;
      whatsappError = error;
    }
    if (!whatsappError) {
      // Hors du try : une panne de la base ici ne doit pas passer pour un échec de WhatsApp.
      await noteChannel(ctx.id, "whatsapp");
      return;
    }

    const sms = attachment ? null : await smsOf();
    if (!sms) {
      // Sans SMS possible (document, photo, ou aucun fournisseur SMS) : règles du sous-projet 7 ; hors ligne, relance rapprochée.
      if (!ctx.online && whatsappError instanceof TemporaryError) throw new TemporaryError(whatsappError.message, { retryAt: ctx.now + OFFLINE_RETRY_MS });
      throw whatsappError;
    }
    if (whatsappError.message === coded("whatsapp.numero_absent") && m.origin.clientId !== undefined) {
      // Décision 7 : la fiche passe en « SMS », au journal (système, jamais le texte), seulement si elle a changé.
      const switched = await run("UPDATE clients SET channel = 'sms' WHERE id = ? AND channel = 'whatsapp'", [m.origin.clientId]);
      if (Number(switched.changes) > 0) await logAudit({ accountId: null, action: "cliente.canal_sms", target: String(m.origin.clientId), now: ctx.now });
    }
    if (whatsappError instanceof PermanentError) return sendSms(sms, m, ctx, whatsappError);
    const due = smsDeadline(m, ctx.createdAt, {
      appointmentMinutes: await getSetting<number>("sms.delai_rendez_vous_minutes"),
      freeMinutes: await getSetting<number>("sms.delai_libre_minutes"),
    });
    if (ctx.now >= due) return sendSms(sms, m, ctx, whatsappError);
    throw new TemporaryError(whatsappError.message, { retryAt: ctx.online ? due : Math.min(due, ctx.now + OFFLINE_RETRY_MS) });
  };

  /** Envoi par WhatsApp, tel qu'au sous-projet 7 ; « aucun fournisseur » est une erreur définitive. */
  async function sendWhatsapp(provider: WhatsappProvider, m: WhatsappMessage, ctx: { id: number; now: number }, photo: DocumentFile | null): Promise<void> {
    if (photo) {
      // Photo vue comme une photo par la cliente (`sendImage`), sinon en fichier comme un ticket.
      const send = provider.sendImage ?? provider.sendDocument;
      if (!send) throw new PermanentError(coded("whatsapp.photo_non_prise"));
      pacer.sent(ctx.now);
      await send.call(provider, m.to, photo, m.text);
      return;
    }
    if (m.document) {
      // Le PDF est produit maintenant, jamais gardé dans la file (spec § 3) ; l'API Meta (vague 3) n'a pas encore d'envoi de document.
      if (!provider.sendDocument) throw new PermanentError(coded("whatsapp.document_non_pris"));
      const file = deps.document ? await deps.document(m.document) : null;
      if (file === "annulee") {
        await run("UPDATE outbox SET manual = 'ignored' WHERE id = ?", [ctx.id]);
        throw new IgnoredDocument();
      }
      if (!file) throw new PermanentError(coded("whatsapp.document_introuvable"));
      pacer.sent(ctx.now);
      await provider.sendDocument(m.to, file, m.text);
      return;
    }
    pacer.sent(ctx.now);
    await provider.sendText(m.to, m.text);
  }
}

/** Facture entièrement reprise par un avoir : marquée « ignorée », rien à envoyer ni à relancer. */
class IgnoredDocument extends Error {}
