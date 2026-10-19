/**
 * Produit recommandé par WhatsApp (images des produits, spec du 04/10/2026,
 * § 1) : texte prérempli pour une cliente (texte de la gérante, langue de la
 * cliente, prix au format des documents), puis mise en file d'un envoi qui
 * ne garde que l'identifiant du produit et le texte relu ; la photo est lue
 * au moment de l'envoi (`envoi.ts`). Geste volontaire de la réception ou de
 * la gérante, un envoi par appui.
 */
import { randomUUID } from "node:crypto";
import { get } from "@clawnify/db";
import { entierMineur, formatMontantDocument } from "../../shared/montants.ts";
import type { Lang } from "../messages.ts";
import { enqueue } from "../outbox/outbox.ts";
import { IMAGE_VERSION_SQL } from "../produits/images.ts";
import { WHATSAPP_KIND, type WhatsappMessage } from "./envoi.ts";
import { normalizePhone } from "./numeros.ts";
import type { MessageSettings } from "./rendez-vous.ts";
import { firstName, renderTemplate } from "./textes.ts";

/** Refus : produit ou cliente inconnus, cliente sans numéro, numéro impossible à normaliser. */
export type ProductRefusal = "produit_introuvable" | "cliente_introuvable" | "sans_numero" | "numero_invalide";

export interface ProductDraft {
  to: string;
  lang: Lang;
  /** Texte prérempli, variables remplacées. */
  text: string;
  /** Nom français du produit, pour le journal. */
  productName: string;
  imageVersion: number | null;
}

/** Destinataire et texte prérempli de l'envoi d'un produit à une cliente, ou la raison du refus. */
export async function productDraft(s: MessageSettings, productId: number, clientId: number): Promise<{ ok: true; draft: ProductDraft } | { ok: false; refusal: ProductRefusal }> {
  const product = await get<{ name: string; name_en: string | null; price: number; image_version: number | null }>(
    `SELECT p.name, p.name_en, p.price, ${IMAGE_VERSION_SQL} FROM products p WHERE p.id = ?`, [productId],
  );
  if (!product) return { ok: false, refusal: "produit_introuvable" };
  const client = await get<{ name: string; phone: string | null; language: string }>("SELECT name, phone, language FROM clients WHERE id = ?", [clientId]);
  if (!client) return { ok: false, refusal: "cliente_introuvable" };
  if (!(client.phone ?? "").trim()) return { ok: false, refusal: "sans_numero" };
  const to = normalizePhone(client.phone ?? "", s.indicatif);
  if (!to) return { ok: false, refusal: "numero_invalide" };
  const lang: Lang = client.language === "fr" || client.language === "en" ? client.language : s.lang;
  const name = lang === "en" && (product.name_en ?? "").trim() ? product.name_en! : product.name;
  const text = renderTemplate(s.texts.produit[lang], {
    prenom: firstName(client.name), nom: client.name.trim(), produit: name, prix: formatMontantDocument(entierMineur(product.price), lang), institut: s.institut, telephone: s.telephone,
  });
  return { ok: true, draft: { to, lang, text, productName: product.name, imageVersion: product.image_version } };
}

/** Met en file l'envoi du produit avec le texte relu ; clé unique : un envoi par appui. */
export async function queueProductMessage(draft: ProductDraft, productId: number, clientId: number, text: string, opts: { now: number; createdBy: number }): Promise<void> {
  const message: WhatsappMessage = { to: draft.to, lang: draft.lang, text, product: { id: productId }, origin: { type: "produit", clientId } };
  await enqueue({ kind: WHATSAPP_KIND, payload: message, dedupeKey: `wa:produit:${productId}:${randomUUID()}`, createdBy: opts.createdBy, now: opts.now });
}
