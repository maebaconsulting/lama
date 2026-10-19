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
import { saleTotals, type DiscountKind, type DiscountReason, type Totals } from "../../shared/caisse.ts";
import { entierMineur } from "../../shared/montants.ts";
import { QUANTITE_MAX } from "../../shared/supplements.ts";

/** Supplément d'une prestation du ticket (spec du 18/10/2026 § 3.4) ; le libre porte son libellé et son prix saisis. */
export interface TicketSupplement {
  kind: "service" | "product" | "libre";
  ref_id: number | null;
  quantity: number;
  label?: string;
  price?: number;
}

export interface TicketLine {
  kind: "service" | "product";
  ref_id: number;
  quantity: number;
  /** Praticienne d'une prestation (celle du rendez-vous par défaut) ; toujours `null` pour un produit. */
  staff_id: number | null;
  /** Suppléments d'une prestation, dans l'ordre ; absent sans supplément. */
  supplements?: TicketSupplement[];
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

/** Nombre d'articles : somme des quantités, suppléments compris (barre « Ticket » du téléphone). */
export function itemCount(t: Ticket): number {
  return t.lines.reduce((sum, l) => sum + l.quantity + (l.supplements ?? []).reduce((n, s) => n + s.quantity, 0), 0);
}

/** La cliente est obligatoire dès qu'une prestation est au ticket (§ 4.1). */
export function needsClient(t: Ticket): boolean {
  return t.client_id === null && t.lines.some((l) => l.kind === "service");
}

/** Quantité d'un produit déjà au ticket, en ligne seule ou en supplément (badge de la tuile, limite du stock). */
export function quantityOf(t: Ticket, productId: number): number {
  return t.lines.reduce((sum, l) => sum
    + (l.kind === "product" && l.ref_id === productId ? l.quantity : 0)
    + (l.supplements ?? []).filter((s) => s.kind === "product" && s.ref_id === productId).reduce((n, s) => n + s.quantity, 0), 0);
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

/** − et + d'une ligne de produit : jamais au-delà du stock, restant après le même produit en supplément ; à zéro, la ligne part. */
export function setQuantity(t: Ticket, index: number, quantity: number, stock = Infinity): Ticket {
  if (quantity <= 0) return removeLine(t, index);
  const line = t.lines[index];
  const others = line?.kind === "product" ? quantityOf(t, line.ref_id) - line.quantity : 0;
  // Le plafond ne freine que l'augmentation : une réduction passe toujours (stock baissé sous la quantité).
  const q = line && quantity <= line.quantity ? quantity : Math.min(quantity, stock - others);
  if (q < 1) return t;
  const lines = t.lines.map((l, i) => (i === index ? { ...l, quantity: q } : l));
  return { ...t, lines };
}

export function removeLine(t: Ticket, index: number): Ticket {
  return { ...t, lines: t.lines.filter((_, i) => i !== index) };
}

export function setLineStaff(t: Ticket, index: number, staffId: number | null): Ticket {
  return { ...t, lines: t.lines.map((l, i) => (i === index && l.kind === "service" ? { ...l, staff_id: staffId } : l)) };
}

/** Prix d'un supplément libre, entier et positif ou nul : le même à l'écran et dans la vente envoyée. */
function librePrice(s: TicketSupplement): number {
  const p = s.price ?? 0;
  return Number.isFinite(p) ? Math.max(Math.round(p), 0) : 0;
}

/** Remplace les suppléments de la ligne `index` (une prestation). */
function withSupplements(t: Ticket, index: number, supplements: TicketSupplement[]): Ticket {
  return { ...t, lines: t.lines.map((l, i) => (i === index ? { ...l, supplements } : l)) };
}

/**
 * « + Supplément » sur une prestation (spec § 3.4) : une prestation en supplément une fois ;
 * un produit s'additionne sans dépasser `stock` (ticket entier) ; un supplément libre a sa ligne.
 * Jamais sous un produit.
 */
export function addSupplement(t: Ticket, index: number, sup: TicketSupplement, stock = Infinity): Ticket {
  const line = t.lines[index];
  if (!line || line.kind !== "service") return t;
  const list = line.supplements ?? [];
  if (sup.kind !== "libre") {
    const at = list.findIndex((s) => s.kind === sup.kind && s.ref_id === sup.ref_id);
    if (at >= 0) return sup.kind === "service" ? t : setSupplementQuantity(t, index, at, list[at].quantity + 1, stock);
  }
  const left = sup.kind === "product" ? stock - quantityOf(t, sup.ref_id!) : Infinity;
  const quantity = sup.kind === "product" ? Math.min(Math.max(sup.quantity, 1), QUANTITE_MAX, left) : 1;
  if (quantity < 1) return t;
  return withSupplements(t, index, [...list, { ...sup, quantity }]);
}

/** Quantité d'un produit en supplément : jamais au-delà du stock restant ni de 99 ; à zéro, il part. */
export function setSupplementQuantity(t: Ticket, index: number, supIndex: number, quantity: number, stock = Infinity): Ticket {
  if (quantity <= 0) return removeSupplement(t, index, supIndex);
  const list = t.lines[index]?.supplements ?? [];
  const s = list[supIndex];
  if (!s || s.kind !== "product") return t;
  const others = quantityOf(t, s.ref_id!) - s.quantity;
  const q = quantity <= s.quantity ? quantity : Math.min(quantity, QUANTITE_MAX, stock - others);
  if (q < 1) return t;
  return withSupplements(t, index, list.map((x, i) => (i === supIndex ? { ...x, quantity: q } : x)));
}

export function removeSupplement(t: Ticket, index: number, supIndex: number): Ticket {
  const list = t.lines[index]?.supplements ?? [];
  return withSupplements(t, index, list.filter((_, i) => i !== supIndex));
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

/** Ticket pré-rempli par un rendez-vous (§ 4.1) : ses prestations et leurs suppléments, sa cliente, sa praticienne. */
export function fromAppointment(apt: Appointment, requestId: string = newRequestId()): Ticket {
  const lines = (apt.appointment_services ?? []).map((s): TicketLine => {
    const line: TicketLine = { kind: "service", ref_id: s.service_id, quantity: 1, staff_id: apt.staff_id };
    const supplements = (s.supplements ?? []).map((x): TicketSupplement => (x.kind === "libre"
      ? { kind: "libre", ref_id: null, quantity: 1, label: x.label_fr, price: x.price ?? 0 }
      : { kind: x.kind, ref_id: x.ref_id, quantity: x.quantity }));
    return supplements.length ? { ...line, supplements } : line;
  });
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

/** Supplément au prix du catalogue chargé (le libre au prix saisi). */
export interface PricedSupplement {
  /** Place sous sa prestation. */
  index: number;
  supplement: TicketSupplement;
  label: string;
  unit_price: number;
  line_total: number;
  /** Stock d'un produit (limite du +) ; `null` sinon. */
  stock: number | null;
  /** Article retiré du catalogue depuis l'ouverture du ticket. */
  missing: boolean;
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
  /** Suppléments d'une prestation, au prix du catalogue chargé. */
  supplements: PricedSupplement[];
}

/** Lignes au prix du catalogue chargé, et totaux calculés comme le serveur (§ 4.4). */
export function priceTicket(
  t: Ticket,
  catalog: { services: Service[]; products: Product[] },
  vat: { active: boolean; rate: number },
  lang: Lang,
): { lines: PricedLine[]; totals: Totals; missing: boolean } {
  const priceSupplement = (s: TicketSupplement, index: number): PricedSupplement => {
    if (s.kind === "libre") {
      const unit = librePrice(s);
      return { index, supplement: s, label: s.label ?? "", unit_price: unit, line_total: unit, stock: null, missing: false };
    }
    const svc = s.kind === "service" ? catalog.services.find((x) => x.id === s.ref_id) : undefined;
    const prod = s.kind === "product" ? catalog.products.find((x) => x.id === s.ref_id) : undefined;
    const item = svc ?? prod;
    const unit = entierMineur(item?.price);
    return { index, supplement: s, label: item ? pickText(lang, item.name, item.name_en) : "", unit_price: unit, line_total: unit * s.quantity, stock: prod ? prod.stock : null, missing: !item };
  };
  const lines = t.lines.map((line, index): PricedLine => {
    const service = line.kind === "service" ? catalog.services.find((s) => s.id === line.ref_id) : undefined;
    const product = line.kind === "product" ? catalog.products.find((p) => p.id === line.ref_id) : undefined;
    const item = service ?? product;
    const unit = entierMineur(item?.price);
    return {
      index,
      line,
      label: item ? pickText(lang, item.name, item.name_en) : "",
      detail: service ? String(service.duration) : product?.brand ?? "",
      unit_price: unit,
      line_total: unit * line.quantity,
      stock: product ? product.stock : null,
      missing: !item,
      supplements: (line.supplements ?? []).map(priceSupplement),
    };
  });
  const amounts = lines.flatMap((l) => [
    { unit_price: l.unit_price, quantity: l.line.quantity },
    ...l.supplements.map((s) => ({ unit_price: s.unit_price, quantity: s.supplement.quantity })),
  ]);
  const totals = saleTotals({ lines: amounts, discount: t.discount, vat, tip: t.tip?.amount ?? 0 });
  return { lines, totals, missing: lines.some((l) => l.missing || l.supplements.some((s) => s.missing)) };
}

/** Lignes envoyées : chaque prestation suivie de ses suppléments, rattachés par `parent` (indice de la prestation) ; jamais de prix sauf pour un libre. */
function saleLines(t: Ticket): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const l of t.lines) {
    const parent = out.length;
    out.push({ kind: l.kind, ref_id: l.ref_id, quantity: l.quantity, staff_id: l.staff_id });
    for (const s of l.supplements ?? []) {
      out.push(s.kind === "libre"
        ? { kind: "libre", label: (s.label ?? "").trim(), unit_price: librePrice(s), quantity: 1, staff_id: l.staff_id, parent }
        : { kind: s.kind, ref_id: s.ref_id, quantity: s.quantity, staff_id: l.staff_id, parent });
    }
  }
  return out;
}

/** Corps de `POST /api/sales`, sans les versements. */
export function saleBody(t: Ticket) {
  return {
    request_id: t.request_id,
    client_id: t.client_id,
    appointment_id: t.appointment_id,
    lines: saleLines(t),
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
