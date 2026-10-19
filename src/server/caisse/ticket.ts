/**
 * Contenu du ticket de 80 mm (sous-projet 5 § 5.1), sans PDF : la suite des
 * rangées à imprimer pour une facture, un avoir ou un reçu d'acompte, dans la
 * langue du document et avec ses valeurs figées. Module pur, testé sous Node ;
 * `ticket-pdf.ts` ne fait que dessiner ces rangées.
 */
import { type PaymentMethod } from "../../shared/caisse.ts";
import { formatEntier, formatMontantDocument } from "../../shared/montants.ts";
import { orderedLines } from "../../shared/supplements.ts";
import type { TicketLoyalty } from "../crm/fidelite.ts";
import { message, type Lang, type MessageKey } from "../messages.ts";
import { marquerFormation } from "../formation/marque.ts";

export type TicketKind = "invoice" | "credit_note" | "deposit";

/** Réglages fiscaux et de l'institut copiés sur le document à l'émission (§ 3.1). */
export interface TicketFiscal {
  tva_active: boolean;
  tva_taux: number;
  niu: string;
  rccm: string;
  nom: string;
  adresse: string;
  telephone: string;
  mentions_fr: string;
  mentions_en: string;
  /** Marque en tête (vague B), figée à l'émission. */
  marque_documents: "logo_nom" | "logo";
}

export interface TicketLine {
  /** Identifiant de la ligne et celui de sa prestation pour un supplément (spec du 18/10/2026 § 3.5). */
  id?: number;
  parent_line_id?: number | null;
  label_fr: string;
  label_en: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  staff_name: string | null;
}

/** Retrait d'un supplément sous sa prestation : deux espaces insécables et « + », sur le PDF comme sur le papier. */
export const SUPPLEMENT_PREFIX = "\u00a0\u00a0+\u00a0";

export interface TicketPayment {
  method: PaymentMethod;
  amount: number;
  reference: string;
  cash_given: number | null;
  change_given: number;
}

/** Sort d'un acompte (V1-79), lu au moment de relire ou réimprimer son reçu. */
export type DepositFate = { kind: "applied"; invoice: string; at: number } | { kind: "refunded" | "kept"; at: number };

/** Document à imprimer : facture et avoir (`invoices`), reçu d'acompte (`deposits`, vague 3). */
export interface TicketDocument {
  kind: TicketKind;
  number: string;
  issued_at: number;
  lang: Lang;
  fiscal: TicketFiscal;
  client_name: string | null;
  account_name: string | null;
  lines: TicketLine[];
  subtotal: number;
  discount_amount: number;
  discount_kind: "percent" | "amount" | null;
  discount_value: number | null;
  discount_reason: string;
  total_ttc: number;
  total_ht: number;
  total_tva: number;
  payments: TicketPayment[];
  tip: { amount: number; staff_name: string | null } | null;
  /** Avoir : numéro de la facture corrigée et motif. */
  credited_number?: string | null;
  reason?: string;
  /** Facture : acomptes déduits (versements déjà reçus, vague 3b). */
  deposits?: { number: string; amount: number }[];
  /** Reçu d'acompte : jour (`aaaa-mm-jj`) et heure du rendez-vous. */
  appointment?: { date: string; time: string } | null;
  /** Reçu d'acompte relu ou réimprimé (V1-79) : ce qu'est devenu l'acompte ; `null` ou absent tant qu'il attend. */
  fate?: DepositFate | null;
  /** Fidélité du document (mini CRM, décision 19), lue dans le registre ; `null` ou absente : rien n'est imprimé. */
  loyalty?: TicketLoyalty | null;
}

/** Styles des rangées ; `ticket-pdf.ts` leur donne police, corps et interligne. */
export type TicketStyle = "nom" | "entete" | "titre" | "numero" | "corps" | "detail" | "total" | "mention" | "merci";

export type TicketRow =
  | { type: "text"; text: string; style: TicketStyle; align: "left" | "center" }
  | { type: "pair"; left: string; right: string; style: TicketStyle }
  | { type: "rule" }
  | { type: "logo" };

/**
 * Plages de caractères des polices embarquées (sous-ensemble « latin » de
 * @fontsource, identique pour EB Garamond et Jost), sauf l'espace fine
 * insécable U+202F qu'aucune des deux ne dessine.
 */
const COVERED: [number, number][] = [
  [0x20, 0x7e], [0xa0, 0xff], [0x131, 0x131], [0x152, 0x153], [0x2bb, 0x2bc], [0x2c6, 0x2c6], [0x2da, 0x2da], [0x2dc, 0x2dc],
  [0x2000, 0x202e], [0x2030, 0x206f], [0x20ac, 0x20ac], [0x2122, 0x2122], [0x2212, 0x2212],
];

function covered(cp: number): boolean {
  return COVERED.some(([a, b]) => cp >= a && cp <= b);
}

/**
 * Texte que les polices du ticket savent dessiner : l'espace fine insécable
 * des milliers devient une espace insécable (jamais un carré, jamais une
 * coupure de ligne) ; une lettre absente des polices perd son accent (« Ọ »
 * devient « O ») ; un caractère sans équivalent devient « ? » ; un retour à la
 * ligne est gardé (mentions légales).
 */
export function printable(text: string): string {
  let out = "";
  for (const ch of text.replace(/\u202f/g, "\u00a0")) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\n" || covered(cp)) {
      out += ch;
      continue;
    }
    const base = [...ch.normalize("NFD")].filter((c) => covered(c.codePointAt(0)!)).join("");
    out += base || "?";
  }
  return out;
}

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Africa/Douala" });
const TIME = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Douala" });

/** Date et heure d'émission, à Douala, identiques dans les deux langues : `28/09/2026 09:00`. */
export function ticketInstant(ms: number): string {
  return `${DATE.format(ms)} ${TIME.format(ms)}`;
}

/** Jour seul, à Douala, identique dans les deux langues : `04/10/2026` (sort d'un acompte). */
export function ticketDate(ms: number): string {
  return DATE.format(ms);
}

/** Heure seule, à Douala : `09:00` (période d'une clôture). */
export function ticketTime(ms: number): string {
  return TIME.format(ms);
}

/** Jour de calendrier `aaaa-mm-jj` écrit `03/10/2026`. */
export function calendarDate(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

/** Taux de TVA : `19,25` en français, `19.25` en anglais. */
function rate(value: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 2 }).format(value);
}

/** Motif de remise stocké (`fidelite`, `geste`, `autre:texte`) écrit dans la langue du ticket. */
export function discountReasonText(reason: string, lang: Lang): string {
  if (reason === "fidelite" || reason === "geste") return message(lang, `ticket.motif.${reason}` as MessageKey);
  return reason.startsWith("autre:") ? reason.slice("autre:".length).trim() : reason;
}

/** Moyen de paiement avec une majuscule : « Espèces », « Carte », « Orange Money ». */
export function methodText(method: PaymentMethod, lang: Lang): string {
  const text = message(lang, `moyen.${method}` as MessageKey);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const TITLES: Record<TicketKind, MessageKey> = { invoice: "ticket.facture", credit_note: "ticket.avoir", deposit: "ticket.acompte" };

/** Rangées du ticket, de l'en-tête au pied (§ 5.1), textes rendus imprimables. */
export function ticketRows(doc: TicketDocument, options: { logo?: boolean } = {}): TicketRow[] {
  const lang = doc.lang;
  const money = (n: number) => formatMontantDocument(n, lang);
  const t = (key: MessageKey, values?: Record<string, string | number>) => message(lang, key, values);
  const f = doc.fiscal;
  const rows: TicketRow[] = [];
  const text = (value: string, style: TicketStyle, align: "left" | "center" = "left") => {
    if (value.trim()) rows.push({ type: "text", text: value, style, align });
  };
  const pair = (left: string, right: string, style: TicketStyle = "corps") => rows.push({ type: "pair", left, right, style });

  // En-tête : logo s'il est fourni (vague B), puis nom et coordonnées (un nom vide n'est pas imprimé) ; « Logo seul » ôte le nom de l'en-tête (il passe aux mentions).
  const logoAlone = options.logo === true && f.marque_documents === "logo";
  if (options.logo) rows.push({ type: "logo" });
  if (!logoAlone) text(f.nom, "nom", "center");
  text(f.adresse, "entete", "center");
  if (f.telephone.trim()) text(t("ticket.telephone", { numero: f.telephone }), "entete", "center");
  if (f.niu.trim()) text(t("ticket.niu", { valeur: f.niu }), "entete", "center");
  if (f.rccm.trim()) text(t("ticket.rccm", { valeur: f.rccm }), "entete", "center");
  rows.push({ type: "rule" });

  // Titre : nature, numéro, date, cliente, personne qui encaisse.
  text(t(TITLES[doc.kind]), "titre", "center");
  text(doc.number, "numero", "center");
  text(ticketInstant(doc.issued_at), "detail", "center");
  if (doc.kind === "credit_note" && doc.credited_number) text(t("ticket.facture_corrigee", { numero: doc.credited_number }), "detail", "center");
  if (doc.kind === "deposit" && doc.appointment) {
    text(t("ticket.rendez_vous", { date: calendarDate(doc.appointment.date), heure: doc.appointment.time }), "detail", "center");
  }
  if (doc.client_name) text(t("ticket.cliente", { nom: doc.client_name }), "detail", "center");
  if (doc.account_name) text(t(doc.kind === "credit_note" ? "ticket.etabli_par" : "ticket.caisse", { nom: doc.account_name }), "detail", "center");
  if (doc.kind === "credit_note" && doc.reason) text(t("ticket.motif", { motif: doc.reason }), "detail", "center");
  rows.push({ type: "rule" });

  // Lignes : désignation dans la langue du ticket, quantité, prix, praticienne ; chaque supplément en retrait
  // sous sa prestation, avec son prix (spec du 18/10/2026 § 3.5), sa quantité seulement si elle dépasse 1.
  const numbered = doc.lines.map((line, i) => ({ ...line, id: line.id ?? -(i + 1) }));
  for (const line of orderedLines(numbered)) {
    const label = (lang === "en" ? line.label_en : line.label_fr) || line.label_fr;
    const detail = t("ticket.quantite", { quantite: line.quantity, prix: money(line.unit_price) });
    if (line.supplement) {
      pair(`${SUPPLEMENT_PREFIX}${label}`, money(line.line_total));
      if (line.quantity > 1) text(`${SUPPLEMENT_PREFIX}${detail}`, "detail");
      continue;
    }
    pair(label, money(line.line_total));
    text(line.staff_name ? `${detail} · ${line.staff_name}` : detail, "detail");
  }
  if (doc.lines.length) rows.push({ type: "rule" });

  // Totaux.
  if (doc.kind === "deposit") {
    pair(t("ticket.acompte_recu"), money(doc.total_ttc), "total");
    // V1-79 : un reçu relu ou réimprimé dit ce qu'est devenu l'acompte ; le reçu de l'encaissement n'a pas de sort.
    const fate = doc.fate;
    if (fate) {
      rows.push({ type: "rule" });
      const date = ticketDate(fate.at);
      const said = fate.kind === "applied"
        ? t("ticket.acompte_sort_deduit", { numero: fate.invoice, date })
        : t(fate.kind === "refunded" ? "ticket.acompte_sort_rembourse" : "ticket.acompte_sort_garde", { date });
      text(said, "detail", "center");
    }
  } else {
    if (doc.discount_amount > 0) {
      pair(t("ticket.sous_total"), money(doc.subtotal));
      const head = doc.discount_kind === "percent" && doc.discount_value ? t("ticket.remise_taux", { taux: doc.discount_value }) : t("ticket.remise");
      pair(head, `−${money(doc.discount_amount)}`);
      const why = discountReasonText(doc.discount_reason, lang);
      if (why) text(why, "detail");
    }
    if (f.tva_active) {
      pair(t("ticket.total_ht"), money(doc.total_ht));
      pair(t("ticket.tva", { taux: rate(f.tva_taux, lang) }), money(doc.total_tva));
    }
    pair(t(doc.kind === "credit_note" ? "ticket.total_avoir" : f.tva_active ? "ticket.total_ttc" : "ticket.total"), money(doc.total_ttc), "total");
    if (!f.tva_active) text(t("ticket.tva_non_applicable"), "detail");
  }

  // Fidélité (mini CRM, décision 19) : écritures de ce document puis solde figé juste après elles.
  const loyalty = doc.loyalty;
  if (loyalty && doc.kind !== "deposit") {
    // « 1 point », « 0 point » en français ; « 0 points » en anglais ; signe moins typographique.
    const points = (n: number) => {
      const abs = Math.abs(n);
      const one = lang === "fr" ? abs < 2 : abs === 1;
      return `${n < 0 ? "\u2212" : ""}${t(one ? "ticket.point" : "ticket.points", { nombre: formatEntier(abs) })}`;
    };
    rows.push({ type: "rule" });
    if (loyalty.reward > 0) pair(t("ticket.recompense"), `\u2212${points(loyalty.reward)}`);
    if (loyalty.earned > 0) pair(t("ticket.points_gagnes"), `+${formatEntier(loyalty.earned)}`);
    if (loyalty.taken > 0) pair(t("ticket.points_repris"), `\u2212${formatEntier(loyalty.taken)}`);
    if (loyalty.restored > 0) pair(t("ticket.points_rendus"), `+${points(loyalty.restored)}`);
    pair(t("ticket.solde_fidelite"), points(loyalty.balance));
  }

  // Versements (remboursements pour un avoir), acomptes déjà reçus, monnaie rendue.
  const deposits = doc.deposits ?? [];
  if (doc.payments.length || deposits.length) {
    rows.push({ type: "rule" });
    text(t(doc.kind === "credit_note" ? "ticket.remboursement" : "ticket.reglement"), "detail");
    for (const d of deposits) pair(t("ticket.acompte_deduit", { numero: d.number }), money(d.amount));
    for (const p of doc.payments) {
      pair(p.reference ? `${methodText(p.method, lang)} · ${p.reference}` : methodText(p.method, lang), money(Math.abs(p.cash_given ?? p.amount)));
    }
    const change = doc.payments.reduce((sum, p) => sum + p.change_given, 0);
    if (change > 0) pair(t("ticket.monnaie_rendue"), money(change));
    // « Total réglé » (TTC + pourboire) : seulement une facture avec pourboire, dernière rangée du bloc.
    if (doc.kind === "invoice" && doc.tip && doc.tip.amount > 0) {
      const paid = doc.payments.reduce((sum, p) => sum + p.amount, 0) + deposits.reduce((sum, d) => sum + d.amount, 0);
      pair(t("ticket.total_regle"), money(paid));
    }
  }

  // Pourboire, sous un filet, hors facture.
  if (doc.tip && doc.tip.amount > 0) {
    rows.push({ type: "rule" });
    pair(t("ticket.pourboire"), money(doc.tip.amount));
    if (doc.tip.staff_name) text(t("ticket.pourboire_pour", { nom: doc.tip.staff_name }), "detail");
  }

  // Pied : mentions légales réglées, formule de remerciement, signature de lama.
  rows.push({ type: "rule" });
  // « Logo seul » : le nom identifie toujours le vendeur, en petit avec les mentions.
  if (logoAlone) text(f.nom, "mention", "center");
  text(lang === "en" ? f.mentions_en || f.mentions_fr : f.mentions_fr || f.mentions_en, "mention", "center");
  text(t("ticket.merci"), "merci", "center");
  text(t("ticket.propulse"), "mention", "center");

  // Base de formation (D-18) : « FORMATION » en tête et au pied, sur papier comme en PDF.
  return marquerFormation(rows.map((row) => {
    if (row.type === "text") return { ...row, text: printable(row.text) };
    if (row.type === "pair") return { ...row, left: printable(row.left), right: printable(row.right) };
    return row;
  }), lang);
}
