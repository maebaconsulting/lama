/**
 * Routes de la caisse, vague 1 (sous-projet 5 § 4.5) : réglages lus par
 * l'écran de vente, émission d'une vente (`POST /api/sales`, idempotente par
 * `request_id`), factures du jour et fiche d'une facture. Gérante et
 * réception seulement (`permissions.ts`).
 */
import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get, query } from "@clawnify/db";
import { authenticatePassword } from "../auth/accounts.ts";
import { clientIp, currentAccount, requireConfirmation } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { decode, localize, msg, requestLang } from "../messages.ts";
import { publish } from "../realtime.ts";
import { getSetting } from "../settings.ts";
import type { StorageBinding } from "../storage.ts";
import { dayBounds, doualaDay, formatFrancs, type PaymentMethod } from "../../shared/caisse.ts";
import { issueCreditNote, parseCreditRequest } from "./avoir.ts";
import { checkPractitioner, issueSale, parseSaleRequest, priceSale, SaleError, type SaleRequest, type SaleSettings } from "./vente.ts";
import { documentLogo, renderTicket } from "./ticket-pdf.ts";
import type { TicketDocument, TicketFiscal } from "./ticket.ts";
import { queueDocumentMessage } from "../whatsapp/documents.ts";
import { printAfterIssue } from "../impression/routes.ts";
import { readMessageSettings } from "../whatsapp/rendez-vous.ts";
import { DOCUMENT_LOYALTY_SQL, readLoyaltySettings, ticketLoyalty, type TicketLoyalty } from "../crm/fidelite.ts";

/** Réglages de la caisse au moment de l'appel (valeurs par défaut de la spec tant que la gérante n'y a pas touché). */
export async function readSaleSettings(): Promise<SaleSettings> {
  return {
    vat: { active: await getSetting<boolean>("caisse.tva_active"), rate: await getSetting<number>("caisse.tva_taux") },
    discounts: await getSetting<boolean>("caisse.remises"),
    discountCap: await getSetting<number>("caisse.remise_plafond"),
    tips: await getSetting<boolean>("caisse.pourboires"),
    methods: await getSetting<PaymentMethod[]>("caisse.moyens"),
    loyalty: await readLoyaltySettings(),
  };
}

/** Copie des réglages fiscaux et de l'institut, figée sur chaque facture et chaque reçu d'acompte (§ 3.1). */
export async function fiscalSnapshot(settings: SaleSettings): Promise<Record<string, unknown>> {
  return { tva_active: settings.vat.active, tva_taux: settings.vat.rate, ...(await identitySnapshot()) };
}

/**
 * Identité de l'institut au moment de l'émission (nom, adresse, NIU, RCCM,
 * mentions), sans la TVA : un avoir prend celle de la facture qu'il corrige.
 */
async function identitySnapshot(): Promise<Record<string, unknown>> {
  return {
    niu: await getSetting<string>("institut.niu"),
    rccm: await getSetting<string>("institut.rccm"),
    nom: await getSetting<string>("institut.nom"),
    adresse: await getSetting<string>("institut.adresse"),
    telephone: await getSetting<string>("institut.telephone"),
    mentions_fr: await getSetting<string>("caisse.mentions_fr"),
    mentions_en: await getSetting<string>("caisse.mentions_en"),
    marque_documents: await getSetting<string>("marque.documents"),
  };
}

/**
 * Facture ou avoir complet : lignes (avec la praticienne, la quantité déjà
 * reprise par des avoirs, la ligne reprise et la remise en stock pour un
 * avoir), versements, pourboire, cliente et personne qui encaisse ; pour une
 * facture, ses avoirs, le total qu'ils reprennent et si elle est entièrement
 * reprise (`cancelled`, § 3.4).
 */
export async function readInvoice(id: number | string): Promise<Record<string, unknown> | null> {
  const invoice = await get<Record<string, unknown>>(
    `SELECT i.*, c.name AS client_name, a.display_name AS account_name, ap.identifier AS appointment_identifier, ci.number AS credited_number
       FROM invoices i
       LEFT JOIN clients c ON c.id = i.client_id
       LEFT JOIN accounts a ON a.id = i.account_id
       LEFT JOIN appointments ap ON ap.id = i.appointment_id
       LEFT JOIN invoices ci ON ci.id = i.credited_invoice_id
      WHERE i.id = ?`,
    [id],
  );
  if (!invoice) return null;
  const lines = await query(
    `SELECT l.id, l.kind, l.ref_id, l.label_fr, l.label_en, l.quantity, l.unit_price, l.line_total, l.staff_id, s.name AS staff_name,
            l.credited_line_id, l.restock,
            COALESCE((SELECT SUM(x.quantity) FROM invoice_lines x WHERE x.credited_line_id = l.id), 0) AS credited
       FROM invoice_lines l LEFT JOIN staff s ON s.id = l.staff_id WHERE l.invoice_id = ? ORDER BY l.id`,
    [id],
  );
  const payments = await query("SELECT method, amount, reference, cash_given, change_given FROM payments WHERE invoice_id = ? ORDER BY id", [id]);
  const tip = await get("SELECT t.staff_id, t.amount, s.name AS staff_name FROM tips t LEFT JOIN staff s ON s.id = t.staff_id WHERE t.invoice_id = ?", [id]);
  const credits = await query("SELECT id, number, issued_at, total_ttc, reason FROM invoices WHERE credited_invoice_id = ? ORDER BY id", [id]);
  // Acompte déduit de cette facture (§ 6.2) : versement déjà reçu, au ticket et dans la fiche.
  const deposits = await query("SELECT id, number, amount FROM deposits WHERE applied_invoice_id = ? ORDER BY id", [id]);
  const balance = await get<{ credited_total: number; cancelled: number }>("SELECT credited_total, cancelled FROM invoice_balance WHERE invoice_id = ?", [id]);
  // Fidélité du document (mini CRM, décision 19) : écritures et solde figé, pour le ticket et la fiche de la facture.
  const loyalty = ticketLoyalty(await get<Record<string, unknown>>(DOCUMENT_LOYALTY_SQL, [id]));
  return {
    ...invoice, fiscal: JSON.parse(String(invoice.fiscal)), lines, payments, tip: tip ?? null,
    credits, deposits, credited_total: balance?.credited_total ?? 0, cancelled: balance?.cancelled === 1, loyalty,
  };
}

/**
 * Facture ou avoir lu par `readInvoice`, en document à imprimer (§ 5.1) :
 * valeurs figées à l'émission (réglages fiscaux, langue, désignations,
 * montants) ; les noms (cliente, praticienne, personne qui encaisse) sont
 * ceux des fiches.
 */
/** Réglages fiscaux figés sur un document (facture, avoir, reçu d'acompte), complétés pour le ticket. */
export function ticketFiscal(fiscal: Partial<TicketFiscal>): TicketFiscal {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    tva_active: fiscal.tva_active === true, tva_taux: Number(fiscal.tva_taux) || 0,
    niu: str(fiscal.niu), rccm: str(fiscal.rccm), nom: str(fiscal.nom), adresse: str(fiscal.adresse), telephone: str(fiscal.telephone),
    mentions_fr: str(fiscal.mentions_fr), mentions_en: str(fiscal.mentions_en),
    marque_documents: fiscal.marque_documents === "logo" ? "logo" : "logo_nom",
  };
}

export function invoiceTicket(invoice: Record<string, unknown>): TicketDocument {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    kind: invoice.kind === "credit_note" ? "credit_note" : "invoice",
    number: String(invoice.number),
    issued_at: Number(invoice.issued_at),
    lang: invoice.lang === "en" ? "en" : "fr",
    fiscal: ticketFiscal(invoice.fiscal as Partial<TicketFiscal>),
    client_name: (invoice.client_name as string | null) ?? null,
    account_name: (invoice.account_name as string | null) ?? null,
    lines: invoice.lines as TicketDocument["lines"],
    subtotal: Number(invoice.subtotal), discount_amount: Number(invoice.discount_amount),
    discount_kind: (invoice.discount_kind as TicketDocument["discount_kind"]) ?? null,
    discount_value: (invoice.discount_value as number | null) ?? null,
    discount_reason: str(invoice.discount_reason),
    total_ttc: Number(invoice.total_ttc), total_ht: Number(invoice.total_ht), total_tva: Number(invoice.total_tva),
    payments: invoice.payments as TicketDocument["payments"],
    tip: (invoice.tip as TicketDocument["tip"]) ?? null,
    credited_number: (invoice.credited_number as string | null) ?? null,
    reason: str(invoice.reason),
    deposits: (invoice.deposits as TicketDocument["deposits"]) ?? [],
    loyalty: (invoice.loyalty as TicketLoyalty | null | undefined) ?? null,
  };
}

/**
 * Remise au-delà du plafond (§ 4.3) : la gérante qui encaisse confirme par son
 * propre mot de passe (mécanisme de confirmation existant) ; à la réception,
 * une gérante tape son identifiant et son mot de passe (`approval`), contrôlés
 * comme à la connexion (essais comptés, blocage). Renvoie l'identifiant de la
 * gérante qui approuve, ou la réponse de refus.
 */
async function approve(c: Context, approval: unknown, discountCap: number): Promise<{ by: number } | Response> {
  const account = currentAccount(c);
  if (account.role === "manager") {
    const refused = requireConfirmation(c);
    return refused ?? { by: account.id };
  }
  const a = (approval && typeof approval === "object" ? approval : {}) as { login?: unknown; password?: unknown };
  if (typeof a.login !== "string" || typeof a.password !== "string") {
    return c.json({ error: msg(c, "vente.approbation", { plafond: discountCap }), code: "approbation" }, 403);
  }
  const result = await authenticatePassword(a.login, a.password, nowOf(c));
  if (!result.ok || result.account.role !== "manager") {
    // Au journal, seul un identifiant existant est inscrit : ce qui a été
    // tapé peut être un mot de passe saisi dans le mauvais champ (§ 3.1,
    // même règle qu'à la connexion, `auth/routes.ts`). Un compte bloqué est
    // noté `connexion.blocage`, jamais `connexion.echec`.
    if (result.ok) {
      await logAudit({ accountId: result.account.id, action: "connexion.echec", target: result.account.login, ip: clientIp(c), now: nowOf(c) });
    } else {
      const known = await get("SELECT id FROM accounts WHERE login = ?", [a.login]);
      const action = result.reason === "locked" ? "connexion.blocage" : "connexion.echec";
      await logAudit({ accountId: null, action, target: known ? a.login : "(identifiant inconnu)", ip: clientIp(c), now: nowOf(c) });
    }
    return c.json({ error: msg(c, "vente.approbation_refusee"), code: "approbation", refused: true }, 403);
  }
  return { by: result.account.id };
}

/**
 * Facture visible de la personne connectée : toute facture pour la gérante et
 * la réception ; pour la praticienne (encaissement par la praticienne),
 * réglage toujours activé, et seulement ses propres factures (jamais un
 * avoir, correctif 1 : décisions 16 et 18).
 */
export async function mayReadInvoice(c: Context, invoiceId: number | string): Promise<boolean> {
  const account = currentAccount(c);
  if (account.role !== "practitioner") return true;
  if (!(await getSetting<boolean>("caisse.encaissement_praticienne"))) return false;
  const row = await get<{ staff_id: number | null }>(
    "SELECT a.staff_id FROM invoices i JOIN appointments a ON a.id = i.appointment_id WHERE i.id = ? AND i.kind = 'invoice'",
    [invoiceId],
  );
  return !!row && account.staff_id !== null && row.staff_id === account.staff_id;
}

/** Facture rendue en JSON : la praticienne ne reçoit aucun point de fidélité (décision 9, § 4 de la spec). */
function forRole(c: Context, invoice: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!invoice || currentAccount(c).role !== "practitioner") return invoice;
  return { ...invoice, loyalty: null };
}

/**
 * Encaissement par la praticienne (demande produit du 30/09/2026),
 * une fois le réglage vérifié à l'entrée de la route : ce qui ne dépend que
 * de la demande et du compte (un rendez-vous, jamais le comptoir ; un compte
 * relié à une fiche de l'équipe ; aucune remise). Le rendez-vous lui-même
 * (le sien, en cours ou terminé, sa cliente, sans acompte en attente) est
 * vérifié dans la transaction d'émission (`issueSale`, report de la vague
 * 3a). Rend le refus, ou `null` si la vente peut suivre.
 */
function practitionerRefusal(c: Context, req: SaleRequest): Response | null {
  const account = currentAccount(c);
  if (account.role !== "practitioner") return null;
  if (req.appointment_id === null || account.staff_id === null) return c.json({ error: msg(c, "vente.praticienne_rdv") }, 403);
  if (req.discount || req.reward_points != null) return c.json({ error: msg(c, "vente.praticienne_remise") }, 403);
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountCaisseRoutes(app: OpenAPIHono<any>): void {
  app.get("/api/sales/settings", async (c) => {
    const practitioner = currentAccount(c).role === "practitioner";
    const practitionerCheckout = await getSetting<boolean>("caisse.encaissement_praticienne");
    // Correctif final (point 6) : fonction désactivée, la praticienne ne lit ni TVA, ni moyens, ni plafond, ni
    // remises (décision 16, elle ne lit rien de la caisse) : seul l'indicateur, dont l'écran a strictement besoin
    // pour ne rien afficher (`vente.tsx`, `appointment-detail.tsx`).
    // Correctif 3 (tâche 2) : la praticienne ne lit jamais les acomptes, l'indicateur le dit explicitement.
    if (practitioner && !practitionerCheckout) return c.json({ practitioner_checkout: false, deposits: false });
    const s = await readSaleSettings();
    return c.json({
      // La praticienne n'applique jamais de remise : l'écran ne lui montre pas le bouton.
      vat_active: s.vat.active, vat_rate: s.vat.rate, discounts: s.discounts && !practitioner, discount_cap: s.discountCap, tips: s.tips, methods: s.methods,
      practitioner_checkout: practitionerCheckout,
      // Avoirs émis par la réception (§ 6.1) : l'écran ne montre « Émettre un avoir » qu'à qui le serveur l'accepte.
      avoirs_reception: await getSetting<boolean>("caisse.avoirs_reception"),
      // Acomptes (§ 6.2) : « Encaisser un acompte » n'est montré que si la gérante les a activés.
      deposits: !practitioner && (await getSetting<boolean>("caisse.acomptes")),
      // Impression directe : case « Imprimer le ticket » et bouton « Imprimer » vers l'imprimante réseau. L'adresse reste à la gérante.
      printer: (await getSetting<string>("caisse.imprimante")).trim() !== "",
      // Fidélité (mini CRM § 2) : paliers proposés à la caisse ; la praticienne n'applique jamais de récompense.
      loyalty: practitioner ? { active: false, tiers: [] } : { active: s.loyalty?.active ?? false, tiers: s.loyalty?.tiers ?? [] },
    });
  });

  app.post("/api/sales", async (c) => {
    const account = currentAccount(c);
    // Praticienne : rien ne se lit ni ne s'émet tant que la gérante n'a pas activé l'encaissement par la praticienne.
    if (account.role === "practitioner" && !(await getSetting<boolean>("caisse.encaissement_praticienne"))) {
      return c.json({ error: msg(c, "vente.praticienne_desactive") }, 403);
    }
    const body = await c.req.json().catch(() => ({}));
    const storage = c.env.STORAGE as StorageBinding;
    const now = nowOf(c);
    try {
      const req: SaleRequest = parseSaleRequest(body);
      const refused = practitionerRefusal(c, req);
      if (refused) return refused;
      // Même demande déjà émise (double appui, réponse perdue) : la facture existante, sans rien refaire.
      // Correctif 1 : pour la praticienne, seulement si c'est la sienne ; sinon un request_id réutilisé.
      // Correctif final (point 3) : un avoir du même request_id (émis sur /api/credit-notes) n'est jamais rendu
      // comme une vente ; seul un document kind = 'invoice' vaut rejeu.
      const done = await get<{ id: number; kind: string }>("SELECT id, kind FROM invoices WHERE request_id = ?", [req.request_id]);
      if (done) {
        if (done.kind !== "invoice" || !(await mayReadInvoice(c, done.id))) return c.json({ error: msg(c, "vente.requete") }, 409);
        return c.json({ invoice: forRole(c, await readInvoice(done.id)) }, 200);
      }
      const settings = await readSaleSettings();
      // Praticienne : son rendez-vous vérifié d'abord, pour qu'un refus dise pourquoi (pas « rendez-vous annulé »),
      // puis de nouveau dans la transaction d'émission, qui seule fait foi.
      const ownStaff = account.role === "practitioner" ? account.staff_id : null;
      const priced = storage.transaction!((db) => {
        if (ownStaff !== null) checkPractitioner(db, req, ownStaff);
        return priceSale(db, req, settings);
      });
      let approvedBy: number | null = null;
      if (priced.overCap) {
        const verdict = await approve(c, (body as { approval?: unknown }).approval, settings.discountCap);
        if (verdict instanceof Response) return verdict;
        approvedBy = verdict.by;
      }
      const fiscal = await fiscalSnapshot(settings);
      const lang = await getSetting<"fr" | "en">("institut.langue");
      // Correctif 1 : si la transaction retrouve entre-temps une facture du même request_id (concurrence),
      // la praticienne ne la rejoue que si c'est la sienne (`issueSale`, même règle que `mayReadInvoice`).
      const practitionerStaffId = account.role === "practitioner" ? account.staff_id : null;
      // Case « Envoyer par WhatsApp » (sous-projet 7, vague 2) : le ticket est mis en file dans la transaction de
      // la vente, jamais pour une vente rejouée ; la praticienne ne la voit pas (elle ne lit pas le numéro des clientes).
      const wantsWhatsapp = (body as { whatsapp?: unknown }).whatsapp === true && account.role !== "practitioner";
      const messages = wantsWhatsapp ? await readMessageSettings() : null;
      let queued = false;
      const result = storage.transaction!((db) => {
        const issued = issueSale(db, req, { now, lang, accountId: account.id, fiscal, settings, approved: approvedBy !== null, requestLang: requestLang(c), practitionerStaffId });
        if (messages && !issued.replay) {
          // La vente ne doit jamais échouer à cause de WhatsApp : une erreur ici est journalisée (sans le texte) et ignorée.
          try {
            queued = queueDocumentMessage(db, messages, { kind: "invoice", id: issued.id }, { now, createdBy: account.id, strict: false }).ok;
          } catch (error) {
            console.error("Ticket WhatsApp\u00a0:", error instanceof Error ? decode("fr", error.message) : error);
          }
        }
        return issued;
      });
      const invoice = forRole(c, await readInvoice(result.id));
      if (result.replay) return c.json({ invoice }, 200);
      // Mineur 3 (relecture finale) : montants groupés comme à l'écran, plutôt qu'un nombre brut.
      const target = `${invoice!.number} (${formatFrancs(invoice!.total_ttc as number)}\u00a0F)`;
      await logAudit({ accountId: account.id, action: "facture.emise", target, ip: clientIp(c), now });
      if (approvedBy !== null) {
        await logAudit({ accountId: approvedBy, action: "facture.remise_plafond", target: `${invoice!.number} (${formatFrancs(invoice!.discount_amount as number)}\u00a0F)`, ip: clientIp(c), now });
      }
      // Un acompte déduit au comptoir change aussi la fiche de son rendez-vous (V1-78).
      if (req.appointment_id !== null || req.deposit_id != null) publish({ resource: "appointments" });
      if (req.lines.some((l) => l.kind === "product")) publish({ resource: "products" });
      if (queued) {
        await logAudit({ accountId: account.id, action: "whatsapp.document", target: invoice!.number as string, ip: clientIp(c), now });
        publish({ resource: "outbox" });
      }
      // Impression directe (case « Imprimer le ticket ») : après l'enregistrement, jamais pour une vente rejouée.
      const printed = (body as { print?: unknown }).print === true ? await printAfterIssue(c, { kind: "invoice", id: result.id }) : {};
      return c.json({ invoice: { ...invoice, ...(wantsWhatsapp ? { whatsapp_queued: queued } : {}), ...printed } }, 201);
    } catch (error) {
      if (error instanceof SaleError) return c.json({ error: localize(c, error.message), ...error.extra }, error.status);
      throw error;
    }
  });

  /**
   * Reprise d'une vente dont la réponse s'est perdue (§ 7, report de la
   * vague 2) : la facture émise pour ce `request_id`, ou 404 « absente » si
   * aucune ne l'a été. Lecture seule : l'écran sait ainsi, sans rien
   * renvoyer, si la vente est passée ou s'il peut dégeler le ticket.
   */
  app.get("/api/sales/:request_id", async (c) => {
    const requestId = c.req.param("request_id");
    if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) return c.json({ error: msg(c, "vente.requete") }, 400);
    const done = await get<{ id: number }>("SELECT id FROM invoices WHERE request_id = ? AND kind = 'invoice'", [requestId]);
    if (!done) return c.json({ error: msg(c, "vente.introuvable"), code: "absente" }, 404);
    // Correctif final (point 4) : la facture existe, mais la praticienne n'a pas le droit de la lire (réglage
    // désactivé, rendez-vous d'une autre) : 403 traduit, jamais 404 « absente » (qui ferait dire à l'écran que la
    // vente n'a pas été émise, `lib/reprise-vente.ts`).
    if (!(await mayReadInvoice(c, done.id))) return c.json({ error: msg(c, "acces.refuse") }, 403);
    return c.json({ invoice: forRole(c, await readInvoice(done.id)) });
  });

  /**
   * Factures et avoirs d'un jour (`?date=`, aujourd'hui par défaut), du plus
   * ancien au plus récent, ou d'une cliente (`?client_id=`), du plus récent
   * au plus ancien ; chaque facture dit ce que ses avoirs ont repris, chaque
   * avoir cite la facture corrigée.
   */
  app.get("/api/invoices", async (c) => {
    const columns = `SELECT i.id, i.kind, i.number, i.issued_at, i.total_ttc, i.client_id, c.name AS client_name, i.appointment_id,
              i.account_id, a.display_name AS account_name, (SELECT amount FROM tips WHERE invoice_id = i.id) AS tip,
              ci.number AS credited_number, COALESCE(b.credited_total, 0) AS credited_total, COALESCE(b.cancelled, 0) AS cancelled
         FROM invoices i LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN accounts a ON a.id = i.account_id
         LEFT JOIN invoices ci ON ci.id = i.credited_invoice_id LEFT JOIN invoice_balance b ON b.invoice_id = i.id`;
    const clientId = c.req.query("client_id");
    if (clientId !== undefined) {
      if (!/^[1-9]\d{0,9}$/.test(clientId)) return c.json({ error: msg(c, "vente.cliente_inconnue") }, 400);
      return c.json({ invoices: await query(`${columns} WHERE i.client_id = ? ORDER BY i.issued_at DESC, i.id DESC LIMIT 200`, [clientId]) });
    }
    const day = c.req.query("date") ?? doualaDay(nowOf(c));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return c.json({ error: msg(c, "vente.date") }, 400);
    const { start, end } = dayBounds(day);
    // Aller-retour de la date : un repli comme le 31 février (rendu au 3 mars par `Date.UTC`) est refusé.
    if (doualaDay(start) !== day) return c.json({ error: msg(c, "vente.date") }, 400);
    const invoices = await query(`${columns} WHERE i.issued_at >= ? AND i.issued_at < ? ORDER BY i.issued_at, i.id`, [start, end]);
    return c.json({ invoices });
  });

  /**
   * Avoir sur une facture (§ 6.1) : la gérante, et la réception si la
   * gérante l'autorise (`caisse.avoirs_reception`). Idempotent par
   * `request_id` comme la vente ; tout est écrit dans une transaction.
   */
  app.post("/api/credit-notes", async (c) => {
    const account = currentAccount(c);
    if (account.role !== "manager" && !(await getSetting<boolean>("caisse.avoirs_reception"))) {
      return c.json({ error: msg(c, "avoir.reservee") }, 403);
    }
    const body = await c.req.json().catch(() => ({}));
    const storage = c.env.STORAGE as StorageBinding;
    const now = nowOf(c);
    try {
      const req = parseCreditRequest(body);
      const identity = await identitySnapshot();
      const result = storage.transaction!((db) => issueCreditNote(db, req, { now, accountId: account.id, identity, requestLang: requestLang(c) }));
      const note = await readInvoice(result.id);
      if (result.replay) return c.json({ credit_note: note }, 200);
      await logAudit({ accountId: account.id, action: "avoir.emis", target: `${note!.number} (${formatFrancs(note!.total_ttc as number)}\u00a0F, ${note!.credited_number})`, ip: clientIp(c), now });
      if (note!.appointment_id !== null) publish({ resource: "appointments" });
      if (req.lines.some((l) => l.restock)) publish({ resource: "products" });
      const printed = (body as { print?: unknown }).print === true ? await printAfterIssue(c, { kind: "credit", id: result.id }) : {};
      return c.json({ credit_note: { ...note, ...printed } }, 201);
    } catch (error) {
      if (error instanceof SaleError) return c.json({ error: localize(c, error.message), ...error.extra }, error.status);
      throw error;
    }
  });

  app.get("/api/invoices/:id", async (c) => {
    const id = c.req.param("id");
    const invoice = /^\d+$/.test(id) ? await readInvoice(id) : null;
    if (!invoice) return c.json({ error: msg(c, "facture.introuvable") }, 404);
    return c.json({ invoice });
  });

  // Ticket de 80 mm (§ 5.1) : affiché pour « Imprimer », en pièce jointe pour « Télécharger » (`?telecharger=1`).
  // La fabrication du PDF (lecture de la facture figée, mise en page) est protégée : une erreur (ressource
  // manquante, panne de fabrication) devient un message traduit plutôt que le corps brut de l'erreur.
  app.get("/api/invoices/:id/pdf", async (c) => {
    try {
      const invoice = await readInvoice(c.req.param("id"));
      if (!invoice || !(await mayReadInvoice(c, c.req.param("id")))) return c.json({ error: msg(c, "facture.introuvable") }, 404);
      // `RENDER_TICKET` (liaison Hono, comme `CLOCK`) : jamais posée en production, seul point d'ancrage
      // pour éprouver cet échec en test sans corrompre une facture, immuable dès son émission (§ 3.1).
      const render: typeof renderTicket = c.env?.RENDER_TICKET ?? renderTicket;
      const pdf = await render(invoiceTicket(invoice), { logo: await documentLogo() });
      const disposition = c.req.query("telecharger") === "1" ? "attachment" : "inline";
      return c.body(new Uint8Array(pdf), 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${invoice.number}.pdf"`,
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      console.error(error instanceof Error ? error : String(error));
      return c.json({ error: msg(c, "facture.pdf_echec") }, 500);
    }
  });
}
