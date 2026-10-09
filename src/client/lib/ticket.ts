/**
 * Ticket en cours de l'écran « Vente » (sous-projet 5 § 4.1), sans dépendance
 * au navigateur pour être testé sous Node : lignes, cliente, remise,
 * pourboire, prix tirés du catalogue chargé (le serveur facture le prix du
 * moment, § 7) et totaux par les calculs partagés avec le serveur. Chaque
 * fonction rend un nouveau ticket, sans modifier celui reçu.
 */
import type { Lang } from "../i18n/translate.ts";
import type { Appointment, Product, Service } from "../types.ts";
import { pickText } from "./bilingual.ts";
import type { Invoice } from "./caisse-types.ts";
import { saleTotals, wholeFrancs, type DiscountKind, type DiscountReason, type Totals } from "../../shared/caisse.ts";

export interface TicketLine {
  kind: "service" | "product";
  ref_id: number;
  quantity: number;
  /** Praticienne d'une prestation (celle du rendez-vous par défaut) ; toujours `null` pour un produit. */
  staff_id: number | null;
}

export interface TicketDiscount {
  kind: DiscountKind;
  value: number;
  reason: DiscountReason;
  /** Texte du motif « Autre ». */
  note: string;
  /** Récompense fidélité (mini CRM § 2) : points du palier ; le serveur fixe la remise d'après ses paliers. */
  reward_points?: number;
}

export interface Ticket {
  /** Identifiant de la vente : la même demande renvoyée ne crée jamais une seconde facture (§ 4.2). */
  request_id: string;
  appointment_id: number | null;
  client_id: number | null;
  lines: TicketLine[];
  discount: TicketDiscount | null;
  tip: { amount: number; staff_id: number } | null;
  /**
   * Acompte déduit d'une vente au comptoir de produits seuls (V1-78) :
   * `undefined` tant qu'aucun n'est proposé, `null` si la caissière a
   * décoché la case, sinon l'acompte choisi.
   */
  deposit_id?: number | null;
}

/**
 * Identifiant de vente aléatoire (`v-` et 24 caractères hexadécimaux). Tiré de
 * `crypto.getRandomValues`, disponible aussi sur le réseau local en http
 * (`crypto.randomUUID` ne l'est qu'en https).
 */
export function newRequestId(bytes: Uint8Array = globalThis.crypto.getRandomValues(new Uint8Array(12))): string {
  return `v-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function emptyTicket(requestId: string = newRequestId()): Ticket {
  return { request_id: requestId, appointment_id: null, client_id: null, lines: [], discount: null, tip: null };
}

export function isEmpty(t: Ticket): boolean {
  return t.lines.length === 0 && t.client_id === null && t.appointment_id === null;
}

/** Nombre d'articles : somme des quantités (barre « Ticket » du téléphone). */
export function itemCount(t: Ticket): number {
  return t.lines.reduce((sum, l) => sum + l.quantity, 0);
}

/** La cliente est obligatoire dès qu'une prestation est au ticket (§ 4.1). */
export function needsClient(t: Ticket): boolean {
  return t.client_id === null && t.lines.some((l) => l.kind === "service");
}

/** Quantité d'un produit déjà au ticket (badge de la tuile, limite du stock). */
export function quantityOf(t: Ticket, productId: number): number {
  return t.lines.filter((l) => l.kind === "product" && l.ref_id === productId).reduce((sum, l) => sum + l.quantity, 0);
}

/**
 * Un toucher sur une tuile ajoute une unité (§ 4.1) : un produit s'ajoute à
 * sa ligne, sans dépasser `stock` (produit en rupture refusé) ; une prestation
 * fait une ligne à elle, avec la praticienne par défaut.
 */
export function addItem(t: Ticket, item: { kind: "service" | "product"; ref_id: number; staff_id?: number | null; stock?: number }): Ticket {
  if (item.kind === "product") {
    const stock = item.stock ?? Infinity;
    if (quantityOf(t, item.ref_id) >= stock) return t;
    const at = t.lines.findIndex((l) => l.kind === "product" && l.ref_id === item.ref_id);
    if (at >= 0) return setQuantity(t, at, t.lines[at].quantity + 1, stock);
    return { ...t, lines: [...t.lines, { kind: "product", ref_id: item.ref_id, quantity: 1, staff_id: null }] };
  }
  return { ...t, lines: [...t.lines, { kind: "service", ref_id: item.ref_id, quantity: 1, staff_id: item.staff_id ?? null }] };
}

/** − et + d'une ligne de produit : jamais au-delà du stock ; à zéro, la ligne part. */
export function setQuantity(t: Ticket, index: number, quantity: number, stock = Infinity): Ticket {
  if (quantity <= 0) return removeLine(t, index);
  const lines = t.lines.map((l, i) => (i === index ? { ...l, quantity: Math.min(quantity, stock) } : l));
  return { ...t, lines };
}

export function removeLine(t: Ticket, index: number): Ticket {
  return { ...t, lines: t.lines.filter((_, i) => i !== index) };
}

export function setLineStaff(t: Ticket, index: number, staffId: number | null): Ticket {
  return { ...t, lines: t.lines.map((l, i) => (i === index && l.kind === "service" ? { ...l, staff_id: staffId } : l)) };
}

/** Changer de cliente retire la récompense fidélité et l'acompte choisi au comptoir : ils sont ceux de la cliente choisie. */
export function setClient(t: Ticket, clientId: number | null): Ticket {
  const changed = clientId !== t.client_id;
  const dropReward = t.discount?.reward_points !== undefined && changed;
  return { ...t, client_id: clientId, discount: dropReward ? null : t.discount, deposit_id: changed ? undefined : t.deposit_id };
}

export function setDiscount(t: Ticket, discount: TicketDiscount | null): Ticket {
  return { ...t, discount };
}

/**
 * Récompense fidélité devenue intenable (relecture I1) : la fidélité n'est plus active à l'écran
 * (mini CRM désactivé, ou case de fidélité décochée) alors qu'une récompense est au ticket ; le
 * serveur la refuserait et son bouton a disparu. Rend le ticket sans elle et la cause, sinon `null`.
 * Une remise saisie au motif « Fidélité » (sans points) n'est pas une récompense : gardée.
 */
export function dropStaleReward(t: Ticket, state: { crm: boolean; loyaltyActive: boolean }): { ticket: Ticket; cause: "crm" | "fidelite" } | null {
  if (t.discount?.reward_points === undefined) return null;
  if (state.crm && state.loyaltyActive) return null;
  return { ticket: { ...t, discount: null }, cause: state.crm ? "fidelite" : "crm" };
}

/** Remise d'une récompense fidélité : montant du palier, motif « fidélité », points du palier (mini CRM § 2). */
export function rewardDiscount(tier: { points: number; montant: number }): TicketDiscount {
  return { kind: "amount", value: tier.montant, reason: "fidelite", note: "", reward_points: tier.points };
}

export function setTip(t: Ticket, tip: Ticket["tip"]): Ticket {
  return { ...t, tip: tip && tip.amount > 0 ? tip : null };
}

/** Ticket pré-rempli par un rendez-vous (§ 4.1) : ses prestations, sa cliente, sa praticienne. */
export function fromAppointment(apt: Appointment, requestId: string = newRequestId()): Ticket {
  const lines = (apt.appointment_services ?? []).map((s): TicketLine => ({ kind: "service", ref_id: s.service_id, quantity: 1, staff_id: apt.staff_id }));
  return { ...emptyTicket(requestId), appointment_id: apt.id, client_id: apt.client_id, lines };
}

/**
 * Ouverture de l'écran pour un rendez-vous : ticket vide, pré-remplissage ;
 * ticket de ce rendez-vous, on le garde ; ticket d'autre chose en cours, on
 * le garde et l'écran propose de le remplacer (rien ne se perd sans le dire).
 */
export function openFor(t: Ticket, appointmentId: number | null): "prefill" | "keep" | "conflict" {
  if (appointmentId === null || t.appointment_id === appointmentId) return "keep";
  return isEmpty(t) ? "prefill" : "conflict";
}

/** Praticienne proposée pour le pourboire : celle du rendez-vous, sinon celle de la première prestation. */
export function defaultTipStaff(t: Ticket, appointmentStaff: number | null): number | null {
  return appointmentStaff ?? t.lines.find((l) => l.kind === "service" && l.staff_id !== null)?.staff_id ?? null;
}

export interface PricedLine {
  index: number;
  line: TicketLine;
  label: string;
  /** Durée d'une prestation (minutes) ; marque d'un produit. */
  detail: string;
  unit_price: number;
  line_total: number;
  /** Stock du produit (limite du +) ; `null` pour une prestation. */
  stock: number | null;
  /** Élément retiré du catalogue depuis l'ouverture du ticket. */
  missing: boolean;
}

/** Lignes au prix du catalogue chargé, et totaux calculés comme le serveur (§ 4.4). */
export function priceTicket(
  t: Ticket,
  catalog: { services: Service[]; products: Product[] },
  vat: { active: boolean; rate: number },
  lang: Lang,
): { lines: PricedLine[]; totals: Totals; missing: boolean } {
  const lines = t.lines.map((line, index): PricedLine => {
    const service = line.kind === "service" ? catalog.services.find((s) => s.id === line.ref_id) : undefined;
    const product = line.kind === "product" ? catalog.products.find((p) => p.id === line.ref_id) : undefined;
    const item = service ?? product;
    const unit = wholeFrancs(item?.price);
    return {
      index,
      line,
      label: item ? pickText(lang, item.name, item.name_en) : "",
      detail: service ? String(service.duration) : product?.brand ?? "",
      unit_price: unit,
      line_total: unit * line.quantity,
      stock: product ? product.stock : null,
      missing: !item,
    };
  });
  const totals = saleTotals({ lines: lines.map((l) => ({ unit_price: l.unit_price, quantity: l.line.quantity })), discount: t.discount, vat, tip: t.tip?.amount ?? 0 });
  return { lines, totals, missing: lines.some((l) => l.missing) };
}

/** Corps de `POST /api/sales`, sans les versements. */
export function saleBody(t: Ticket) {
  return {
    request_id: t.request_id,
    client_id: t.client_id,
    appointment_id: t.appointment_id,
    lines: t.lines.map((l) => ({ kind: l.kind, ref_id: l.ref_id, quantity: l.quantity, staff_id: l.staff_id })),
    // Récompense : le palier seul, le serveur fixe la remise et vérifie le solde.
    discount: t.discount?.reward_points !== undefined ? { reward_points: t.discount.reward_points } : t.discount,
    tip: t.tip,
    // V1-78 : l'acompte choisi au comptoir ; un rendez-vous déduit le sien côté serveur.
    ...(t.appointment_id === null && typeof t.deposit_id === "number" ? { deposit_id: t.deposit_id } : {}),
  };
}

/**
 * Ticket, issue d'un envoi et facture émise gardés sur l'appareil (§ 4.1,
 * § 7), en mémoire de l'application, jamais dans le stockage du navigateur
 * (garde-fou `fetch-guard.test.ts`) : ils survivent au changement d'écran et
 * au verrouillage du poste (spec § 3.3, décision 1), pas au rechargement de
 * la page. Un enregistrement par compte (relecture 3 de la tâche 6) : sur un
 * poste partagé, une autre personne qui se connecte part d'un écran vierge
 * sans jamais lire ni écraser celui d'un compte précédent, qui retrouve les
 * siens intacts (ticket, `request_id`, gel, facture) à son retour, même si
 * quelqu'un d'autre a ouvert l'écran entre-temps.
 */
interface KeptSale {
  ticket: Ticket;
  /** Issue d'un envoi encore inconnue (spec § 7) : voir `keptPending`. */
  pending: boolean;
  /** Facture émise, montrée seulement sur la vente qui l'a produite : voir `keptIssued`. */
  issued: Invoice | null;
}

const kept = new Map<number | null, KeptSale>();

/** Enregistrement du compte demandé, créé vierge (sans envoi en attente ni facture) au premier accès. */
function forAccount(accountId: number | null): KeptSale {
  let k = kept.get(accountId);
  if (!k) {
    k = { ticket: emptyTicket(), pending: false, issued: null };
    kept.set(accountId, k);
  }
  return k;
}

export function keptTicket(accountId: number | null): Ticket {
  return forAccount(accountId).ticket;
}

export function keepTicket(t: Ticket | null, accountId: number | null): void {
  forAccount(accountId).ticket = t ?? emptyTicket();
}

/**
 * Issue d'un envoi encore inconnue (spec § 7, reste de la tâche 5) : une
 * demande de vente est partie (Paiement en train d'envoyer) ou une réponse
 * a pu se perdre (statut 0 ou 500 et plus). Gardée avec le ticket, hors de
 * React, pour survivre à un aller-retour sur l'écran « Vente » : tant que
 * c'est vrai, le ticket ne doit ni être modifié, ni être vidé, sous peine
 * d'une vente en double ou perdue.
 */
export function keptPending(accountId: number | null): boolean {
  return forAccount(accountId).pending;
}

export function keepPending(p: boolean, accountId: number | null): void {
  forAccount(accountId).pending = p;
}

/**
 * Facture émise gardée le temps qu'un remontage de l'écran « Vente » la
 * retrouve (spec § 7, relecture de la tâche 6) : une facture reçue pendant
 * que l'écran est quitté (rail, verrouillage) ne doit jamais disparaître
 * sans être montrée, sous peine d'une vente rejouée en double par une
 * personne qui croit, à tort, que rien n'est passé. Effacée par « Nouvelle
 * vente » ou un retour à l'accueil, comme le ticket qu'elle a remplacé.
 * Montrée seulement sur la vente qui l'a produite (relecture 2, tâche 6) :
 * `appointmentId` doit correspondre à `invoice.appointment_id` (`null` pour
 * une vente de comptoir), sans quoi elle n'est que tenue cachée, jamais
 * effacée par cette seule lecture (relecture 3) : sans cela, une facture
 * reçue au comptoir disparaîtrait sans jamais avoir été montrée dès que la
 * personne ouvre un autre rendez-vous avant de toucher « Nouvelle vente ».
 * L'effacement reste réservé à `keepIssued(null, …)`, appelé par l'écran
 * seulement à ce moment-là ou à un retour à l'accueil.
 */
export function keptIssued(accountId: number | null, appointmentId: number | null): Invoice | null {
  const k = forAccount(accountId);
  return k.issued && k.issued.appointment_id === appointmentId ? k.issued : null;
}

export function keepIssued(i: Invoice | null, accountId: number | null): void {
  forAccount(accountId).issued = i;
}
