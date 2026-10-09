/**
 * Acomptes dans la fiche d'un rendez-vous (sous-projet 5 § 6.2), sans
 * dépendance au navigateur pour être testés sous Node : qui peut encaisser un
 * acompte, le rembourser ou le garder ; formulaire d'acompte (montant,
 * versements) et formulaire de son sort, avec ce qui empêche de les envoyer.
 * Le serveur refait tous ces contrôles ; l'écran ne montre que ce qu'il
 * accepte. Chaque fonction rend un nouveau brouillon.
 */
import type { Role } from "./auth-types.ts";
import type { Deposit, SaleSettings } from "./caisse-types.ts";
import { PAYMENT_METHODS, REFERENCE_REQUIRED, type PaymentMethod, type Totals } from "../../shared/caisse.ts";
import type { Ticket } from "./ticket.ts";

export interface DepositPayment {
  method: PaymentMethod;
  amount: number;
  reference: string;
}

export interface DepositDraft {
  /** Identifiant de l'acompte, tiré à l'ouverture et gardé : un renvoi ne crée jamais un second reçu. */
  request_id: string;
  amount: number;
  payments: DepositPayment[];
}

/** Rendez-vous vu par la fiche : statut, payé ou non, prix des prestations prévues (absent pour la praticienne). */
interface AptLike {
  status: string;
  paid?: number | boolean;
  total_price?: number | null;
}

/** Acompte en attente du rendez-vous, s'il y en a un (un seul à la fois). */
export function heldDeposit(deposits: readonly Deposit[]): Deposit | null {
  return deposits.find((d) => d.status === "held") ?? null;
}

/**
 * « Encaisser un acompte » : gérante ou réception, fonction activée, rendez-vous
 * à venir (réservé ou confirmé), pas encore payé, sans acompte en attente.
 */
export function canTakeDeposit(role: Role, settings: SaleSettings | null, apt: AptLike, deposits: readonly Deposit[]): boolean {
  return (role === "manager" || role === "reception") && settings?.deposits === true
    && (apt.status === "booked" || apt.status === "confirmed") && !apt.paid && heldDeposit(deposits) === null;
}

/** « Rembourser » et « Garder » : la gérante, un acompte en attente, rendez-vous annulé ou cliente absente. */
export function canSettle(role: Role, apt: AptLike, deposit: Deposit): boolean {
  return role === "manager" && deposit.status === "held" && (apt.status === "cancelled" || apt.status === "no_show");
}

/** Le rendez-vous n'aura pas lieu et l'acompte attend : la réception le voit, sans pouvoir décider. */
export function awaitsManager(role: Role, apt: AptLike, deposit: Deposit): boolean {
  return role === "reception" && deposit.status === "held" && (apt.status === "cancelled" || apt.status === "no_show");
}

/** Formulaire vierge : montant à saisir, un versement par le premier moyen proposé. */
export function startDeposit(methods: readonly PaymentMethod[], requestId: string): DepositDraft {
  return { request_id: requestId, amount: 0, payments: [{ method: methods[0] ?? "cash", amount: 0, reference: "" }] };
}

export function setDepositAmount(draft: DepositDraft, amount: number): DepositDraft {
  return { ...draft, amount: Math.max(Math.round(amount) || 0, 0) };
}

/** Un moyen de plus, le premier des moyens proposés pas encore pris. */
export function addDepositPayment(draft: DepositDraft, methods: readonly PaymentMethod[]): DepositDraft {
  const next = methods.find((m) => !draft.payments.some((p) => p.method === m));
  return next ? { ...draft, payments: [...draft.payments, { method: next, amount: 0, reference: "" }] } : draft;
}

export function removeDepositPayment(draft: DepositDraft, index: number): DepositDraft {
  return draft.payments.length > 1 ? { ...draft, payments: draft.payments.filter((_, i) => i !== index) } : draft;
}

export function setDepositPayment(draft: DepositDraft, index: number, patch: Partial<DepositPayment>): DepositDraft {
  return { ...draft, payments: draft.payments.map((p, i) => (i === index ? { ...p, ...patch } : p)) };
}

/** Versements envoyés : un seul moyen porte tout le montant ; plusieurs, ceux qui ont un montant. */
export function depositPayments(draft: DepositDraft): DepositPayment[] {
  const list = draft.payments.length === 1 ? [{ ...draft.payments[0], amount: draft.amount }] : draft.payments.filter((p) => p.amount > 0);
  return list.map((p) => ({ ...p, reference: p.reference.trim() }));
}

/** Ce qui empêche d'encaisser : montant vide, au-delà des prestations prévues, versements qui ne l'égalent pas, référence manquante. */
export type DepositBlocker = "montant" | "plafond" | "ecart" | "reference";

export function depositBlocker(draft: DepositDraft, planned: number | null | undefined): DepositBlocker | null {
  if (draft.amount <= 0) return "montant";
  if (planned != null && draft.amount > planned) return "plafond";
  const payments = depositPayments(draft);
  if (payments.reduce((sum, p) => sum + p.amount, 0) !== draft.amount) return "ecart";
  if (payments.some((p) => REFERENCE_REQUIRED.includes(p.method) && p.reference === "")) return "reference";
  return null;
}

/** Corps de `POST /api/deposits`. */
export function depositBody(appointmentId: number, draft: DepositDraft) {
  return { request_id: draft.request_id, appointment_id: appointmentId, amount: draft.amount, payments: depositPayments(draft) };
}

/** Sort d'un acompte en cours de saisie : rembourser par un moyen (les quatre, on rend comme la cliente a payé), ou garder avec un motif. */
export interface SettleDraft {
  request_id: string;
  action: "refund" | "keep";
  method: PaymentMethod;
  reference: string;
  reason: string;
}

/** « Rembourser » propose le premier moyen de l'acompte ; « Garder », un motif vide. */
export function startSettle(deposit: Deposit, action: "refund" | "keep", requestId: string): SettleDraft {
  const first = deposit.payments.find((p) => p.amount > 0)?.method;
  return { request_id: requestId, action, method: first && PAYMENT_METHODS.includes(first) ? first : "cash", reference: "", reason: "" };
}

/** Ce qui empêche de valider : motif vide pour garder, référence manquante pour rembourser par Orange Money ou MoMo. */
export function settleBlocker(draft: SettleDraft): "motif" | "reference" | null {
  if (draft.action === "keep" && draft.reason.trim() === "") return "motif";
  if (draft.action === "refund" && REFERENCE_REQUIRED.includes(draft.method) && draft.reference.trim() === "") return "reference";
  return null;
}

/** Corps de `POST /api/deposits/:id/settle` : le remboursement porte tout le montant de l'acompte. */
export function settleBody(deposit: Deposit, draft: SettleDraft) {
  return draft.action === "keep"
    ? { request_id: draft.request_id, action: "keep", reason: draft.reason.trim() }
    : { request_id: draft.request_id, action: "refund", reason: draft.reason.trim(), refunds: [{ method: draft.method, amount: deposit.amount, reference: draft.reference.trim() }] };
}

/**
 * Acompte en attente au ticket d'un rendez-vous (§ 6.2) : versement déjà
 * reçu, il se déduit du montant à payer, comme le serveur le fera.
 * `exceeds` : l'acompte dépasse le total TTC seul, sans le pourboire (prix
 * baissé, prestation retirée), comme le refus `acompte.depasse` du serveur ;
 * l'écran le dit avant. `otherClient` (mineur 3 de la relecture finale) :
 * la cliente du ticket n'est pas celle de l'acompte (changée au ticket après
 * son encaissement) ; rien n'est déduit, comme le refus `acompte.autre_cliente`
 * du serveur (`server/caisse/vente.ts`) ; l'écran le dit avant.
 */
export function depositShare(totals: Totals, clientId: number | null, held: Pick<Deposit, "number" | "amount" | "client_id"> | null): { totals: Totals; deposit: { number: string; amount: number } | null; exceeds: boolean; otherClient: boolean } {
  if (!held) return { totals, deposit: null, exceeds: false, otherClient: false };
  if (held.client_id !== clientId) return { totals, deposit: { number: held.number, amount: held.amount }, exceeds: false, otherClient: true };
  // Correctif tâche 6 : le serveur (server/caisse/vente.ts, refus acompte.depasse) compare l'acompte
  // au total TTC seul, jamais au dû augmenté du pourboire ; l'écran refuse au même seuil.
  return { totals: { ...totals, due: Math.max(totals.due - held.amount, 0) }, deposit: { number: held.number, amount: held.amount }, exceeds: held.amount > totals.total_ttc, otherClient: false };
}

/** Vente au comptoir qui peut déduire un acompte (V1-78) : gérante ou réception, sans rendez-vous, cliente choisie, au moins une ligne, que des produits. */
export function counterDepositEligible(role: Role, t: Pick<Ticket, "appointment_id" | "client_id" | "lines">): boolean {
  return (role === "manager" || role === "reception") && t.appointment_id === null && t.client_id !== null
    && t.lines.length > 0 && t.lines.every((l) => l.kind === "product");
}

/** Acomptes de la liste qui valent pour la cliente du ticket (la liste peut être celle d'une cliente précédente, pas encore rechargée). */
function usableFor(t: Pick<Ticket, "client_id">, deposits: readonly Deposit[] | null): Deposit[] {
  return (deposits ?? []).filter((d) => d.status === "held" && d.client_id === t.client_id);
}

/**
 * Ticket aligné sur la proposition d'acompte au comptoir : retirée si la
 * vente ne s'y prête plus ; le plus ancien acompte proposé coché par défaut ;
 * un refus (case décochée) gardé ; un acompte disparu (déduit ou remboursé
 * ailleurs) remplacé par le suivant. Rend le même objet si rien ne change.
 */
export function syncCounterDeposit(t: Ticket, role: Role, deposits: readonly Deposit[] | null): Ticket {
  if (!counterDepositEligible(role, t)) return t.deposit_id === undefined ? t : { ...t, deposit_id: undefined };
  if (deposits === null || t.deposit_id === null) return t;
  const usable = usableFor(t, deposits);
  if (typeof t.deposit_id === "number" && usable.some((d) => d.id === t.deposit_id)) return t;
  const next = usable[0]?.id;
  return next === t.deposit_id ? t : { ...t, deposit_id: next };
}

/** Acompte montré dans la case « Déduire l'acompte » : celui choisi, sinon le plus ancien ; `null` si rien n'est à proposer. */
export function counterOffer(t: Ticket, role: Role, deposits: readonly Deposit[] | null): Deposit | null {
  if (!counterDepositEligible(role, t)) return null;
  const usable = usableFor(t, deposits);
  return usable.find((d) => d.id === t.deposit_id) ?? usable[0] ?? null;
}

/** Acompte effectivement déduit au comptoir (case cochée), pour `depositShare`. */
export function chosenCounterDeposit(t: Ticket, deposits: readonly Deposit[] | null): Deposit | null {
  if (t.appointment_id !== null || typeof t.deposit_id !== "number") return null;
  return usableFor(t, deposits).find((d) => d.id === t.deposit_id) ?? null;
}
