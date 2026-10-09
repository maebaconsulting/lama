/**
 * Routes WhatsApp (sous-projet 7 § 3 et § 4). Le navigateur ne parle jamais à
 * WAHA : état, démarrage, déconnexion et QR code passent par lama. Droits dans
 * `auth/permissions.ts` : état pour l'administrateur, la gérante et la
 * réception ; session et QR pour l'administrateur et la gérante ; textes pour
 * la gérante ; « À envoyer à la main » et message libre pour la réception et
 * la gérante, jamais l'administrateur (le texte des messages ne lui est pas montré).
 */
import { randomUUID } from "node:crypto";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { get, query, run } from "@clawnify/db";
import { clientIp, currentAccount } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { coded, localize, msg, type Lang } from "../messages.ts";
import { isOnline } from "../outbox/connectivity.ts";
import { enqueue, OFFLINE_DELAY_MS, OPENED_BY_HAND } from "../outbox/outbox.ts";
import { IMAGE_VERSION_SQL } from "../produits/images.ts";
import { getSetting } from "../settings.ts";
import { isAutomatic, providerFromSettings, WHATSAPP_KIND, withoutPurpose, type WhatsappMessage } from "./envoi.ts";
import type { LinkedSession, WhatsappProvider } from "./fournisseur.ts";
import { DOCUMENT_KINDS, queueDocumentMessage, type DocumentRefusal } from "./documents.ts";
import { smsProviderFromSettings } from "../sms/passerelle.ts";
import { smsFetchOf } from "../sms/routes.ts";
import { normalizePhone } from "./numeros.ts";
import { productDraft, queueProductMessage, type ProductRefusal } from "./produit.ts";
import { readMessageSettings } from "./rendez-vous.ts";
import { DEFAULT_TEXTS, MAX_TEXT, TEMPLATE_KINDS, textSetting, type DocumentKind } from "./textes.ts";
import type { MessageKey } from "../messages.ts";
import type { StorageBinding } from "../storage.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = Context<any>;
const fetchOf = (c: Ctx): typeof fetch => c.env?.WHATSAPP_FETCH ?? fetch;

/** Coupure prolongée (défini avec la file, qui prévient les écrans quand un message y passe). */
export { OFFLINE_DELAY_MS };

/** Raison d'un échec de la passerelle (message codé), dans la langue de l'écran. */
const gatewayError = (c: Ctx, error: unknown) => c.json({ error: localize(c, error instanceof Error ? error.message : String(error)) }, 502);

const REFUSALS: Record<DocumentRefusal, [400 | 404 | 409, MessageKey]> = {
  introuvable: [404, "whatsapp.document_introuvable"],
  annulee: [409, "whatsapp.document_annule"],
  sans_cliente: [400, "whatsapp.document_sans_cliente"],
  sans_numero: [400, "whatsapp.sans_numero"],
  numero_invalide: [400, "whatsapp.numero_invalide"],
};

const PRODUCT_REFUSALS: Record<ProductRefusal, [400 | 404, MessageKey]> = {
  produit_introuvable: [404, "produit.introuvable"],
  cliente_introuvable: [404, "whatsapp.cliente_introuvable"],
  sans_numero: [400, "whatsapp.sans_numero"],
  numero_invalide: [400, "whatsapp.numero_invalide"],
};

/**
 * Identifiant entier positif lu dans l'adresse, en chiffres décimaux seulement (comme les règles `\d+` de
 * `permissions.ts`) ; 0 sinon (aucune ligne ne porte l'identifiant 0). `Number("0x1")` vaudrait 1 et
 * échapperait à la règle réservée.
 */
const idOf = (raw: string | undefined): number => (/^[1-9]\d{0,9}$/.test(raw ?? "") ? Number(raw) : 0);

/** Numéro d'un document cité par un message (`F-…`, `AV-…`, `AC-…`), vide s'il a disparu. */
async function documentNumber(doc: { kind: DocumentKind; id: number }): Promise<string> {
  const row = doc.kind === "deposit"
    ? await get<{ number: string }>("SELECT number FROM deposits WHERE id = ?", [doc.id])
    : await get<{ number: string }>("SELECT number FROM invoices WHERE id = ?", [doc.id]);
  return row?.number ?? "";
}

export function mountWhatsappRoutes(app: OpenAPIHono<any>): void { // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Fournisseur avec session liée (WAHA), ou `null`. */
  const linked = async (c: Ctx) => (await providerFromSettings(fetchOf(c))) as (WhatsappProvider & Partial<LinkedSession>) | null;

  app.get("/api/whatsapp/status", async (c) => {
    const provider = await providerFromSettings(fetchOf(c));
    if (!provider) return c.json({ provider: "aucun" });
    return c.json({ provider: "waha", ...(await provider.status()) });
  });

  const session = (command: "start" | "logout") => async (c: Ctx) => {
    const provider = await linked(c);
    if (!provider?.start || !provider.logout) return c.json({ error: msg(c, "whatsapp.pas_de_session") }, 409);
    try {
      await (command === "start" ? provider.start() : provider.logout());
    } catch (error) {
      return gatewayError(c, error);
    }
    await logAudit({ accountId: currentAccount(c).id, action: "whatsapp.session", target: command === "start" ? "demarrage" : "deconnexion", ip: clientIp(c), now: nowOf(c) });
    return c.json({ ok: true });
  };
  app.post("/api/whatsapp/session/start", session("start"));
  app.post("/api/whatsapp/session/logout", session("logout"));

  app.get("/api/whatsapp/qr", async (c) => {
    const provider = await linked(c);
    if (!provider?.qr) return c.json({ error: msg(c, "whatsapp.pas_de_session") }, 409);
    try {
      const { mimetype, data } = await provider.qr();
      return c.json({ image: `data:${mimetype};base64,${data}` });
    } catch (error) {
      return gatewayError(c, error);
    }
  });

  app.get("/api/whatsapp/texts", async (c) => {
    const texts = [];
    for (const kind of TEMPLATE_KINDS) {
      for (const lang of ["fr", "en"] as const) {
        const key = textSetting(kind, lang);
        texts.push({ key, kind, lang, value: await getSetting<string>(key), default: DEFAULT_TEXTS[kind][lang] });
      }
    }
    return c.json({ texts });
  });

  // Messages en échec définitif, ou déjà relancés en vain (session tombée, passerelle injoignable), hors fenêtre
  // de silence ; un message automatique devenu sans objet (rappel, confirmation, relance, campagne ; rendez-vous annulé, déplacé, passé, cliente
  // décochée ou changée) n'est pas montré (`withoutPurpose`, même contrôle qu'à l'envoi). Vague 2 : file hors
  // ligne, un message jamais essayé encore en attente 30 min après son premier essai prévu (« Pas d'internet ») ;
  // de retour en ligne, la file s'en charge et il quitte la liste (et tout à fait une fois parti). Avec une
  // passerelle SMS réglée, un message texte encore en attente n'y figure pas : le SMS le reprend à son échéance.
  app.get("/api/whatsapp/manual", async (c) => {
    const now = nowOf(c);
    const online: () => boolean = c.env?.ONLINE ?? isOnline;
    const offlineSince = online() ? -1 : now - OFFLINE_DELAY_MS;
    const rows = await query<{ id: number; payload: string; status: string; attempts: number; last_error: string; created_at: number }>(
      `SELECT id, payload, status, attempts, last_error, created_at FROM outbox
        WHERE kind = ? AND manual = '' AND (status = 'failed' OR (status = 'pending' AND attempts > 0 AND last_error <> '@whatsapp.silence')
              OR (status = 'pending' AND attempts = 0 AND next_attempt_at <= ?))
        ORDER BY created_at DESC, id DESC LIMIT 200`,
      [WHATSAPP_KIND, offlineSince],
    );
    // Passerelle SMS réglée : un message texte encore en attente sera repris par le SMS à son échéance.
    const smsReady = (await smsProviderFromSettings(smsFetchOf(c))) !== null;
    const items = [];
    for (const row of rows) {
      let m: WhatsappMessage;
      try {
        m = JSON.parse(row.payload) as WhatsappMessage;
      } catch {
        continue;
      }
      if (m.origin.at !== undefined && m.origin.at <= now) continue;
      // Produit recommandé (images des produits) : supprimé depuis, plus rien à envoyer ; sinon son nom et la version de sa photo.
      let product: { id: number; name: string; image_version: number | null } | undefined;
      if (m.product) {
        const found = await get<{ name: string; image_version: number | null }>(`SELECT p.name, ${IMAGE_VERSION_SQL} FROM products p WHERE p.id = ?`, [m.product.id]);
        if (!found) continue;
        product = { id: m.product.id, name: found.name, image_version: found.image_version };
      }
      // Passerelle SMS réglée : un message texte encore en attente sera repris par le SMS à son échéance (spec du 04/10/2026,
      // ajustement 6) ; un document ou une photo ne part jamais par SMS, il reste montré.
      const attachment = Boolean(m.document) || (product !== undefined && product.image_version !== null);
      if (smsReady && row.status === "pending" && !attachment) continue;
      // Même contrôle de pertinence qu'à l'envoi (`withoutPurpose`) : un message automatique devenu faux
      // (rendez-vous annulé, déplacé, cliente décochée ou changée) n'est pas montré. Le message libre reste affiché.
      const automatic = isAutomatic(m);
      if (automatic && (await withoutPurpose(m, now))) continue;
      const client = await get<{ name: string }>("SELECT name FROM clients WHERE id = ?", [m.origin.clientId ?? 0]);
      // Ticket, avoir ou reçu (vague 2) : de quoi télécharger le PDF, que la réception joint elle-même dans WhatsApp.
      const document = m.document ? { ...m.document, number: await documentNumber(m.document) } : undefined;
      items.push({
        id: row.id, type: m.origin.type, client_id: m.origin.clientId ?? null, client_name: client?.name ?? "", ...(document ? { document } : {}), ...(product ? { product } : {}),
        created_at: row.created_at, reason: localize(c, row.status === "pending" && row.attempts === 0 ? coded("whatsapp.pas_internet") : row.last_error), to: m.to, text: m.text,
      });
    }
    return c.json({ items });
  });

  // « Ouvrir WhatsApp » sur un message encore en attente (vague 2, « pas de double envoi ») : l'envoi
  // automatique est suspendu avant que l'écran n'ouvre WhatsApp. Passage atomique de « en attente » à « échec »
  // (raison « Ouvert pour un envoi à la main ») : la file ne prend que les envois en attente, et sa réservation est elle
  // aussi conditionnelle, donc l'un des deux seulement l'emporte. Déjà réservé par la file : 409, l'écran
  // n'ouvre rien. Déjà en échec : rien à suspendre. Le message reste dans la liste jusqu'à « Marquer comme
  // envoyé » ou « Ignorer ».
  app.post("/api/whatsapp/manual/:id/open", async (c) => {
    const id = idOf(c.req.param("id"));
    const suspended = await run(
      "UPDATE outbox SET status = 'failed', last_error = ? WHERE id = ? AND kind = ? AND manual = '' AND status = 'pending'",
      [OPENED_BY_HAND, id, WHATSAPP_KIND],
    );
    if (Number(suspended.changes) > 0) return c.json({ ok: true });
    const row = await get<{ status: string; manual: string }>("SELECT status, manual FROM outbox WHERE id = ? AND kind = ?", [id, WHATSAPP_KIND]);
    if (row?.status === "failed" && row.manual === "") return c.json({ ok: true });
    if (row?.status === "sending") return c.json({ error: msg(c, "whatsapp.en_cours") }, 409);
    return c.json({ error: msg(c, "whatsapp.deja_traite") }, 409);
  });

  app.post("/api/whatsapp/manual/:id", async (c) => {
    const id = idOf(c.req.param("id"));
    const { action } = (await c.req.json().catch(() => ({}))) as { action?: unknown };
    if (action !== "sent" && action !== "ignored") return c.json({ error: msg(c, "whatsapp.action_inconnue") }, 400);
    const now = nowOf(c);
    const result = await run(
      "UPDATE outbox SET status = 'sent', manual = ?, sent_at = ? WHERE id = ? AND kind = ? AND manual = '' AND status IN ('failed', 'pending')",
      [action, now, id, WHATSAPP_KIND],
    );
    if (Number(result.changes) === 0) return c.json({ error: msg(c, "whatsapp.deja_traite") }, 409);
    await logAudit({ accountId: currentAccount(c).id, action: "whatsapp.manuel", target: String(id), ip: clientIp(c), now });
    return c.json({ ok: true });
  });

  // « Envoyer par WhatsApp » sur une facture, un avoir ou un reçu d'acompte (vague 2) : geste volontaire,
  // un envoi demandé à chaque appui ; le PDF sera produit au moment de l'envoi. Journal : le numéro, jamais le texte.
  app.post("/api/whatsapp/documents", async (c) => {
    const { kind, id } = (await c.req.json().catch(() => ({}))) as { kind?: unknown; id?: unknown };
    if (!DOCUMENT_KINDS.includes(kind as DocumentKind) || !Number.isInteger(id)) return c.json({ error: msg(c, "whatsapp.document_type") }, 400);
    const settings = await readMessageSettings();
    const account = currentAccount(c);
    const now = nowOf(c);
    const result = (c.env.STORAGE as StorageBinding).transaction!((db) =>
      queueDocumentMessage(db, settings, { kind: kind as DocumentKind, id: id as number }, { now, createdBy: account.id, strict: true }));
    if (!result.ok) {
      const [status, key] = REFUSALS[result.refusal];
      return c.json({ error: msg(c, key) }, status);
    }
    await logAudit({ accountId: account.id, action: "whatsapp.document", target: result.number, ip: clientIp(c), now });
    return c.json({ ok: true });
  });

  // Message libre depuis la fiche cliente : geste volontaire, un à la fois, même sans l'accord aux envois automatiques.
  app.post("/api/clients/:id/whatsapp", async (c) => {
    const id = idOf(c.req.param("id"));
    const { text } = (await c.req.json().catch(() => ({}))) as { text?: unknown };
    const body = typeof text === "string" ? text.trim() : "";
    if (!body) return c.json({ error: msg(c, "whatsapp.texte_vide") }, 400);
    if (body.length > MAX_TEXT) return c.json({ error: msg(c, "reglage.texte_long", { max: MAX_TEXT }) }, 400);
    const client = await get<{ phone: string | null; language: string }>("SELECT phone, language FROM clients WHERE id = ?", [id]);
    if (!client) return c.json({ error: msg(c, "whatsapp.cliente_introuvable") }, 404);
    if (!(client.phone ?? "").trim()) return c.json({ error: msg(c, "whatsapp.sans_numero") }, 400);
    const to = normalizePhone(client.phone ?? "", await getSetting<string>("whatsapp.indicatif"));
    if (!to) return c.json({ error: msg(c, "whatsapp.numero_invalide") }, 400);
    const lang: Lang = client.language === "fr" || client.language === "en" ? client.language : (await getSetting<string>("institut.langue")) === "en" ? "en" : "fr";
    const account = currentAccount(c);
    const now = nowOf(c);
    const message: WhatsappMessage = { to, lang, text: body, origin: { type: "libre", clientId: id } };
    await enqueue({ kind: WHATSAPP_KIND, payload: message, dedupeKey: `wa:libre:${randomUUID()}`, createdBy: account.id, now });
    await logAudit({ accountId: account.id, action: "whatsapp.libre", target: String(id), ip: clientIp(c), now });
    return c.json({ ok: true });
  });

  // Produit recommandé (images des produits) : texte prérempli de la fenêtre d'envoi, mêmes refus que l'envoi.
  app.get("/api/products/:id/whatsapp", async (c) => {
    const result = await productDraft(await readMessageSettings(), idOf(c.req.param("id")), idOf(c.req.query("client_id")));
    if (!result.ok) {
      const [status, key] = PRODUCT_REFUSALS[result.refusal];
      return c.json({ error: msg(c, key) }, status);
    }
    return c.json({ text: result.draft.text, image_version: result.draft.imageVersion });
  });

  // Envoi du produit avec le texte relu : geste volontaire, un envoi par appui ; journal : le nom du produit, jamais le texte.
  app.post("/api/products/:id/whatsapp", async (c) => {
    const productId = idOf(c.req.param("id"));
    const { client_id: rawClient, text } = (await c.req.json().catch(() => ({}))) as { client_id?: unknown; text?: unknown };
    const body = typeof text === "string" ? text.trim() : "";
    if (!body) return c.json({ error: msg(c, "whatsapp.texte_vide") }, 400);
    if (body.length > MAX_TEXT) return c.json({ error: msg(c, "reglage.texte_long", { max: MAX_TEXT }) }, 400);
    const clientId = typeof rawClient === "number" && Number.isInteger(rawClient) && rawClient > 0 ? rawClient : 0;
    const result = await productDraft(await readMessageSettings(), productId, clientId);
    if (!result.ok) {
      const [status, key] = PRODUCT_REFUSALS[result.refusal];
      return c.json({ error: msg(c, key) }, status);
    }
    const account = currentAccount(c);
    const now = nowOf(c);
    await queueProductMessage(result.draft, productId, clientId, body, { now, createdBy: account.id });
    await logAudit({ accountId: account.id, action: "whatsapp.produit", target: result.draft.productName, ip: clientIp(c), now });
    return c.json({ ok: true });
  });
}
