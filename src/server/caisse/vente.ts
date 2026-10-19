/**
 * Vente et émission d'une facture (sous-projet 5 § 3.2, § 4.4) : lecture de la
 * demande, prix du catalogue au moment de l'émission, contrôle des versements,
 * puis écriture de la facture, de ses lignes, versements, pourboire et
 * mouvements de stock dans une seule transaction, numéro compris ; l'acompte
 * en attente du rendez-vous y est déduit (vague 3b). Fonctions
 * synchrones sur la base (`Database`) : appelées dans
 * `StorageBinding.transaction`, rien ne peut s'intercaler, et toute erreur
 * annule tout.
 */
import type { Database } from "../storage.ts";
import { coded, MessageError, montant, type MessageKey, type Values } from "../messages.ts";
import {
  DISCOUNT_REASONS, PAYMENT_METHODS, REFERENCE_REQUIRED, documentNumber, exceedsCap, saleTotals, yearAt,
  type DiscountKind, type DiscountReason, type PaymentMethod, type SettledPayment, type Totals,
} from "../../shared/caisse.ts";
import { entierMineur } from "../../shared/montants.ts";
import { libreProblem } from "../../shared/supplements.ts";
import { applyDeposit, counterDeposit, heldDeposit } from "./acompte.ts";
import { invoicePrefixForIssue } from "./prefixe.ts";
import { loyaltyBalance, recordSaleLoyalty, type LoyaltySettings } from "../crm/fidelite.ts";
import { dernierDocument, heureRecule, instantDouala } from "../heure/garde.ts";

/** Refus d'une vente ou d'un avoir : message du dictionnaire, statut HTTP et champs ajoutés à la réponse (`code`, `due`). */
export class SaleError extends MessageError {
  readonly status: 400 | 403 | 404 | 409;
  readonly extra: Record<string, unknown>;

  constructor(status: 400 | 403 | 404 | 409, key: MessageKey, values: Values = {}, extra: Record<string, unknown> = {}) {
    super(key, values);
    this.name = "SaleError";
    this.status = status;
    this.extra = extra;
  }
}

/** Réglages de la caisse lus au moment de l'émission (spec § 5.2, défauts de la vague 1). */
export interface SaleSettings {
  vat: { active: boolean; rate: number };
  discounts: boolean;
  discountCap: number;
  tips: boolean;
  methods: PaymentMethod[];
  /** Fidélité (mini CRM § 2) : absente, elle est inactive. */
  loyalty?: LoyaltySettings;
}

export interface SaleLineRequest {
  kind: "service" | "product" | "libre";
  /** Article du catalogue ; `null` pour un supplément libre. */
  ref_id: number | null;
  quantity: number;
  /** Praticienne d'une prestation (celle du rendez-vous par défaut) ; un supplément prend celle de sa prestation. */
  staff_id: number | null;
  /** Supplément (spec du 18/10/2026 § 3.4) : indice, dans `lines`, de la prestation à laquelle il est rattaché ; `null` pour une ligne seule. */
  parent: number | null;
  /** Supplément libre : libellé et prix saisis, contrôlés par `parseSaleRequest` ; absents pour un article du catalogue. */
  label?: string;
  unit_price?: number;
}

export interface SaleRequest {
  request_id: string;
  client_id: number | null;
  appointment_id: number | null;
  /** Acompte à déduire d'une vente au comptoir de produits seuls (V1-78) ; jamais avec un rendez-vous, qui déduit le sien. */
  deposit_id?: number | null;
  lines: SaleLineRequest[];
  discount: { kind: DiscountKind; value: number; reason: DiscountReason; note: string } | null;
  /**
   * Récompense fidélité (mini CRM § 2, décision 14) : points du palier choisi,
   * envoyés par l'écran dans `discount.reward_points` à la place d'une remise
   * saisie ; `discount` reste alors `null`, la remise est fixée par le serveur.
   */
  reward_points?: number | null;
  tip: { amount: number; staff_id: number } | null;
  payments: { method: PaymentMethod; amount: number; reference: string; cash_given: number | null }[];
}

export interface PricedLine extends SaleLineRequest {
  label_fr: string;
  label_en: string;
  unit_price: number;
  line_total: number;
}

export interface PricedSale {
  lines: PricedLine[];
  totals: Totals;
  /** Remise appliquée : celle saisie, ou celle du palier de fidélité. */
  discount: SaleRequest["discount"];
  /** Points du palier de fidélité dépensés (0 sans récompense). */
  rewardPoints: number;
  /** Motif inscrit sur la facture : `fidelite`, `geste`, ou `autre:` suivi du texte saisi. */
  discountReason: string;
  /** Remise au-delà du plafond réglé : le mot de passe d'une gérante est demandé. */
  overCap: boolean;
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= 1_000_000_000;
const invalid = (key: MessageKey, values?: Values) => new SaleError(400, key, values);

/** Lit et vérifie la forme de la demande (`POST /api/sales`) ; lève une `SaleError` 400 sinon. */
export function parseSaleRequest(input: unknown): SaleRequest {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (typeof body.request_id !== "string" || !REQUEST_ID.test(body.request_id)) throw invalid("vente.requete");
  const optionalId = (v: unknown) => (v === undefined || v === null ? null : isId(v) ? v : undefined);
  const client_id = optionalId(body.client_id);
  const appointment_id = optionalId(body.appointment_id);
  if (client_id === undefined) throw invalid("vente.cliente_inconnue");
  if (appointment_id === undefined) throw invalid("vente.rdv_inconnu");
  if (!Array.isArray(body.lines) || body.lines.length === 0) throw invalid("vente.lignes");
  if (body.lines.length > 100) throw invalid("vente.ligne_invalide");
  const lines = body.lines.map((raw, index): SaleLineRequest => {
    const l = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const staff = optionalId(l.staff_id);
    // Supplément (spec § 3.4) : `parent` désigne une ligne plus haut du ticket, jamais une ligne qui suit.
    const parent = l.parent === undefined || l.parent === null ? null
      : Number.isInteger(l.parent) && (l.parent as number) >= 0 && (l.parent as number) < index ? (l.parent as number) : undefined;
    if (parent === undefined || staff === undefined || !isCount(l.quantity)) throw invalid("vente.ligne_invalide");
    if (l.kind === "libre") {
      if (parent === null) throw invalid("vente.supplement_parent");
      const problem = libreProblem({ label: l.label, price: l.unit_price, minutes: 0 });
      if (problem) throw invalid(problem);
      if (l.quantity !== 1) throw invalid("vente.ligne_invalide");
      return { kind: "libre", ref_id: null, quantity: 1, staff_id: null, parent, label: (l.label as string).trim(), unit_price: l.unit_price as number };
    }
    if ((l.kind !== "service" && l.kind !== "product") || !isId(l.ref_id)) throw invalid("vente.ligne_invalide");
    // Une prestation en supplément compte une fois.
    if (parent !== null && l.kind === "service" && l.quantity !== 1) throw invalid("vente.ligne_invalide");
    return { kind: l.kind, ref_id: l.ref_id, quantity: l.quantity, staff_id: l.kind === "service" && parent === null ? staff : null, parent };
  });
  // Un supplément suit une prestation seule (jamais un produit ni un autre supplément) et prend sa praticienne.
  for (const line of lines) {
    if (line.parent === null) continue;
    const parent = lines[line.parent];
    if (parent.kind !== "service" || parent.parent !== null) throw invalid("vente.supplement_parent");
    line.staff_id = parent.staff_id;
  }
  const deposit_id = optionalId(body.deposit_id);
  if (deposit_id === undefined) throw invalid("acompte.introuvable");
  // V1-78 : un rendez-vous déduit son propre acompte ; au comptoir, seulement une vente de produits.
  if (deposit_id !== null && (appointment_id !== null || lines.some((l) => l.kind !== "product"))) throw invalid("vente.acompte_comptoir");
  let discount: SaleRequest["discount"] = null;
  let reward_points: number | null = null;
  if (body.discount !== null && typeof body.discount === "object" && "reward_points" in body.discount) {
    // Récompense fidélité : le palier choisi seul ; montant et motif sont fixés par le serveur (`priceSale`).
    const points = (body.discount as Record<string, unknown>).reward_points;
    if (!isId(points) || points > 100_000) throw invalid("vente.remise_invalide");
    reward_points = points;
  } else if (body.discount !== undefined && body.discount !== null) {
    const d = (typeof body.discount === "object" ? body.discount : {}) as Record<string, unknown>;
    const value = d.value;
    const kindOk = (d.kind === "percent" && isId(value) && value <= 100) || (d.kind === "amount" && isCount(value));
    if (!kindOk) throw invalid("vente.remise_invalide");
    if (!DISCOUNT_REASONS.includes(d.reason as DiscountReason)) throw invalid("vente.remise_motif");
    const note = typeof d.note === "string" ? d.note.trim() : "";
    if (d.reason === "autre" && (note === "" || note.length > 120)) throw invalid("vente.remise_motif");
    discount = { kind: d.kind as DiscountKind, value: value as number, reason: d.reason as DiscountReason, note: d.reason === "autre" ? note : "" };
  }
  let tip: SaleRequest["tip"] = null;
  if (body.tip !== undefined && body.tip !== null) {
    const p = (typeof body.tip === "object" ? body.tip : {}) as Record<string, unknown>;
    if (!isCount(p.amount) || !isId(p.staff_id)) throw invalid("vente.pourboire_invalide");
    tip = { amount: p.amount, staff_id: p.staff_id };
  }
  // Retouche C (décision du 30/09/2026) : un tableau vide est une forme valable, une vente dont le dû
  // tombe à 0 s'émet sans aucun versement ; `checkPayments` refuse ensuite tout dû non couvert exactement.
  if (!Array.isArray(body.payments) || body.payments.length > 20) throw invalid("vente.versement_invalide");
  const payments = body.payments.map((raw) => {
    const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (!PAYMENT_METHODS.includes(p.method as PaymentMethod) || !isCount(p.amount)) throw invalid("vente.versement_invalide");
    const reference = typeof p.reference === "string" ? p.reference.trim() : "";
    if (reference.length > 64) throw invalid("vente.versement_invalide");
    const given = p.cash_given === undefined || p.cash_given === null ? null : p.cash_given;
    if (given !== null && (p.method !== "cash" || !isCount(given) || given < (p.amount as number))) throw invalid("vente.versement_invalide");
    return { method: p.method as PaymentMethod, amount: p.amount as number, reference, cash_given: given as number | null };
  });
  return { request_id: body.request_id, client_id, appointment_id, deposit_id, lines, discount, reward_points, tip, payments };
}

type Row = Record<string, unknown>;
const one = (db: Database, sql: string, ...params: (string | number | null)[]) => db.prepare(sql).get(...params) as Row | undefined;

/**
 * Prix de la vente d'après le catalogue au moment de l'appel (§ 7 : le prix
 * de l'émission fait foi), remise, TVA et pourboire ; vérifie les références
 * (prestations, produits, praticiennes, cliente, rendez-vous) et les réglages.
 */
export function priceSale(db: Database, req: SaleRequest, settings: SaleSettings): PricedSale {
  const lines = req.lines.map((line): PricedLine => {
    // Supplément libre : libellé et prix saisis, seuls montants que le serveur reçoit de l'appareil (spec § 3.4).
    if (line.kind === "libre") {
      const unit = line.unit_price ?? 0;
      return { ...line, label_fr: line.label ?? "", label_en: "", unit_price: unit, line_total: unit * line.quantity };
    }
    const row = line.kind === "service"
      ? one(db, "SELECT name, name_en, price, supplement_seulement FROM services WHERE id = ?", line.ref_id)
      : one(db, "SELECT name, name_en, price FROM products WHERE id = ?", line.ref_id);
    if (!row) throw invalid(line.kind === "service" ? "vente.prestation_inconnue" : "vente.produit_inconnu", { id: line.ref_id ?? 0 });
    // « Supplément seulement » : jamais vendue seule (spec § 3.1), sauf depuis un rendez-vous pris
    // avant le changement de la case, qui la porte comme prestation et doit rester encaissable (rendez-vous de la même cliente).
    if (line.kind === "service" && line.parent === null && Number(row.supplement_seulement) === 1) {
      const portee = req.appointment_id !== null && one(db,
        `SELECT 1 AS x FROM appointment_services aps JOIN appointments a ON a.id = aps.appointment_id
          WHERE aps.appointment_id = ? AND aps.service_id = ? AND a.client_id IS ?`, req.appointment_id, line.ref_id, req.client_id);
      if (!portee) throw invalid("vente.supplement_seul", { nom: String(row.name) });
    }
    // Prestation en supplément : mêmes refus qu'à la prise de rendez-vous (jamais elle-même, jamais en cascade),
    // sauf pour un supplément déjà porté par le rendez-vous, pris avant que la prestation reçoive sa liste.
    if (line.kind === "service" && line.parent !== null) {
      if (line.ref_id === req.lines[line.parent].ref_id) throw invalid("supplement.lui_meme");
      const portee = req.appointment_id !== null && one(db,
        `SELECT 1 AS x FROM appointment_supplements s JOIN appointment_services aps ON aps.id = s.appointment_service_id
          JOIN appointments a ON a.id = aps.appointment_id
          WHERE aps.appointment_id = ? AND s.kind = 'service' AND s.ref_id = ? AND a.client_id IS ?`, req.appointment_id, line.ref_id, req.client_id);
      if (!portee && one(db, "SELECT 1 AS x FROM service_supplements WHERE service_id = ?", line.ref_id)) {
        throw invalid("supplement.a_une_liste", { nom: String(row.name) });
      }
    }
    if (line.staff_id !== null && !one(db, "SELECT id FROM staff WHERE id = ?", line.staff_id)) throw invalid("vente.membre_inconnu", { id: line.staff_id });
    const unit = entierMineur(row.price as number);
    return { ...line, label_fr: String(row.name ?? ""), label_en: String(row.name_en ?? ""), unit_price: unit, line_total: unit * line.quantity };
  });
  if (req.client_id !== null && !one(db, "SELECT id FROM clients WHERE id = ?", req.client_id)) throw invalid("vente.cliente_inconnue");
  if (req.client_id === null && lines.some((l) => l.kind === "service")) throw invalid("vente.cliente_obligatoire");
  if (req.appointment_id !== null) {
    const apt = one(db, "SELECT status FROM appointments WHERE id = ?", req.appointment_id);
    if (!apt) throw invalid("vente.rdv_inconnu");
    if (apt.status === "cancelled") throw new SaleError(409, "vente.rdv_annule");
  }
  // Récompense fidélité (décision 14) : fidélité active, cliente choisie, palier réglé, solde suffisant (lu
  // dans la transaction d'émission) ; remise fixe du palier, ramenée au sous-total par `saleTotals`,
  // ni interrupteur des remises ni plafond.
  let discount: SaleRequest["discount"] = req.discount;
  let rewardPoints = 0;
  if (req.reward_points != null) {
    const loyalty = settings.loyalty;
    // Cause dite à la caisse : le mini CRM désactivé (interrupteur général), sinon la case de fidélité.
    if (!loyalty?.active) throw invalid(loyalty?.crmOff ? "crm.inactif" : "fidelite.inactive");
    if (req.client_id === null) throw invalid("fidelite.cliente");
    const tier = loyalty.tiers.find((x) => x.points === req.reward_points);
    if (!tier) throw invalid("fidelite.palier");
    const balance = loyaltyBalance(db, req.client_id);
    if (balance < tier.points) throw new SaleError(409, "fidelite.solde", { solde: balance, points: tier.points });
    discount = { kind: "amount", value: tier.montant, reason: "fidelite", note: "" };
    rewardPoints = tier.points;
  } else if (req.discount && !settings.discounts) {
    throw invalid("vente.remise_desactivee");
  }
  if (req.tip) {
    if (!settings.tips) throw invalid("vente.pourboire_desactive");
    if (!one(db, "SELECT id FROM staff WHERE id = ?", req.tip.staff_id)) throw invalid("vente.membre_inconnu", { id: req.tip.staff_id });
  }
  const totals = saleTotals({ lines, discount, vat: settings.vat, tip: req.tip?.amount ?? 0 });
  const discountReason = !discount ? "" : discount.reason === "autre" ? `autre:${discount.note}` : discount.reason;
  // Une récompense n'est jamais soumise au plafond : la gérante l'a réglée dans les paliers.
  const overCap = rewardPoints === 0 && totals.discount_amount > 0 && exceedsCap(totals.subtotal, totals.discount_amount, settings.discountCap);
  return { lines, totals, discount, rewardPoints, discountReason, overCap };
}

/**
 * Versements de la vente : moyens proposés, référence obligatoire pour Orange
 * Money et MoMo, somme exactement égale au total plus le pourboire (§ 4.4) ;
 * la monnaie rendue est recalculée ici, pour les espèces seulement.
 */
export function checkPayments(payments: SaleRequest["payments"], due: number, settings: SaleSettings): SettledPayment[] {
  const settled = payments.map((p): SettledPayment => {
    if (!settings.methods.includes(p.method)) throw invalid("vente.moyen_refuse", { moyen: coded(`moyen.${p.method}` as MessageKey) });
    if (REFERENCE_REQUIRED.includes(p.method) && p.reference === "") throw invalid("vente.reference_obligatoire", { moyen: coded(`moyen.${p.method}` as MessageKey) });
    const given = p.method === "cash" ? p.cash_given ?? p.amount : null;
    return { method: p.method, amount: p.amount, reference: p.reference, cash_given: given, change_given: given === null ? 0 : given - p.amount };
  });
  const received = settled.reduce((sum, p) => sum + p.amount, 0);
  // Mineur 3 (relecture finale) : montants du message groupés comme à l'écran ; `extra.due` reste un
  // nombre, lu par l'écran pour afficher tout de suite le vrai montant à payer (mineur 2).
  if (received !== due) throw new SaleError(409, "vente.versements_total", { recu: montant(received), du: montant(due) }, { code: "total", due });
  return settled;
}

/**
 * Avance d'un pas la suite `series` de l'année (§ 3.2) et rend le numéro
 * pris ; à appeler dans la transaction qui écrit le document : toute erreur
 * ensuite annule aussi ce pas, aucun trou possible.
 */
export function takeNumber(db: Database, series: string, year: number): number {
  const current = one(db, "SELECT last FROM sequences WHERE series = ? AND year = ?", series, year);
  if (current) db.prepare("UPDATE sequences SET last = last + 1 WHERE series = ? AND year = ?").run(series, year);
  else db.prepare("INSERT INTO sequences (series, year, last) VALUES (?, ?, 1)").run(series, year);
  return current ? Number(current.last) + 1 : 1;
}

/**
 * Caisse gardée contre une heure qui recule (distribution D-13), dans la
 * transaction d'émission : refus (409, `code: "heure"`) si `now` est antérieur
 * de plus d'une minute à la dernière facture, au dernier avoir ou au dernier
 * reçu d'acompte. Appelée par la vente, l'avoir et l'acompte, après la reprise
 * d'un `request_id` déjà émis (une reprise rend le document existant).
 */
export function checkClock(db: Database, now: number): void {
  const derniere = dernierDocument(db);
  if (heureRecule(derniere, now)) throw new SaleError(409, "caisse.heure_recule", { derniere: instantDouala(derniere!) }, { code: "heure" });
}

export interface IssueContext {
  now: number;
  lang: "fr" | "en";
  accountId: number;
  /** Copie des réglages fiscaux au moment de l'émission (§ 3.1). */
  fiscal: Record<string, unknown>;
  settings: SaleSettings;
  /** Remise au-delà du plafond approuvée (mot de passe d'une gérante). */
  approved: boolean;
  /**
   * Langue de la demande (`Accept-Language`, mineur 4 de la relecture
   * finale) : distincte de `lang`, celle de l'institut figée sur la facture.
   * Sert seulement à choisir la désignation du produit dans un refus de
   * stock.
   */
  requestLang: "fr" | "en";
  /**
   * Encaissement par la praticienne (correctif 1) : son `staff_id`, pour ne
   * rejouer qu'une facture qui est la sienne si la transaction retrouve un
   * `request_id` déjà émis (concurrence) ; `null`, ou absent, pour la
   * gérante et la réception, sans restriction.
   */
  practitionerStaffId?: number | null;
}

/**
 * Encaissement par la praticienne (décision 16 de la vague 3a), vérifié dans
 * la transaction d'émission (report de la vague 3a : plus rien ne peut changer
 * entre le contrôle et l'écriture) : son propre rendez-vous, en cours ou
 * terminé, sa cliente seulement, et sans acompte en attente (vague 3b : les
 * acomptes restent à la gérante et à la réception, décision 18).
 */
export function checkPractitioner(db: Database, req: SaleRequest, staffId: number): void {
  const apt = req.appointment_id === null ? undefined : one(db, "SELECT staff_id, status, client_id FROM appointments WHERE id = ?", req.appointment_id);
  if (!apt || apt.staff_id !== staffId) throw new SaleError(403, "vente.praticienne_rdv");
  if (apt.status !== "in_progress" && apt.status !== "completed") throw new SaleError(403, "vente.praticienne_statut");
  if (req.client_id !== ((apt.client_id as number | null) ?? null)) throw new SaleError(403, "vente.praticienne_cliente");
  if (one(db, "SELECT 1 AS x FROM deposits WHERE appointment_id = ? AND status = 'held'", req.appointment_id)) throw new SaleError(403, "vente.praticienne_acompte");
  // Supplément libre (spec § 3.4) : la praticienne n'encaisse que ceux de son rendez-vous, même libellé et même prix.
  const libres = req.lines.filter((l) => l.kind === "libre");
  if (libres.length > 0) {
    const permis = (db.prepare(
      `SELECT s.label_fr, s.price FROM appointment_supplements s JOIN appointment_services aps ON aps.id = s.appointment_service_id
        WHERE aps.appointment_id = ? AND s.kind = 'libre'`,
    ).all(req.appointment_id) as Row[]).map((s) => `${String(s.label_fr)}\n${Number(s.price)}`);
    for (const l of libres) {
      const at = permis.indexOf(`${l.label}\n${l.unit_price}`);
      if (at < 0) throw new SaleError(403, "vente.praticienne_libre");
      permis.splice(at, 1);
    }
  }
}

/**
 * Émet la facture d'une vente, dans la transaction ouverte par l'appelant :
 * même `request_id` déjà émis, la facture existante est rendue (`replay`),
 * sauf pour la praticienne si cette facture n'est pas la sienne (correctif
 * 1 : refusée comme un `request_id` réutilisé) ; sinon la suite de l'année
 * (heure de Douala) avance d'un pas, puis facture, lignes, stock, versements,
 * pourboire et statut du rendez-vous sont écrits. Toute erreur lève :
 * l'appelant annule tout, numéro compris.
 */
export function issueSale(db: Database, req: SaleRequest, ctx: IssueContext): { id: number; replay: boolean } {
  const existing = one(db, "SELECT id FROM invoices WHERE request_id = ?", req.request_id);
  if (existing) {
    if (ctx.practitionerStaffId != null) {
      const owned = one(
        db,
        "SELECT 1 AS x FROM invoices i JOIN appointments a ON a.id = i.appointment_id WHERE i.id = ? AND i.kind = 'invoice' AND a.staff_id = ?",
        Number(existing.id),
        ctx.practitionerStaffId,
      );
      if (!owned) throw new SaleError(409, "vente.requete");
    }
    return { id: Number(existing.id), replay: true };
  }
  checkClock(db, ctx.now);
  if (ctx.practitionerStaffId != null) checkPractitioner(db, req, ctx.practitionerStaffId);
  const priced = priceSale(db, req, ctx.settings);
  if (priced.overCap && !ctx.approved) {
    throw new SaleError(403, "vente.approbation", { plafond: ctx.settings.discountCap }, { code: "approbation" });
  }
  // Acompte en attente du rendez-vous (§ 6.2) : versement déjà reçu, déduit du reste à payer.
  // V1-78 : au comptoir, l'acompte choisi par la caisse (produits seuls, rendez-vous annulé ou manqué).
  const counter = req.appointment_id === null && req.deposit_id != null;
  const deposit = req.appointment_id !== null ? heldDeposit(db, req.appointment_id) : counter ? counterDeposit(db, req.deposit_id!, req.client_id) : null;
  // Correctif 1 (relecture) : un acompte ne se déduit que de la facture de sa propre cliente, jamais de
  // celle d'une autre (client_id nul ou absent compris).
  if (deposit && deposit.client_id !== req.client_id) {
    throw new SaleError(409, "acompte.autre_cliente", { numero: deposit.number }, { code: "acompte" });
  }
  // Correctif 1 (relecture) : l'acompte se compare au total TTC seul, jamais au pourboire (décision 5) :
  // sinon un acompte plus gros que le total pourrait payer une part du pourboire.
  if (deposit && deposit.amount > priced.totals.total_ttc) {
    throw new SaleError(409, counter ? "acompte.depasse_comptoir" : "acompte.depasse", { numero: deposit.number, acompte: montant(deposit.amount), du: montant(priced.totals.total_ttc) }, { code: "acompte" });
  }
  const payments = checkPayments(req.payments, priced.totals.due - (deposit?.amount ?? 0), ctx.settings);
  if (req.appointment_id !== null) {
    // Facture encore active (§ 3.4) : une facture entièrement reprise par des avoirs ne compte plus.
    const paid = one(db, "SELECT i.number FROM invoices i JOIN invoice_balance b ON b.invoice_id = i.id WHERE i.appointment_id = ? AND b.cancelled = 0", req.appointment_id);
    if (paid) throw new SaleError(409, "vente.rdv_deja_paye", { numero: String(paid.number) });
  }

  // Préfixe réglé (distribution D-01), lu dans la transaction d'émission : un changement concurrent passe avant ou après, jamais au milieu.
  const series = invoicePrefixForIssue(db, ctx.now);
  const year = yearAt(ctx.now);
  const seq = takeNumber(db, series, year);

  const t = priced.totals;
  const invoice = db.prepare(
    `INSERT INTO invoices (kind, number, series, year, seq, issued_at, lang, client_id, appointment_id, account_id,
       subtotal, discount_amount, discount_kind, discount_value, discount_reason, total_ttc, total_ht, total_tva, fiscal, request_id)
     VALUES ('invoice', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    documentNumber(series, year, seq), series, year, seq, ctx.now, ctx.lang, req.client_id, req.appointment_id, ctx.accountId,
    t.subtotal, t.discount_amount, priced.discount?.kind ?? null, priced.discount?.value ?? null, priced.discountReason,
    t.total_ttc, t.total_ht, t.total_tva, JSON.stringify(ctx.fiscal), req.request_id,
  );
  const id = Number(invoice.lastInsertRowid);

  const addLine = db.prepare(
    "INSERT INTO invoice_lines (invoice_id, kind, ref_id, label_fr, label_en, quantity, unit_price, line_total, staff_id, parent_line_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const takeStock = db.prepare("UPDATE products SET stock = stock - ?, updated_at = datetime('now') WHERE id = ? AND stock >= ?");
  // Identifiant de chaque ligne écrite, dans l'ordre du ticket : un supplément pointe vers celle de sa prestation.
  const lineIds: number[] = [];
  for (const line of priced.lines) {
    const parentId = line.parent === null ? null : lineIds[line.parent];
    const written = addLine.run(id, line.kind, line.ref_id, line.label_fr, line.label_en, line.quantity, line.unit_price, line.line_total, line.staff_id, parentId);
    lineIds.push(Number(written.lastInsertRowid));
    if (line.kind === "product" && Number(takeStock.run(line.quantity, line.ref_id, line.quantity).changes) === 0) {
      // Mineur 4 (relecture finale) : désignation anglaise pour une demande en anglais, si le produit en a une.
      const produit = ctx.requestLang === "en" && line.label_en ? line.label_en : line.label_fr;
      throw new SaleError(409, "vente.stock", { produit }, { code: "stock" });
    }
  }
  const addPayment = db.prepare("INSERT INTO payments (invoice_id, method, amount, reference, cash_given, change_given) VALUES (?, ?, ?, ?, ?, ?)");
  for (const p of payments) addPayment.run(id, p.method, p.amount, p.reference, p.cash_given, p.change_given);
  if (req.tip) db.prepare("INSERT INTO tips (invoice_id, staff_id, amount) VALUES (?, ?, ?)").run(id, req.tip.staff_id, req.tip.amount);
  if (deposit) applyDeposit(db, deposit.id, id, { now: ctx.now, accountId: ctx.accountId, requestId: req.request_id });
  // Encaisser un rendez-vous le termine (§ 3.4).
  if (req.appointment_id !== null) {
    db.prepare("UPDATE appointments SET status = 'completed', updated_at = datetime('now') WHERE id = ? AND status <> 'completed'").run(req.appointment_id);
  }
  // Fidélité (décisions 12 à 16) : récompense puis gain, dans la transaction de la facture.
  const loyalty = ctx.settings.loyalty;
  if (loyalty?.active) {
    recordSaleLoyalty(db, { invoiceId: id, clientId: req.client_id, totalTtc: t.total_ttc, rewardPoints: priced.rewardPoints, rule: loyalty.rule, accountId: ctx.accountId, now: ctx.now });
  }
  return { id, replay: false };
}
