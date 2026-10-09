import { createApp, createRoute, mountDiscovery, z } from "@clawnify/app";
import { query, get, run } from "./db.js";
import { findConflicts, describeConflicts, toMinutes, validTime, DAY_CLOSE, CLOSE_TIME, type Busy } from "./scheduling.js";
import { ensureSeeded } from "./seed.js";
import { fold, foldPattern } from "./fold.ts";
import { listTagCounts, TAGS_SQL, withTags, writeTags } from "./crm/etiquettes.ts";
import { normalizeCard } from "../shared/carte.ts";
import { readCrmFields } from "./crm/champs.ts";
import { clientSummary } from "./crm/synthese.ts";
import type { Database, StorageBinding } from "./storage.ts";
import type { Account } from "./auth/accounts.ts";
import type { Session } from "./auth/sessions.ts";
import { installAuth, clientIp, currentAccount } from "./auth/middleware.ts";
import { logAudit, MAX_TARGET_LENGTH } from "./audit.ts";
import type { Context } from "hono";
import { doualaDay, formatFrancs } from "../shared/caisse.ts";
import { busyOn, transferNote } from "./transferts.ts";
import { installRealtime, publish } from "./realtime.ts";
import { mountAuthRoutes } from "./auth/routes.ts";
import { mountDeviceRoutes } from "./auth/devices.ts";
import { mountAccountRoutes } from "./auth/accounts-routes.ts";
import { redactAppointment, redactProduct, redactStaff, restrictFields } from "./auth/permissions.ts";
import { crmActive, mountSettingsRoutes, setMasterKey } from "./settings.ts";
import { mountOutboxRoutes } from "./outbox/routes.ts";
import { mountBackupRoutes } from "./backup/routes.ts";
import { mountInstitutRoutes } from "./institut/routes.ts";
import { mountProductImageRoutes } from "./produits/routes.ts";
import { IMAGE_VERSION_SQL } from "./produits/images.ts";
import { IMAGE_MAX_BYTES } from "./images.ts";
import { mountCaisseRoutes } from "./caisse/routes.ts";
import { mountLoyaltyRoutes } from "./crm/fidelite-routes.ts";
import { loyaltySummary, readLoyaltySettings } from "./crm/fidelite.ts";
import { mountClotureRoutes } from "./caisse/cloture-routes.ts";
import { mountAcompteRoutes } from "./caisse/acompte-routes.ts";
import { mountWhatsappRoutes } from "./whatsapp/routes.ts";
import { mountSmsRoutes } from "./sms/routes.ts";
import { mountPrintRoutes } from "./impression/routes.ts";
import { mountCampaignRoutes } from "./crm/campagnes-routes.ts";
import { mountRelanceRoutes } from "./crm/relances-routes.ts";
import { mountTransferRoutes } from "./transferts-routes.ts";
import { mountHeureRoutes } from "./heure/routes.ts";
import { mountFormationRoutes } from "./formation/routes.ts";
import { installerCoupuresFormation } from "./formation/coupures.ts";
import { installerProtectionsDemo } from "./formation/protections-demo.ts";
import type { BackupEnv } from "./backup/routes.ts";
import type { HorlogeSysteme } from "./heure/horloge.ts";
import type { renderTicket } from "./caisse/ticket-pdf.ts";
import { localize, message, MessageError, msg, requestLang } from "./messages.ts";
import { nowOf } from "./clock.ts";
import { queueAppointmentMessage, readMessageSettings } from "./whatsapp/rendez-vous.ts";
import { HTTPException } from "hono/http-exception";

// `RENDER_TICKET` : jamais posée en production, seul point d'ancrage de test pour éprouver l'échec de
// fabrication du PDF du ticket (§ 5.1) sans corrompre une facture, immuable dès son émission (§ 3.1).
// `WHATSAPP_FETCH` : jamais posée en production ; les tests y mettent le faux WAHA (sous-projet 7 § 4).
// `SMS_FETCH` : jamais posée en production ; les essais y mettent la fausse passerelle.
// `HORLOGE` : horloge du système (`timedatectl`), posée par boot.ts ; les essais y mettent une fausse (distribution D-12).
export type AppBindings = { STORAGE: StorageBinding; MASTER_KEY?: Uint8Array; CLOCK?: () => number; BACKUP?: BackupEnv; RENDER_TICKET?: typeof renderTicket; WHATSAPP_FETCH?: typeof fetch; SMS_FETCH?: typeof fetch; HORLOGE?: HorlogeSysteme };
type Env = { Bindings: AppBindings; Variables: { account: Account | null; session: Session | null; device: { id: number; name: string } | null } };

const APP_INFO = {
  title: "lama",
  version: "1.0.0",
  description: "lama: appointments, clients, cash register and messages of one beauty institute, served from its own local server. Send Accept-Language: fr for French messages; English otherwise.",
};
// La description de l'API (`/api/openapi.json`) est montée plus bas, après
// l'intermédiaire d'authentification : un appareil sans session ne l'obtient pas.
const app = createApp<Env>({ ...APP_INFO, discovery: false });

// Refus de validation (décision 9 de la passe V 1.0) : une phrase lisible, dans la langue de la
// requête, qui nomme le premier champ fautif tel que l'API le nomme ; jamais l'erreur zod brute.
app.defaultHook = (result, c) => {
  if (result.success) return;
  const champ = result.error.issues[0]?.path.join(".") || "?";
  return c.json({ error: msg(c, "requete.invalide", { champ }) }, 400);
};

// Seed sample data + the appointment counter rows on the first request an
// isolate serves. Registered after createApp's `initDB` middleware and before
// every route, so handlers always see the _meta rows.
app.use("*", async (c, next) => {
  await ensureSeeded(c.env.STORAGE, nowOf(c));
  await next();
});

app.use("*", async (c, next) => {
  // Toujours synchronisé sur la requête (pas seulement posé une fois) : un test
  // peut ainsi retirer `MASTER_KEY` de l'environnement pour simuler une clé non
  // chargée, sans que la valeur posée par une requête précédente ne persiste.
  setMasterKey(c.env.MASTER_KEY ?? null);
  await next();
});

// Corps de requête bornés sous /api, avant toute lecture (authentification
// comprise) : un appareil du réseau ne peut ni remplir la mémoire ni le disque.
// Le corps est lu ici, jamais au-delà de la limite, qu'il annonce sa taille
// (`Content-Length`) ou non : les routes, qui ignorent un corps illisible,
// ne peuvent donc pas avaler le dépassement et répondre autre chose que 413.
const MAX_BODY_BYTES = 64 * 1024;
// Exception : le dépôt d'une image, logo de l'institut ou photo d'un produit (1 Mo au plus, un octet de marge
// pour que la route réponde par son refus traduit, 400).
const IMAGE_BODY_BYTES = IMAGE_MAX_BYTES + 1;
const IMAGE_UPLOAD = /^\/api\/(institut\/logos\/[^/]+|products\/\d+\/image)$/;
app.use("/api/*", async (c, next) => {
  const raw = c.req.raw;
  if (!raw.body) return next();
  const limit = raw.method === "PUT" && IMAGE_UPLOAD.test(c.req.path) ? IMAGE_BODY_BYTES : MAX_BODY_BYTES;
  const tooLarge = () => c.json({ error: msg(c, "requete.trop_volumineuse") }, 413);
  if (Number(raw.headers.get("content-length")) > limit) return tooLarge();
  const reader = raw.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      return tooLarge();
    }
    chunks.push(value);
  }
  c.req.raw = new Request(raw, { body: Buffer.concat(chunks) });
  return next();
});

installAuth(app);
// Base de formation (distribution D-17) : sauvegardes, heure du système, session et essais WhatsApp ou SMS refusés.
installerCoupuresFormation(app);
// Démonstration publique (DP-06) : comptes publics figés, aucun fichier reçu.
installerProtectionsDemo(app);
mountDiscovery(app, APP_INFO);
// /llms.txt (cité par agent.md, décision 14 de la passe V 1.0) : servi sous /api pour passer par la
// session, comme /api/openapi.json ; boot.ts relaie l'adresse publique /llms.txt jusqu'ici. Le texte de
// la bibliothèque sépare route et résumé par un tiret cadratin, remplacé par un deux-points.
app.get("/api/llms.txt", async (c) => {
  const res = await app.request("/llms.txt", {}, c.env);
  const text = (await res.text()).replace(/` \u2014 /g, "`: ");
  return c.body(text, 200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "private, no-store" });
});
installRealtime(app);
mountAuthRoutes(app);
mountDeviceRoutes(app);
mountAccountRoutes(app);
mountSettingsRoutes(app);
mountOutboxRoutes(app);
mountBackupRoutes(app);
mountInstitutRoutes(app);
mountProductImageRoutes(app);
mountCaisseRoutes(app);
mountLoyaltyRoutes(app);
mountClotureRoutes(app);
mountAcompteRoutes(app);
mountWhatsappRoutes(app);
mountSmsRoutes(app);
mountPrintRoutes(app);
mountCampaignRoutes(app);
mountRelanceRoutes(app);
mountTransferRoutes(app);
mountHeureRoutes(app);
mountFormationRoutes(app);

// Erreur levée avec un message du dictionnaire (`MessageError`) sans gestionnaire
// propre à la route : rendue dans la langue de la requête (sous-projet 4 § 7.3).
// Toute autre erreur (sous-projet 5, report de la vague 2) : réponse JSON au
// message générique traduit, lisible par l'écran comme les autres refus,
// jamais le texte brut « Internal Server Error » ; l'erreur d'origine reste
// dans le journal du serveur.
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof MessageError) return c.json({ error: localize(c, err.message) }, 500);
  console.error(err);
  return c.json({ error: msg(c, "serveur.erreur") }, 500);
});

// ── Shared Schemas ─────────────────────────────────────────────────

const ErrorSchema = z.object({ error: z.string() }).openapi("Error");
const OkSchema = z.object({ ok: z.boolean() }).openapi("Ok");

const ConflictSchema = z.object({
  error: z.string(),
  conflicts: z.array(z.object({
    kind: z.enum(["appointment", "blocked"]),
    start_time: z.string(),
    end_time: z.string(),
    label: z.string(),
  })),
}).openapi("Conflict");

const ClientSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  notes: z.string(),
  /** Canal de ses messages automatiques : `whatsapp`, `sms` ou `none` (aucun). */
  channel: z.enum(["whatsapp", "sms", "none"]),
  /** Langue de ses messages : `fr`, `en`, ou vide pour la langue de l'institut. */
  language: z.enum(["", "fr", "en"]),
  /** Anniversaire sans année, `MM-JJ` ; vide s'il est inconnu (mini CRM, décision 1). */
  birthday: z.string(),
  /** Préférences pour chaque visite : boisson, musique, allergies (500 caractères au plus). */
  preferences: z.string(),
  /** Étiquettes libres, dans l'ordre de saisie ; « VIP » et « vip » sont la même étiquette. */
  tags: z.array(z.string()),
  /** Numéro de carte (lettres et chiffres, 4 à 32), ou null ; trouvé par la recherche (mini CRM § 5). */
  card: z.string().nullable(),
  appointment_count: z.number().int().optional(),
  /** Date (aaaa-mm-jj) du dernier rendez-vous terminé ; null si la cliente n'est jamais venue. */
  last_visit: z.string().nullable().optional(),
  /** Nombre de rendez-vous terminés. */
  visit_count: z.number().int().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Client");

/** Synthèse de la fiche (mini CRM § 1) : montants absents pour la praticienne ; `loyalty` null tant que la fidélité est inactive. */
const ClientSummarySchema = z.object({
  visits: z.number().int(),
  last_visit: z.string().nullable(),
  days_since: z.number().int().nullable(),
  next_appointment: z.object({ id: z.number().int(), date: z.string(), time: z.string() }).nullable(),
  usual_services: z.array(z.object({ name: z.string(), name_en: z.string(), count: z.number().int() })),
  favorite_staff: z.object({ id: z.number().int(), name: z.string(), color: z.string(), count: z.number().int() }).nullable(),
  products: z.array(z.object({ label_fr: z.string(), label_en: z.string(), quantity: z.number().int(), last: z.number().int() })),
  total_spent: z.number().int().optional(),
  average_basket: z.number().int().optional(),
  invoice_count: z.number().int().optional(),
  loyalty: z.object({
    balance: z.number().int(),
    next_tier: z.object({ points: z.number().int(), montant: z.number().int(), missing: z.number().int() }).nullable(),
  }).nullable(),
}).openapi("ClientSummary");

/** Dernière visite et nombre de visites d'une cliente `c` : rendez-vous terminés seulement (décision du 29/09/2026). */
const VISITS_SQL = `(SELECT MAX(scheduled_date) FROM appointments WHERE client_id = c.id AND status = 'completed') as last_visit,
       (SELECT COUNT(*) FROM appointments WHERE client_id = c.id AND status = 'completed') as visit_count`;

const StaffSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string().optional().openapi({ description: "Absent for a practitioner reading a colleague's record." }),
  phone: z.string().optional().openapi({ description: "Absent for a practitioner reading a colleague's record." }),
  title: z.string(),
  title_en: z.string(),
  color: z.string(),
  active: z.number().int(),
  appointment_count: z.number().int().optional(),
  created_at: z.string(),
}).openapi("Staff");

const ServiceSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string(),
  duration: z.number().int(),
  price: z.number(),
  color: z.string(),
  category: z.string(),
  name_en: z.string(),
  description_en: z.string(),
  category_en: z.string(),
  active: z.number().int(),
  appointment_count: z.number().int().optional(),
  created_at: z.string(),
}).openapi("Service");

const AppointmentNoteSchema = z.object({
  id: z.number().int(),
  appointment_id: z.number().int(),
  content: z.string(),
  created_at: z.string(),
}).openapi("AppointmentNote");

const AppointmentServiceSchema = z.object({
  id: z.number().int(),
  appointment_id: z.number().int(),
  service_id: z.number().int(),
  service_name: z.string().optional(),
  service_name_en: z.string().nullable().optional(),
  price: z.number(),
  duration: z.number().int(),
}).openapi("AppointmentService");

const AppointmentSchema = z.object({
  id: z.number().int(),
  identifier: z.string(),
  client_id: z.number().int(),
  staff_id: z.number().int().nullable(),
  status: z.string(),
  scheduled_date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  total_price: z.number(),
  notes: z.string(),
  is_recurring: z.number().int(),
  recurrence_interval: z.string(),
  client_name: z.string().optional(),
  client_phone: z.string().optional(),
  staff_name: z.string().nullable().optional(),
  staff_color: z.string().nullable().optional(),
  service_names: z.string().nullable().optional(),
  service_names_en: z.string().nullable().optional(),
  latest_note: z.string().nullable().optional(),
  paid: z.number().int().optional().openapi({ description: "1 when an invoice not fully credited cites the appointment, 0 otherwise." }),
  invoice_id: z.number().int().nullable().optional(),
  invoice_number: z.string().nullable().optional(),
  invoice_total: z.number().int().nullable().optional(),
  invoiced: z.number().int().optional().openapi({ description: "1 when any invoice document cites the appointment, even one fully credited: the appointment can no longer be deleted." }),
  deposit_held: z.number().int().optional().openapi({ description: "1 when a held deposit exists for this appointment, 0 otherwise. Never an amount: kept for the practitioner (redactAppointment)." }),
  appointment_services: z.array(AppointmentServiceSchema).optional(),
  appointment_notes: z.array(AppointmentNoteSchema).optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Appointment");

const BlockedSlotSchema = z.object({
  id: z.number().int(),
  staff_id: z.number().int(),
  staff_name: z.string().optional(),
  blocked_date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  reason: z.string(),
  created_at: z.string(),
}).openapi("BlockedSlot");

const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  brand: z.string(),
  category: z.string(),
  sku: z.string(),
  price: z.number(),
  cost: z.number().optional().openapi({ description: "Purchase price; absent for a practitioner." }),
  stock: z.number().int(),
  low_stock_alert: z.number().int(),
  name_en: z.string(),
  category_en: z.string(),
  image_version: z.number().int().nullable().openapi({ description: "Version of the product photo (GET /api/products/{id}/image?v=…); null without a photo. Never the bytes." }),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Product");

// Bornes des saisies du catalogue (décision 8 de la passe V 1.0) : nom non vide après retrait des
// espaces ; prix, prix d'achat et stock entiers positifs ou nuls ; durée entière de 5 à 720 minutes.
const NameInput = z.string().trim().min(1);
const FrancsInput = z.number().int().min(0);
const CountInput = z.number().int().min(0);
const MinutesInput = z.number().int().min(5).max(720);

const IdParam = z.object({ id: z.string().openapi({ description: "Resource ID" }) });

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Tire le numéro APT suivant (V1-01), dans la transaction qui écrit le
 * rendez-vous : lecture et écriture du compteur sans rien d'intercalé, et un
 * refus qui annule la transaction rend aussi le numéro (aucun trou).
 */
function takeIdentifier(db: Database): string {
  const prefix = db.prepare("SELECT value FROM _meta WHERE key = 'appointment_prefix'").get() as { value: string } | undefined;
  const counter = db.prepare("SELECT value FROM _meta WHERE key = 'appointment_counter'").get() as { value: string } | undefined;
  const next = parseInt(counter?.value || "0", 10) + 1;
  // Upsert, pas UPDATE : sans la ligne du compteur, un UPDATE ne toucherait rien et redonnerait toujours le même numéro.
  db.prepare("INSERT INTO _meta (key, value) VALUES ('appointment_counter', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(next));
  return `${prefix?.value || "APT"}-${next}`;
}

// Forme stricte d'une date (`aaaa-mm-jj`) et d'une heure (`hh:mm`) de rendez-vous : une forme fausse
// (`05/10/2026`, `9:30`) dérangeait le calcul de l'instant WhatsApp (RangeError, transaction annulée)
// et le tri des horaires (chaîne non alignée sur deux chiffres).
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const TIME_FORMAT = /^\d{2}:\d{2}$/;

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Facture active qui cite le rendez-vous `a` (sous-projet 5 § 3.4) : le
 * rendez-vous est « payé » tant qu'une facture le cite sans que les avoirs
 * l'aient entièrement reprise (vue `invoice_balance`). Après un avoir total
 * et un nouvel encaissement, la plus récente facture active est visée
 * (`ORDER BY … DESC LIMIT 1`), jamais l'ancienne. La praticienne ne reçoit
 * que `paid` et `invoiced` (`redactAppointment`), jamais un montant.
 *
 * Correctif final (point 1) : `invoiced` reste à 1 dès qu'une facture a été
 * émise pour ce rendez-vous, même entièrement reprise par un avoir (`paid`
 * revient alors à 0, lui, le rendez-vous redevient encaissable). C'est
 * `invoiced`, et non `paid`, qui masque « Supprimer » : une facture émise
 * interdit toujours la suppression (§ 3.4), même reprise.
 *
 * Correctif final (point 1) : `deposit_held` (1 si un acompte `held` existe
 * pour ce rendez-vous, 0 sinon) rejoint `paid` et `invoiced` dans ce que la
 * praticienne garde (`redactAppointment` ne retire que des montants) : son
 * propre rendez-vous payable lui montrait « Encaisser » même avec un acompte
 * déjà versé par la cliente, que le serveur refuserait à l'émission.
 */
const ACTIVE_INVOICE = `FROM invoices i JOIN invoice_balance b ON b.invoice_id = i.id WHERE i.appointment_id = a.id AND b.cancelled = 0 ORDER BY i.id DESC LIMIT 1`;
const INVOICE_SQL = `EXISTS (SELECT 1 ${ACTIVE_INVOICE}) as paid,
            (SELECT i.id ${ACTIVE_INVOICE}) as invoice_id,
            (SELECT i.number ${ACTIVE_INVOICE}) as invoice_number,
            (SELECT i.total_ttc ${ACTIVE_INVOICE}) as invoice_total,
            EXISTS (SELECT 1 FROM invoices i WHERE i.appointment_id = a.id AND i.kind = 'invoice') as invoiced,
            EXISTS (SELECT 1 FROM deposits d WHERE d.appointment_id = a.id AND d.status = 'held') as deposit_held`;

/**
 * Ligne du journal des actions sensibles (V1-03, décision 2) : auteur, poste
 * et instant de la requête. La cible porte le nom de la fiche, jamais un
 * téléphone ni le texte d'une note ; `logAudit` la borne à 64 caractères.
 */
async function journal(c: Context, entry: { action: string; target: string }): Promise<void> {
  await logAudit({ accountId: currentAccount(c).id, action: entry.action, target: entry.target, ip: clientIp(c), now: nowOf(c) });
}

/** Cible d'un changement de valeur : « Tresses\u00a0: 15 000 → 12 000 F » (prix) ou « Huile de coco\u00a0: 12 → 8 » (stock). */
function changeTarget(name: string, before: number, after: number, unit: "francs" | "stock"): string {
  const shown = (n: number) => (unit === "francs" ? formatFrancs(n) : String(n));
  const suffix = `\u00a0: ${shown(before)} → ${shown(after)}${unit === "francs" ? "\u00a0F" : ""}`;
  // Le journal garde le début de la cible : un nom trop long est raccourci pour que les valeurs survivent.
  const room = MAX_TARGET_LENGTH - [...suffix].length;
  const chars = [...name];
  const shownName = chars.length <= room ? name : `${chars.slice(0, Math.max(room - 1, 0)).join("")}…`;
  return `${shownName}${suffix}`;
}

/** The staff member's name, for the conflict message. */
async function staffName(staffId: number): Promise<string> {
  const s = await get<{ name: string }>("SELECT name FROM staff WHERE id = ?", [staffId]);
  return s?.name || "";
}

// ── Stats ──────────────────────────────────────────────────────────

const getStats = createRoute({
  method: "get",
  path: "/api/stats",
  responses: {
    200: {
      description: "Dashboard stats",
      content: { "application/json": { schema: z.object({
        appointments: z.number().int(),
        clients: z.number().int(),
        staff: z.number().int(),
        services: z.number().int(),
        products: z.number().int(),
        today_appointments: z.number().int(),
        upcoming_appointments: z.number().int(),
        completed_appointments: z.number().int(),
        revenue: z.number().optional(),
        low_stock_products: z.number().int(),
      }) } },
    },
  },
});

app.openapi(getStats, async (c) => {
  // Jour de l'institut (Douala), jamais celui d'UTC : à 00:30 à Douala, UTC est encore la veille.
  const today = doualaDay(nowOf(c));
  const appointments = await get<{ count: number }>("SELECT COUNT(*) as count FROM appointments");
  const clients = await get<{ count: number }>("SELECT COUNT(*) as count FROM clients");
  const staff = await get<{ count: number }>("SELECT COUNT(*) as count FROM staff WHERE active = 1");
  const services = await get<{ count: number }>("SELECT COUNT(*) as count FROM services WHERE active = 1");
  const products = await get<{ count: number }>("SELECT COUNT(*) as count FROM products");
  const todayAppointments = await get<{ count: number }>("SELECT COUNT(*) as count FROM appointments WHERE scheduled_date = ?", [today]);
  const upcomingAppointments = await get<{ count: number }>("SELECT COUNT(*) as count FROM appointments WHERE status IN ('booked', 'confirmed') AND scheduled_date >= ?", [today]);
  const completedAppointments = await get<{ count: number }>("SELECT COUNT(*) as count FROM appointments WHERE status = 'completed'");
  const role = currentAccount(c).role;
  const revenue = role === "manager"
    ? await get<{ total: number }>("SELECT COALESCE(SUM(total_price), 0) as total FROM appointments WHERE status = 'completed'")
    : await get<{ total: number }>("SELECT COALESCE(SUM(total_price), 0) as total FROM appointments WHERE status = 'completed' AND scheduled_date = ?", [today]);
  const lowStock = await get<{ count: number }>("SELECT COUNT(*) as count FROM products WHERE stock <= low_stock_alert");
  const stats = {
    appointments: appointments?.count || 0,
    clients: clients?.count || 0,
    staff: staff?.count || 0,
    services: services?.count || 0,
    products: products?.count || 0,
    today_appointments: todayAppointments?.count || 0,
    upcoming_appointments: upcomingAppointments?.count || 0,
    completed_appointments: completedAppointments?.count || 0,
    revenue: revenue?.total || 0,
    low_stock_products: lowStock?.count || 0,
  };
  if (role === "practitioner") {
    const { revenue: _hidden, ...withoutRevenue } = stats;
    return c.json(withoutRevenue, 200);
  }
  return c.json(stats, 200);
});

// ── Appointments ───────────────────────────────────────────────────

const listAppointments = createRoute({
  method: "get",
  path: "/api/appointments",
  request: {
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      search: z.string().optional(),
      status: z.string().optional(),
      date: z.string().optional(),
      staff_id: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Paginated appointment list",
      content: { "application/json": { schema: z.object({ appointments: z.array(AppointmentSchema), total: z.number().int() }) } },
    },
  },
});

app.openapi(listAppointments, async (c) => {
  const q = c.req.valid("query");
  const page = parseInt(q.page || "1", 10);
  const limit = parseInt(q.limit || "50", 10);
  const offset = (page - 1) * limit;

  let where = "WHERE 1=1";
  const params: unknown[] = [];

  if (q.search) {
    // Insensible aux accents et à la casse (« aicha » trouve « Aïcha »), comme les clientes ; le numéro APT reste cherché tel quel.
    where += " AND (a.identifier LIKE ? OR fold(cl.name) LIKE ?)";
    params.push(`%${q.search}%`, foldPattern(q.search));
  }
  if (q.status) { where += " AND a.status = ?"; params.push(q.status); }
  if (q.date) { where += " AND a.scheduled_date = ?"; params.push(q.date); }
  if (q.staff_id) { where += " AND a.staff_id = ?"; params.push(q.staff_id); }

  const total = await get<{ count: number }>(
    `SELECT COUNT(*) as count FROM appointments a LEFT JOIN clients cl ON cl.id = a.client_id ${where}`,
    params,
  );

  const appointments = await query<Record<string, unknown>>(
    `SELECT a.*, cl.name as client_name, cl.phone as client_phone,
            s.name as staff_name, s.color as staff_color, ${INVOICE_SQL}
     FROM appointments a
     LEFT JOIN clients cl ON cl.id = a.client_id
     LEFT JOIN staff s ON s.id = a.staff_id
     ${where}
     ORDER BY a.scheduled_date DESC, a.start_time ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const role = currentAccount(c).role;
  return c.json({ appointments: appointments.map((a) => redactAppointment(role, a)), total: total?.count || 0 }, 200);
});

// Calendar view - appointments for a date range
const getCalendar = createRoute({
  method: "get",
  path: "/api/calendar",
  request: {
    query: z.object({ start: z.string(), end: z.string() }),
  },
  responses: {
    200: {
      description: "Calendar appointments and blocked slots",
      content: { "application/json": { schema: z.object({
        appointments: z.array(AppointmentSchema),
        blocked_slots: z.array(BlockedSlotSchema),
      }) } },
    },
  },
});

app.openapi(getCalendar, async (c) => {
  const { start, end } = c.req.valid("query");
  const appointments = await query<Record<string, unknown>>(
    `SELECT a.*, cl.name as client_name, cl.phone as client_phone,
            s.name as staff_name, s.color as staff_color, ${INVOICE_SQL}
     FROM appointments a
     LEFT JOIN clients cl ON cl.id = a.client_id
     LEFT JOIN staff s ON s.id = a.staff_id
     WHERE a.scheduled_date >= ? AND a.scheduled_date <= ? AND a.status != 'cancelled'
     ORDER BY a.start_time ASC`,
    [start, end],
  );

  // Attach services to each appointment
  for (const apt of appointments) {
    const svcs = await query<Record<string, unknown>>(
      `SELECT aps.*, sv.name as service_name, sv.name_en as service_name_en FROM appointment_services aps
       LEFT JOIN services sv ON sv.id = aps.service_id
       WHERE aps.appointment_id = ?`,
      [apt.id],
    );
    (apt as Record<string, unknown>).appointment_services = svcs;
  }

  const blocked = await query<Record<string, unknown>>(
    `SELECT b.*, s.name as staff_name FROM blocked_slots b
     LEFT JOIN staff s ON s.id = b.staff_id
     WHERE b.blocked_date >= ? AND b.blocked_date <= ?
     ORDER BY b.start_time ASC`,
    [start, end],
  );

  const role = currentAccount(c).role;
  return c.json({ appointments: appointments.map((a) => redactAppointment(role, a)), blocked_slots: blocked }, 200);
});

// Get single appointment
const getAppointment = createRoute({
  method: "get",
  path: "/api/appointments/{id}",
  request: { params: IdParam },
  responses: {
    200: {
      description: "Appointment detail",
      content: { "application/json": { schema: z.object({ appointment: AppointmentSchema }) } },
    },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getAppointment, async (c) => {
  const { id } = c.req.valid("param");
  const apt = await get<Record<string, unknown>>(
    `SELECT a.*, cl.name as client_name, cl.phone as client_phone,
            s.name as staff_name, s.color as staff_color, ${INVOICE_SQL}
     FROM appointments a
     LEFT JOIN clients cl ON cl.id = a.client_id
     LEFT JOIN staff s ON s.id = a.staff_id
     WHERE a.id = ?`,
    [id],
  );
  if (!apt) return c.json({ error: msg(c, "rdv.introuvable") }, 404);

  const svcs = await query<Record<string, unknown>>(
    `SELECT aps.*, sv.name as service_name, sv.name_en as service_name_en FROM appointment_services aps
     LEFT JOIN services sv ON sv.id = aps.service_id
     WHERE aps.appointment_id = ?`,
    [id],
  );
  apt.appointment_services = svcs;

  const notes = await query<Record<string, unknown>>(
    "SELECT * FROM appointment_notes WHERE appointment_id = ? ORDER BY created_at DESC",
    [id],
  );
  apt.appointment_notes = notes;

  return c.json({ appointment: redactAppointment(currentAccount(c).role, apt) }, 200);
});

// Create appointment
const createAppointment = createRoute({
  method: "post",
  path: "/api/appointments",
  request: {
    body: { content: { "application/json": { schema: z.object({
      client_id: z.number().int(),
      staff_id: z.number().int().nullable().optional(),
      scheduled_date: z.string(),
      start_time: z.string().optional(),
      notes: z.string().optional(),
      is_recurring: z.number().int().optional(),
      recurrence_interval: z.string().optional(),
      service_ids: z.array(z.number().int()).optional(),
      allow_conflict: z.boolean().optional().openapi({
        description: "Book even though the staff member is already busy then. Salons do deliberately overlap (a colour processes while the next client is cut), so this is allowed, but never by accident.",
      }),
    }) } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: z.object({ appointment: AppointmentSchema }) } } },
    400: { description: "Invalid times", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Client or staff member not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Staff member is already busy", content: { "application/json": { schema: ConflictSchema } } },
  },
});

app.openapi(createAppointment, async (c) => {
  const body = c.req.valid("json");
  const startTime = body.start_time ?? "09:00";

  // Calculate total duration and price from services
  let totalDuration = 60;
  let totalPrice = 0;
  const serviceIds = body.service_ids || [];

  if (serviceIds.length > 0) {
    const svcs = await query<{ duration: number; price: number }>(
      `SELECT duration, price FROM services WHERE id IN (${serviceIds.map(() => "?").join(",")})`,
      serviceIds,
    );
    totalDuration = svcs.reduce((sum, s) => sum + s.duration, 0);
    totalPrice = svcs.reduce((sum, s) => sum + s.price, 0);
  }

  // Forme stricte avant tout calcul : une date ou une heure mal formée (`05/10/2026`, `9:30`) ne doit
  // jamais atteindre le calcul de l'instant WhatsApp (RangeError, 500, transaction annulée).
  if (!DATE_FORMAT.test(body.scheduled_date)) return c.json({ error: msg(c, "vente.date") }, 400);
  if (!TIME_FORMAT.test(startTime)) return c.json({ error: msg(c, "rdv.heures_format") }, 400);

  // Grille de l'agenda (décision 6) : début de 07:00 à 21:00 par pas de 5 minutes, fin au plus tard à 21:00.
  const startRefusal = validTime(startTime);
  if (startRefusal) return c.json({ error: msg(c, startRefusal) }, 400);
  const start = toMinutes(startTime)!;
  if (totalDuration <= 0) return c.json({ error: msg(c, "rdv.duree_positive") }, 400);
  if (start + totalDuration >= 24 * 60) {
    return c.json({ error: msg(c, "rdv.meme_jour") }, 400);
  }
  const endTime = addMinutes(startTime, totalDuration);
  if (start + totalDuration > DAY_CLOSE) return c.json({ error: msg(c, "rdv.fin_apres_fermeture", { fin: endTime, fermeture: CLOSE_TIME }) }, 400);

  // Cliente ou praticienne supprimée entre-temps (V1-09) : 404 lisible avant toute écriture.
  if (!(await exists("SELECT COUNT(*) as count FROM clients WHERE id = ?", body.client_id))) return c.json({ error: msg(c, "cliente.introuvable") }, 404);
  if (body.staff_id && !(await exists("SELECT COUNT(*) as count FROM staff WHERE id = ?", body.staff_id))) return c.json({ error: msg(c, "equipe.introuvable") }, 404);

  // Contrôle du chevauchement, numéro APT, rendez-vous, prestations et confirmation WhatsApp dans une
  // seule transaction (sous-projet 7 § 3, V1-01) : deux postes ne peuvent plus réserver le même créneau
  // entre le contrôle et l'écriture, et un refus ne consomme aucun numéro. Les réglages des messages
  // sont lus avant (lecture asynchrone).
  const messages = await readMessageSettings();
  const now = nowOf(c);
  const outcome = c.env.STORAGE.transaction!((db): { conflicts: Busy[] } | { id: number } => {
    // Rien à disputer pour un rendez-vous sans praticienne.
    if (body.staff_id && !body.allow_conflict) {
      const conflicts = findConflicts(startTime, endTime, busyOn(db, body.staff_id, body.scheduled_date));
      if (conflicts.length > 0) return { conflicts };
    }
    const identifier = takeIdentifier(db);
    const result = db.prepare(
      `INSERT INTO appointments (identifier, client_id, staff_id, scheduled_date, start_time, end_time, total_price, notes, is_recurring, recurrence_interval, booked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(identifier, body.client_id, body.staff_id ?? null, body.scheduled_date, startTime, endTime, totalPrice,
      body.notes || "", body.is_recurring || 0, body.recurrence_interval || "", now);
    const id = Number(result.lastInsertRowid);
    for (const svcId of serviceIds) {
      const svc = db.prepare("SELECT duration, price FROM services WHERE id = ?").get(svcId) as { duration: number; price: number } | undefined;
      if (svc) db.prepare("INSERT INTO appointment_services (appointment_id, service_id, price, duration) VALUES (?, ?, ?, ?)").run(id, svcId, svc.price, svc.duration);
    }
    queueAppointmentMessage(db, messages, "confirmation", id, now);
    return { id };
  });
  if ("conflicts" in outcome) {
    return c.json({ error: describeConflicts(await staffName(body.staff_id!), outcome.conflicts, "book", requestLang(c)), conflicts: outcome.conflicts }, 409);
  }
  const aptId = outcome.id;

  const apt = await get<Record<string, unknown>>(
    `SELECT a.*, cl.name as client_name, cl.phone as client_phone,
            s.name as staff_name, s.color as staff_color
     FROM appointments a
     LEFT JOIN clients cl ON cl.id = a.client_id
     LEFT JOIN staff s ON s.id = a.staff_id
     WHERE a.id = ?`,
    [aptId],
  );

  return c.json({ appointment: redactAppointment(currentAccount(c).role, apt!) }, 201);
});

// Update appointment
const updateAppointment = createRoute({
  method: "put",
  path: "/api/appointments/{id}",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      client_id: z.number().int().optional(),
      staff_id: z.number().int().nullable().optional(),
      status: z.string().optional(),
      scheduled_date: z.string().optional(),
      start_time: z.string().optional(),
      end_time: z.string().optional(),
      total_price: z.number().optional(),
      notes: z.string().optional(),
      allow_conflict: z.boolean().optional().openapi({
        description: "Move the appointment even though the staff member is already busy then.",
      }),
      notify_transfer: z.boolean().optional().openapi({
        description: "When staff_id changes to another staff member: true queues the client's « transfert » message (new date and time included) instead of the confirmation. A change between two staff members is noted on the appointment and in the audit log either way.",
      }),
    }) } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Invalid times", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Staff member is already busy", content: { "application/json": { schema: ConflictSchema } } },
  },
});

app.openapi(updateAppointment, async (c) => {
  const { id } = c.req.valid("param");
  // `notify_transfer` n'est pas une colonne : retiré du corps avant la construction de l'UPDATE.
  const { allow_conflict, notify_transfer, ...body } = c.req.valid("json");
  // Fin saisie par la personne (et non recalculée d'après la durée) : soumise au pas de 5 minutes.
  const endGiven = body.end_time !== undefined;

  const existing = await get<{
    identifier: string; client_id: number | null; staff_id: number | null; scheduled_date: string; start_time: string; end_time: string; status: string;
  }>("SELECT identifier, client_id, staff_id, scheduled_date, start_time, end_time, status FROM appointments WHERE id = ?", [id]);
  if (!existing) return c.json({ error: msg(c, "rdv.introuvable") }, 404);

  // Forme stricte des champs fournis (mêmes raisons qu'à la création).
  if (body.scheduled_date !== undefined && !DATE_FORMAT.test(body.scheduled_date)) return c.json({ error: msg(c, "vente.date") }, 400);
  if (body.start_time !== undefined && !TIME_FORMAT.test(body.start_time)) return c.json({ error: msg(c, "rdv.heures_format") }, 400);
  if (body.end_time !== undefined && !TIME_FORMAT.test(body.end_time)) return c.json({ error: msg(c, "rdv.heures_format") }, 400);

  // La cliente est figée dès qu'un acompte en attente ou une facture active cite ce rendez-vous
  // (correctif 1 de la tâche 2, vague 3b) : son reçu ou sa facture la désignent déjà. Les autres
  // champs restent modifiables. 400 (pas 409, réservé au schéma `ConflictSchema` de cette route).
  if (body.client_id !== undefined && body.client_id !== existing.client_id) {
    const held = await exists("SELECT COUNT(*) as count FROM deposits WHERE appointment_id = ? AND status = 'held'", id);
    const invoiced = await exists(
      "SELECT COUNT(*) as count FROM invoices i JOIN invoice_balance b ON b.invoice_id = i.id WHERE i.appointment_id = ? AND b.cancelled = 0",
      id,
    );
    if (held || invoiced) return c.json({ error: msg(c, "rdv.cliente_figee") }, 400);
  }

  // Where the appointment lands once this patch is applied.
  const staffId = body.staff_id !== undefined ? body.staff_id : existing.staff_id;
  const date = body.scheduled_date ?? existing.scheduled_date;
  const startTime = body.start_time ?? existing.start_time;

  // Moving an appointment keeps its length. Without this, patching start_time
  // alone left the old end_time behind and silently resized the booking.
  let endTime = body.end_time ?? existing.end_time;
  if (body.start_time !== undefined && body.start_time !== existing.start_time && body.end_time === undefined) {
    const was = toMinutes(existing.start_time);
    const wasEnd = toMinutes(existing.end_time);
    const duration = was !== null && wasEnd !== null ? Math.max(wasEnd - was, 0) : 0;
    endTime = addMinutes(startTime, duration);
    body.end_time = endTime;
  }

  const moved = staffId !== existing.staff_id || date !== existing.scheduled_date
    || startTime !== existing.start_time || endTime !== existing.end_time;
  const status = body.status ?? existing.status;
  const restored = existing.status === "cancelled" && status !== "cancelled";

  // An existing deliberate overlap must not block notes, check-in, completion,
  // or cancellation. Restoring a cancelled booking occupies its slot again.
  if (moved || restored) {
    const start = toMinutes(startTime);
    const end = toMinutes(endTime);
    if (start === null || end === null) return c.json({ error: msg(c, "rdv.heures_format") }, 400);
    if (end <= start) return c.json({ error: msg(c, "rdv.fin_apres_debut") }, 400);
    // Grille de l'agenda (décision 6) : seules les heures envoyées sont contrôlées. Un ancien rendez-vous
    // hors grille (06:30) qui change seulement de praticienne, de date ou de statut garde ses heures.
    if (body.start_time !== undefined || endGiven) {
      const startRefusal = validTime(startTime);
      if (startRefusal) return c.json({ error: msg(c, startRefusal) }, 400);
      // Fin calculée ou saisie après la fermeture : le message nomme l'heure de fin (restes de la V 1.0, point 5).
      if (end > DAY_CLOSE) return c.json({ error: msg(c, "rdv.fin_apres_fermeture", { fin: endTime, fermeture: CLOSE_TIME }) }, 400);
      const endRefusal = endGiven ? validTime(endTime) : null;
      if (endRefusal) return c.json({ error: msg(c, endRefusal) }, 400);
    }
  }
  // Le chevauchement se contrôle dans la transaction d'écriture (V1-01), sur l'occupation relue là.
  const checkConflicts = (moved || restored) && status !== "cancelled" && Boolean(staffId) && !allow_conflict;

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, val] of Object.entries(body)) {
    if (val !== undefined) { sets.push(`${key} = ?`); params.push(val); }
  }
  // Déplacé (date ou heure) : pris de nouveau à cet instant, pour la règle des rappels, et confirmé
  // de nouveau dans la même transaction, sauf s'il est annulé (sous-projet 7 § 3). Changer la cliente
  // d'un rendez-vous futur non annulé inscrit de même une nouvelle confirmation, pour elle : sans quoi
  // confirmation et rappel déjà en file partiraient vers l'ancienne cliente (`withoutPurpose` les ignore
  // désormais, mais la nouvelle cliente doit recevoir la sienne).
  const rescheduled = date !== existing.scheduled_date || startTime !== existing.start_time;
  const clientChanged = body.client_id !== undefined && body.client_id !== existing.client_id;
  const now = nowOf(c);
  // Restauré (annulé puis réservé ou confirmé de nouveau, vague 2) : mêmes règles qu'un déplacement, pris
  // de nouveau à cet instant et confirmé ; un rappel passé par la file pendant l'annulation (marqué « ignoré »,
  // jamais envoyé) libère sa clé pour que la tâche des rappels puisse le remettre en file. Un rappel réellement
  // envoyé pour la même date et heure garde la sienne : la cliente l'a déjà reçu.
  if (rescheduled || restored) { sets.push("booked_at = ?"); params.push(now); }
  sets.push("updated_at = datetime('now')");
  // Changement de praticienne (spec du 04/10/2026, décisions 5, 10 et 12) : d'une praticienne à une autre,
  // note sur le rendez-vous et ligne au journal, case cochée ou non. Case cochée et rendez-vous non annulé :
  // le message « transfert » (nouvelle date et nouvelle heure comprises) part seul, à la place de la
  // confirmation. Vers « Non attribué » : rien de tout cela (décision 14).
  const staffChanged = staffId !== existing.staff_id;
  const transferred = staffChanged && existing.staff_id !== null && staffId !== null;
  // Cliente changée ou rendez-vous restauré : la confirmation l'emporte (note et journal restent écrits).
  const notifyTransfer = staffChanged && staffId !== null && notify_transfer === true && status !== "cancelled" && !clientChanged && !restored;
  const confirm = (rescheduled || clientChanged || restored) && status !== "cancelled";
  const messages = confirm || notifyTransfer || transferred ? await readMessageSettings() : null;
  const names = transferred ? { from: await staffName(existing.staff_id!), to: await staffName(staffId!) } : null;
  const account = currentAccount(c);
  let transferQueued = false;
  const conflicts = c.env.STORAGE.transaction!((db): Busy[] => {
    if (checkConflicts) {
      const found = findConflicts(startTime, endTime, busyOn(db, staffId!, date, Number(id)));
      if (found.length > 0) return found;
    }
    db.prepare(`UPDATE appointments SET ${sets.join(", ")} WHERE id = ?`).run(...(params as (string | number | null)[]), id);
    if (restored) db.prepare("DELETE FROM outbox WHERE kind = 'whatsapp' AND manual = 'ignored' AND dedupe_key LIKE ?").run(`wa:rappel:${Number(id)}:%`);
    if (messages && names) {
      db.prepare("INSERT INTO appointment_notes (appointment_id, content) VALUES (?, ?)")
        .run(Number(id), transferNote(messages.lang, { from: names.from, to: names.to, by: account.display_name, now }));
    }
    if (messages && notifyTransfer) transferQueued = queueAppointmentMessage(db, messages, "transfert", Number(id), now);
    else if (messages && confirm) queueAppointmentMessage(db, messages, "confirmation", Number(id), now);
    return [];
  });
  if (conflicts.length > 0) {
    return c.json({ error: describeConflicts(await staffName(staffId!), conflicts, "book", requestLang(c)), conflicts }, 409);
  }
  if (messages && names) {
    await logAudit({
      accountId: account.id, action: "rdv.transfert", ip: clientIp(c), now,
      target: message(messages.lang, "transfert.journal_un", { ref: existing.identifier, de: names.from, vers: names.to }),
    });
  }
  // La pastille « À envoyer à la main » suit la file : le middleware ne publie que « appointments ».
  if (transferQueued) publish({ resource: "outbox" });
  return c.json({ ok: true }, 200);
});

// Delete appointment
const deleteAppointment = createRoute({
  method: "delete",
  path: "/api/appointments/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
    409: { description: "The appointment has been paid: cancel it instead", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteAppointment, async (c) => {
  const { id } = c.req.valid("param");
  // Un rendez-vous encaissé garde sa facture (sous-projet 5 § 3.4) : il s'annule, il ne se supprime plus.
  if (await exists("SELECT COUNT(*) as count FROM invoices WHERE appointment_id = ?", id)) {
    return c.json({ error: msg(c, "suppression.rdv_facture") }, 409);
  }
  // Un reçu d'acompte le cite (vague 3b) : même règle que la facture, il s'annule (l'acompte se rembourse ou se garde).
  if (await exists("SELECT COUNT(*) as count FROM deposits WHERE appointment_id = ?", id)) {
    return c.json({ error: msg(c, "suppression.rdv_acompte") }, 409);
  }
  const apt = await get<{ identifier: string }>("SELECT identifier FROM appointments WHERE id = ?", [id]);
  await run("DELETE FROM appointments WHERE id = ?", [id]);
  if (apt) await journal(c, { action: "rdv.suppression", target: apt.identifier });
  return c.json({ ok: true }, 200);
});

// Appointment notes
const addAppointmentNote = createRoute({
  method: "post",
  path: "/api/appointments/{id}/notes",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({ content: z.string().trim().min(1).max(2000) }) } } },
  },
  responses: {
    201: { description: "Note added", content: { "application/json": { schema: OkSchema } } },
    404: { description: "Appointment not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(addAppointmentNote, async (c) => {
  const { id } = c.req.valid("param");
  const { content } = c.req.valid("json");
  // Rendez-vous supprimé entre-temps (V1-09) : 404 lisible, jamais l'erreur de clé étrangère en 500.
  if (!(await exists("SELECT COUNT(*) as count FROM appointments WHERE id = ?", id))) return c.json({ error: msg(c, "rdv.introuvable") }, 404);
  await run("INSERT INTO appointment_notes (appointment_id, content) VALUES (?, ?)", [id, content]);
  return c.json({ ok: true }, 201);
});

const deleteNote = createRoute({
  method: "delete",
  path: "/api/notes/{id}",
  request: { params: IdParam },
  responses: { 200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } } },
});

app.openapi(deleteNote, async (c) => {
  const { id } = c.req.valid("param");
  // Cible : le rendez-vous de la note, jamais son texte.
  const note = await get<{ identifier: string }>(
    "SELECT a.identifier FROM appointment_notes n JOIN appointments a ON a.id = n.appointment_id WHERE n.id = ?", [id],
  );
  await run("DELETE FROM appointment_notes WHERE id = ?", [id]);
  if (note) await journal(c, { action: "rdv.note_suppression", target: note.identifier });
  return c.json({ ok: true }, 200);
});

// ── Clients ───────────────────────────────────────────────────────

const listClients = createRoute({
  method: "get",
  path: "/api/clients",
  request: {
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      search: z.string().optional(),
      tag: z.string().optional().openapi({ description: "Exact tag filter, accents and case ignored." }),
    }),
  },
  responses: {
    200: {
      description: "Paginated client list",
      content: { "application/json": { schema: z.object({ clients: z.array(ClientSchema), total: z.number().int() }) } },
    },
  },
});

app.openapi(listClients, async (c) => {
  const q = c.req.valid("query");
  const page = parseInt(q.page || "1", 10);
  const limit = parseInt(q.limit || "50", 10);
  const offset = (page - 1) * limit;

  let where = "WHERE 1=1";
  const params: unknown[] = [];
  // Mini CRM désactivé (interrupteur général) : ni recherche par étiquette ni filtre `tag`.
  const crm = await crmActive();
  if (q.search) {
    // Insensible aux accents et à la casse (« aicha » trouve « Aïcha ») : fonction SQL `fold` (storage.ts) ;
    // la recherche trouve aussi les étiquettes (mini CRM, décision 10), seulement quand il est activé.
    const byTag = crm ? " OR EXISTS (SELECT 1 FROM client_tags t WHERE t.client_id = c.id AND t.tag_key LIKE ?)" : "";
    where += ` AND (fold(c.name) LIKE ? OR fold(c.email) LIKE ? OR fold(c.phone) LIKE ?${byTag} OR c.card LIKE ?)`;
    const s = foldPattern(q.search);
    // Numéro de carte : comparé sous sa forme enregistrée (sans espaces ni tirets, majuscules) ; LIKE '' ne trouve rien.
    const card = normalizeCard(q.search);
    params.push(s, s, s, ...(crm ? [s] : []), card ? `%${card}%` : "");
  }
  const tag = crm ? (q.tag ?? "").replace(/\s+/g, " ").trim() : "";
  if (tag) {
    // Filtre exact par étiquette, repliée comme à l'enregistrement (`?tag=vip` trouve « VIP »).
    where += " AND EXISTS (SELECT 1 FROM client_tags t WHERE t.client_id = c.id AND t.tag_key = ?)";
    params.push(fold(tag));
  }

  const total = await get<{ count: number }>(`SELECT COUNT(*) as count FROM clients c ${where}`, params);
  const clients = await query<Record<string, unknown>>(
    `SELECT c.*, (SELECT COUNT(*) FROM appointments WHERE client_id = c.id) as appointment_count,
       ${VISITS_SQL},
       ${TAGS_SQL}
     FROM clients c ${where} ORDER BY c.name ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return c.json({ clients: clients.map(withTags), total: total?.count || 0 }, 200);
});

const getAllClients = createRoute({
  method: "get",
  path: "/api/clients/all",
  responses: {
    200: {
      description: "All clients for lookup",
      content: { "application/json": { schema: z.object({ clients: z.array(z.object({ id: z.number().int(), name: z.string(), card: z.string().nullable() })) }) } },
    },
  },
});

app.openapi(getAllClients, async (c) => {
  const clients = await query<{ id: number; name: string; card: string | null }>("SELECT id, name, card FROM clients ORDER BY name ASC");
  return c.json({ clients }, 200);
});

const listClientTags = createRoute({
  method: "get",
  path: "/api/clients/tags",
  responses: {
    200: {
      description: "Tags in use with the number of clients carrying each, most used first then by name",
      content: { "application/json": { schema: z.object({ tags: z.array(z.object({ tag: z.string(), count: z.number().int() })) }) } },
    },
  },
});

// Avant `/api/clients/{id}` : déclarée après, « tags » y serait lu comme un identifiant.
app.openapi(listClientTags, async (c) => {
  const tags = c.env.STORAGE.transaction!((db) => listTagCounts(db));
  return c.json({ tags }, 200);
});

const getClient = createRoute({
  method: "get",
  path: "/api/clients/{id}",
  request: { params: IdParam },
  responses: {
    200: {
      description: "Client detail with appointments and the summary of her record",
      content: { "application/json": { schema: z.object({ client: ClientSchema, appointments: z.array(AppointmentSchema), summary: ClientSummarySchema.nullable() }) } },
    },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getClient, async (c) => {
  const { id } = c.req.valid("param");
  const client = await get<Record<string, unknown>>(`SELECT c.*, ${VISITS_SQL}, ${TAGS_SQL} FROM clients c WHERE c.id = ?`, [id]);
  if (!client) return c.json({ error: msg(c, "rdv.introuvable") }, 404);
  const appointments = await query<Record<string, unknown>>(
    `SELECT a.*, s.name as staff_name, s.color as staff_color,
            (SELECT GROUP_CONCAT(name, ', ')
             FROM (
               SELECT sv.name
               FROM appointment_services aps
               JOIN services sv ON sv.id = aps.service_id
               WHERE aps.appointment_id = a.id
               ORDER BY aps.id
             )) as service_names,
            (SELECT GROUP_CONCAT(name_en, ', ')
             FROM (
               SELECT CASE WHEN TRIM(sv.name_en) != '' THEN sv.name_en ELSE sv.name END AS name_en
               FROM appointment_services aps
               JOIN services sv ON sv.id = aps.service_id
               WHERE aps.appointment_id = a.id
               ORDER BY aps.id
             )) as service_names_en,
            (SELECT an.content
             FROM appointment_notes an
             WHERE an.appointment_id = a.id
             ORDER BY an.created_at DESC, an.id DESC
             LIMIT 1) as latest_note
     FROM appointments a LEFT JOIN staff s ON s.id = a.staff_id
     WHERE a.client_id = ? ORDER BY a.scheduled_date DESC LIMIT 50`,
    [id],
  );
  const role = currentAccount(c).role;
  // Synthèse de la fiche (mini CRM § 1) : le module retire lui-même les montants pour la praticienne.
  // Fidélité (mini CRM § 2) : solde et prochain palier pour la gérante et la réception, fidélité active ; sinon `null`.
  // Mini CRM désactivé (interrupteur général) : pas de synthèse ; anniversaire, préférences et étiquettes restent dans la cliente (données gardées).
  const loyaltySettings = role === "practitioner" ? null : await readLoyaltySettings();
  const loyalty = loyaltySettings?.active ? (db: Database, clientId: number) => loyaltySummary(db, clientId, loyaltySettings.tiers) : undefined;
  const summary = (await crmActive()) ? c.env.STORAGE.transaction!((db) => clientSummary(db, Number(id), { now: nowOf(c), role, loyalty })) : null;
  return c.json({ client: withTags(client), appointments: appointments.map((a) => redactAppointment(role, a)), summary }, 200);
});

const createClient = createRoute({
  method: "post",
  path: "/api/clients",
  request: {
    body: { content: { "application/json": { schema: z.object({
      name: z.string(),
      email: z.string().optional(),
      phone: z.string().optional(),
      notes: z.string().optional(),
      channel: z.enum(["whatsapp", "sms", "none"]).optional(),
      language: z.enum(["", "fr", "en"]).optional(),
      birthday: z.unknown().optional().openapi({ description: "Birthday without year, MM-DD, or empty." }),
      preferences: z.unknown().optional().openapi({ description: "Preferences for each visit, 500 characters at most." }),
      tags: z.unknown().optional().openapi({ description: "Free tags: up to 10, 30 characters each." }),
      card: z.unknown().optional().openapi({ description: "Card number, 4 to 32 letters or digits; spaces and hyphens ignored." }),
    }) } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: z.object({ client: ClientSchema }) } } },
    400: { description: "Invalid birthday, preferences, tags or card number", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Card number already used by another client", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createClient, async (c) => {
  const body = c.req.valid("json");
  const crm = readCrmFields(body as Record<string, unknown>);
  if ("error" in crm) return c.json({ error: msg(c, crm.error) }, 400);
  const card = crm.columns.card ?? null;
  // Fiche et étiquettes dans une seule transaction : tout est écrit, ou rien ; numéro de carte libre vérifié dedans.
  const id = c.env.STORAGE.transaction!((db) => {
    if (card !== null && db.prepare("SELECT 1 AS x FROM clients WHERE card = ?").get(card)) return null;
    const result = db.prepare(
      "INSERT INTO clients (name, email, phone, notes, channel, language, birthday, preferences, card) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(body.name, body.email || "", body.phone || "", body.notes || "", body.channel ?? "whatsapp", body.language ?? "", crm.columns.birthday ?? "", crm.columns.preferences ?? "", card);
    const clientId = Number(result.lastInsertRowid);
    if (crm.tags) writeTags(db, clientId, crm.tags);
    return clientId;
  });
  if (id === null) return c.json({ error: msg(c, "cliente.carte_prise") }, 409);
  const client = await get<Record<string, unknown>>(`SELECT c.*, ${TAGS_SQL} FROM clients c WHERE c.id = ?`, [id]);
  return c.json({ client: withTags(client!) }, 201);
});

const updateClient = createRoute({
  method: "put",
  path: "/api/clients/{id}",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      notes: z.string().optional(),
      channel: z.enum(["whatsapp", "sms", "none"]).optional(),
      language: z.enum(["", "fr", "en"]).optional(),
      birthday: z.unknown().optional().openapi({ description: "Birthday without year, MM-DD, or empty to clear it." }),
      preferences: z.unknown().optional().openapi({ description: "Preferences for each visit, 500 characters at most." }),
      tags: z.unknown().optional().openapi({ description: "Replaces all the client's tags." }),
      card: z.unknown().optional().openapi({ description: "Card number, or empty to remove it." }),
    }) } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Invalid birthday, preferences, tags or card number", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Card number already used by another client", content: { "application/json": { schema: ErrorSchema } } },
  },
});

/** Colonnes simples d'une cliente modifiables par `PUT` ; les champs du mini CRM passent par `readCrmFields`. */
const CLIENT_COLUMNS = ["name", "email", "phone", "notes", "channel", "language"] as const;

app.openapi(updateClient, async (c) => {
  const { id } = c.req.valid("param");
  // La praticienne n'écrit que la note et les préférences (FIELD_LIMITS) : le reste est retiré avant tout contrôle.
  const body = restrictFields(currentAccount(c).role, "clients", c.req.valid("json") as Record<string, unknown>);
  const crm = readCrmFields(body);
  if ("error" in crm) return c.json({ error: msg(c, crm.error) }, 400);
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const key of CLIENT_COLUMNS) {
    const value = body[key];
    if (typeof value === "string") { sets.push(`${key} = ?`); params.push(value); }
  }
  for (const [key, value] of Object.entries(crm.columns)) { sets.push(`${key} = ?`); params.push(value); }
  if (sets.length === 0 && !crm.tags) return c.json({ ok: true }, 200);
  const card = crm.columns.card;
  const outcome = c.env.STORAGE.transaction!((db) => {
    if (!db.prepare("SELECT 1 AS x FROM clients WHERE id = ?").get(Number(id))) return "absente";
    if (card && db.prepare("SELECT 1 AS x FROM clients WHERE card = ? AND id <> ?").get(card, Number(id))) return "carte";
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE clients SET ${sets.join(", ")} WHERE id = ?`).run(...params, Number(id));
    if (crm.tags) writeTags(db, Number(id), crm.tags);
    return "ok";
  });
  if (outcome === "absente") return c.json({ error: msg(c, "vente.cliente_inconnue") }, 404);
  if (outcome === "carte") return c.json({ error: msg(c, "cliente.carte_prise") }, 409);
  return c.json({ ok: true }, 200);
});

const deleteClient = createRoute({
  method: "delete",
  path: "/api/clients/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
    409: { description: "The client has appointments: the record is kept", content: { "application/json": { schema: ErrorSchema } } },
  },
});

/** Vrai si la requête `sql` (un COUNT) trouve au moins une ligne. */
async function exists(sql: string, id: number | string): Promise<boolean> {
  return ((await get<{ count: number }>(sql, [id]))?.count ?? 0) > 0;
}

app.openapi(deleteClient, async (c) => {
  const { id } = c.req.valid("param");
  // Supprimer une cliente effacerait ses rendez-vous (ON DELETE CASCADE) : refusé dès qu'elle en a (décision du 29/09/2026).
  if (await exists("SELECT COUNT(*) as count FROM appointments WHERE client_id = ?", id)) {
    return c.json({ error: msg(c, "suppression.cliente_historique") }, 409);
  }
  // Ses factures la citent (vente de comptoir sans rendez-vous comprise) : sa fiche est gardée (sous-projet 5 § 3.3).
  if (await exists("SELECT COUNT(*) as count FROM invoices WHERE client_id = ?", id)) {
    return c.json({ error: msg(c, "suppression.cliente_facturee") }, 409);
  }
  const client = await get<{ name: string }>("SELECT name FROM clients WHERE id = ?", [id]);
  await run("DELETE FROM clients WHERE id = ?", [id]);
  if (client) await journal(c, { action: "cliente.suppression", target: client.name });
  return c.json({ ok: true }, 200);
});

// ── Staff ─────────────────────────────────────────────────────────

const listStaff = createRoute({
  method: "get",
  path: "/api/staff",
  responses: {
    200: {
      description: "All staff members",
      content: { "application/json": { schema: z.object({ staff: z.array(StaffSchema) }) } },
    },
  },
});

app.openapi(listStaff, async (c) => {
  const staff = await query<Record<string, unknown>>(
    `SELECT s.*, (SELECT COUNT(*) FROM appointments WHERE staff_id = s.id) as appointment_count
     FROM staff s ORDER BY s.name ASC`,
  );
  const account = currentAccount(c);
  return c.json({ staff: staff.map((s) => redactStaff(account, s)) }, 200);
});

const getAllStaff = createRoute({
  method: "get",
  path: "/api/staff/all",
  responses: {
    200: {
      description: "All staff for lookup",
      content: { "application/json": { schema: z.object({ staff: z.array(z.object({ id: z.number().int(), name: z.string(), color: z.string() })) }) } },
    },
  },
});

app.openapi(getAllStaff, async (c) => {
  const staff = await query<{ id: number; name: string; color: string }>("SELECT id, name, color FROM staff WHERE active = 1 ORDER BY name ASC");
  return c.json({ staff }, 200);
});

const createStaff = createRoute({
  method: "post",
  path: "/api/staff",
  request: {
    body: { content: { "application/json": { schema: z.object({
      name: z.string(),
      email: z.string().optional(),
      phone: z.string().optional(),
      title: z.string().optional(),
      title_en: z.string().optional().openapi({ description: "English role, optional; the French title is shown when empty." }),
      color: z.string().optional(),
    }) } } },
  },
  responses: { 201: { description: "Created", content: { "application/json": { schema: z.object({ staff: StaffSchema }) } } } },
});

app.openapi(createStaff, async (c) => {
  const body = c.req.valid("json");
  const result = await run(
    "INSERT INTO staff (name, email, phone, title, title_en, color) VALUES (?, ?, ?, ?, ?, ?)",
    [body.name, body.email || "", body.phone || "", body.title || "", body.title_en || "", body.color || "#7c3aed"],
  );
  const staff = await get<Record<string, unknown>>("SELECT * FROM staff WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ staff }, 201);
});

const updateStaff = createRoute({
  method: "put",
  path: "/api/staff/{id}",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      title: z.string().optional(),
      title_en: z.string().optional(),
      color: z.string().optional(),
      active: z.number().int().optional(),
    }) } } },
  },
  responses: { 200: { description: "Updated", content: { "application/json": { schema: OkSchema } } } },
});

app.openapi(updateStaff, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, val] of Object.entries(body)) {
    if (val !== undefined) { sets.push(`${key} = ?`); params.push(val); }
  }
  if (sets.length > 0) {
    await run(`UPDATE staff SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  }
  return c.json({ ok: true }, 200);
});

const deleteStaff = createRoute({
  method: "delete",
  path: "/api/staff/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
    409: { description: "The staff member has appointments or a linked account: deactivate instead", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteStaff, async (c) => {
  const { id } = c.req.valid("param");
  // Ses rendez-vous perdraient leur praticienne, son compte sa fiche : désactiver plutôt.
  if (await exists("SELECT COUNT(*) as count FROM appointments WHERE staff_id = ?", id)) {
    return c.json({ error: msg(c, "suppression.membre_historique") }, 409);
  }
  if (await exists("SELECT COUNT(*) as count FROM accounts WHERE staff_id = ?", id)) {
    return c.json({ error: msg(c, "suppression.membre_compte") }, 409);
  }
  if (await exists("SELECT (SELECT COUNT(*) FROM invoice_lines WHERE staff_id = ?1) + (SELECT COUNT(*) FROM tips WHERE staff_id = ?1) as count", id)) {
    return c.json({ error: msg(c, "suppression.membre_factures") }, 409);
  }
  const member = await get<{ name: string }>("SELECT name FROM staff WHERE id = ?", [id]);
  await run("DELETE FROM staff WHERE id = ?", [id]);
  if (member) await journal(c, { action: "membre.suppression", target: member.name });
  return c.json({ ok: true }, 200);
});

// ── Services ──────────────────────────────────────────────────────

const listServices = createRoute({
  method: "get",
  path: "/api/services",
  responses: {
    200: {
      description: "All services",
      content: { "application/json": { schema: z.object({ services: z.array(ServiceSchema) }) } },
    },
  },
});

app.openapi(listServices, async (c) => {
  const services = await query<Record<string, unknown>>(
    `SELECT s.*, (SELECT COUNT(*) FROM appointment_services WHERE service_id = s.id) as appointment_count
     FROM services s ORDER BY s.category ASC, s.name ASC`,
  );
  return c.json({ services }, 200);
});

const createService = createRoute({
  method: "post",
  path: "/api/services",
  request: {
    body: { content: { "application/json": { schema: z.object({
      name: NameInput,
      description: z.string().optional(),
      duration: MinutesInput.optional(),
      price: FrancsInput.optional(),
      color: z.string().optional(),
      category: z.string().optional(),
      name_en: z.string().optional().openapi({ description: "English name, optional; the French name is shown when empty." }),
      description_en: z.string().optional(),
      category_en: z.string().optional(),
    }) } } },
  },
  responses: { 201: { description: "Created", content: { "application/json": { schema: z.object({ service: ServiceSchema }) } } } },
});

app.openapi(createService, async (c) => {
  const body = c.req.valid("json");
  const result = await run(
    "INSERT INTO services (name, description, duration, price, color, category, name_en, description_en, category_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [body.name, body.description || "", body.duration || 60, body.price || 0, body.color || "#6b7280", body.category || "",
      body.name_en || "", body.description_en || "", body.category_en || ""],
  );
  const service = await get<Record<string, unknown>>("SELECT * FROM services WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ service }, 201);
});

const updateService = createRoute({
  method: "put",
  path: "/api/services/{id}",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      name: NameInput.optional(),
      description: z.string().optional(),
      duration: MinutesInput.optional(),
      price: FrancsInput.optional(),
      color: z.string().optional(),
      category: z.string().optional(),
      active: z.number().int().optional(),
      name_en: z.string().optional(),
      description_en: z.string().optional(),
      category_en: z.string().optional(),
    }) } } },
  },
  responses: { 200: { description: "Updated", content: { "application/json": { schema: OkSchema } } } },
});

app.openapi(updateService, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, val] of Object.entries(body)) {
    if (val !== undefined) { sets.push(`${key} = ?`); params.push(val); }
  }
  const before = await get<{ name: string; price: number }>("SELECT name, price FROM services WHERE id = ?", [id]);
  if (sets.length > 0) {
    await run(`UPDATE services SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  }
  // Changement de prix seulement (décision 2) : les autres modifications ne vont pas au journal.
  if (before && body.price !== undefined && body.price !== before.price) {
    await journal(c, { action: "prestation.prix", target: changeTarget(body.name ?? before.name, before.price, body.price, "francs") });
  }
  return c.json({ ok: true }, 200);
});

const deleteService = createRoute({
  method: "delete",
  path: "/api/services/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
    409: { description: "The service appears in appointments: deactivate instead", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteService, async (c) => {
  const { id } = c.req.valid("param");
  // Supprimer la prestation la retirerait des rendez-vous passés (ON DELETE CASCADE) : désactiver plutôt.
  if (await exists("SELECT COUNT(*) as count FROM appointment_services WHERE service_id = ?", id)) {
    return c.json({ error: msg(c, "suppression.prestation_historique") }, 409);
  }
  const service = await get<{ name: string }>("SELECT name FROM services WHERE id = ?", [id]);
  await run("DELETE FROM services WHERE id = ?", [id]);
  if (service) await journal(c, { action: "prestation.suppression", target: service.name });
  return c.json({ ok: true }, 200);
});

// ── Blocked Slots ─────────────────────────────────────────────────

const createBlockedSlot = createRoute({
  method: "post",
  path: "/api/blocked-slots",
  request: {
    body: { content: { "application/json": { schema: z.object({
      staff_id: z.number().int(),
      blocked_date: z.string(),
      start_time: z.string(),
      end_time: z.string(),
      reason: z.string().optional(),
      allow_conflict: z.boolean().optional().openapi({
        description: "Block the time even though it overlaps an appointment or another blocked slot.",
      }),
    }) } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Invalid times", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Staff member not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Staff member already has an appointment or blocked time", content: { "application/json": { schema: ConflictSchema } } },
  },
});

app.openapi(createBlockedSlot, async (c) => {
  const { allow_conflict, ...body } = c.req.valid("json");
  const start = toMinutes(body.start_time);
  const end = toMinutes(body.end_time);
  if (start === null || end === null) return c.json({ error: msg(c, "rdv.heures_format") }, 400);
  if (end <= start) return c.json({ error: msg(c, "creneau.fin_apres_debut") }, 400);
  const startRefusal = validTime(body.start_time);
  if (startRefusal) return c.json({ error: msg(c, startRefusal) }, 400);
  if (end > DAY_CLOSE) return c.json({ error: msg(c, "creneau.fin_apres_fermeture", { fin: body.end_time, fermeture: CLOSE_TIME }) }, 400);
  const endRefusal = validTime(body.end_time);
  if (endRefusal) return c.json({ error: msg(c, endRefusal) }, 400);
  if (!(await exists("SELECT COUNT(*) as count FROM staff WHERE id = ?", body.staff_id))) return c.json({ error: msg(c, "equipe.introuvable") }, 404);

  // Contrôle du chevauchement et écriture dans la même transaction, comme le rendez-vous (V1-01) :
  // deux postes ne peuvent plus bloquer le même créneau entre le contrôle et l'écriture.
  const conflicts = c.env.STORAGE.transaction!((db): Busy[] => {
    if (!allow_conflict) {
      const found = findConflicts(body.start_time, body.end_time, busyOn(db, body.staff_id, body.blocked_date));
      if (found.length > 0) return found;
    }
    db.prepare("INSERT INTO blocked_slots (staff_id, blocked_date, start_time, end_time, reason) VALUES (?, ?, ?, ?, ?)")
      .run(body.staff_id, body.blocked_date, body.start_time, body.end_time, body.reason || "");
    return [];
  });
  if (conflicts.length > 0) {
    return c.json({ error: describeConflicts(await staffName(body.staff_id), conflicts, "block", requestLang(c)), conflicts }, 409);
  }
  return c.json({ ok: true }, 201);
});

const deleteBlockedSlot = createRoute({
  method: "delete",
  path: "/api/blocked-slots/{id}",
  request: { params: IdParam },
  responses: { 200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } } },
});

app.openapi(deleteBlockedSlot, async (c) => {
  const { id } = c.req.valid("param");
  const slot = await get<{ name: string | null; blocked_date: string; start_time: string; end_time: string }>(
    "SELECT s.name, b.blocked_date, b.start_time, b.end_time FROM blocked_slots b LEFT JOIN staff s ON s.id = b.staff_id WHERE b.id = ?", [id],
  );
  await run("DELETE FROM blocked_slots WHERE id = ?", [id]);
  if (slot) await journal(c, { action: "creneau.suppression", target: `${slot.name ?? ""}, ${slot.blocked_date} ${slot.start_time}-${slot.end_time}` });
  return c.json({ ok: true }, 200);
});

// ── Products ──────────────────────────────────────────────────────

const listProducts = createRoute({
  method: "get",
  path: "/api/products",
  request: {
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      search: z.string().optional(),
      category: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Paginated product list",
      content: { "application/json": { schema: z.object({ products: z.array(ProductSchema), total: z.number().int() }) } },
    },
  },
});

app.openapi(listProducts, async (c) => {
  const q = c.req.valid("query");
  const page = parseInt(q.page || "1", 10);
  const limit = parseInt(q.limit || "50", 10);
  const offset = (page - 1) * limit;

  let where = "WHERE 1=1";
  const params: unknown[] = [];
  if (q.search) {
    // Insensible aux accents et à la casse (« creme » trouve « Crème ») : fonction SQL `fold` (storage.ts).
    where += " AND (fold(p.name) LIKE ? OR fold(p.name_en) LIKE ? OR fold(p.brand) LIKE ? OR fold(p.sku) LIKE ?)";
    const s = foldPattern(q.search);
    params.push(s, s, s, s);
  }
  if (q.category) { where += " AND p.category = ?"; params.push(q.category); }

  const total = await get<{ count: number }>(`SELECT COUNT(*) as count FROM products p ${where}`, params);
  const products = await query<Record<string, unknown>>(
    `SELECT p.*, ${IMAGE_VERSION_SQL} FROM products p ${where} ORDER BY p.name ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const role = currentAccount(c).role;
  return c.json({ products: products.map((p) => redactProduct(role, p)), total: total?.count || 0 }, 200);
});

const getProduct = createRoute({
  method: "get",
  path: "/api/products/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Product detail", content: { "application/json": { schema: z.object({ product: ProductSchema }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

// Fiche d'un produit dans le panneau (lien direct, produit hors de la page chargée).
app.openapi(getProduct, async (c) => {
  const { id } = c.req.valid("param");
  const product = await get<z.infer<typeof ProductSchema>>(`SELECT p.*, ${IMAGE_VERSION_SQL} FROM products p WHERE p.id = ?`, [id]);
  if (!product) return c.json({ error: msg(c, "rdv.introuvable") }, 404);
  return c.json({ product: redactProduct(currentAccount(c).role, product) }, 200);
});

const createProduct = createRoute({
  method: "post",
  path: "/api/products",
  request: {
    body: { content: { "application/json": { schema: z.object({
      name: NameInput,
      brand: z.string().optional(),
      category: z.string().optional(),
      sku: z.string().optional(),
      price: FrancsInput.optional(),
      cost: FrancsInput.optional(),
      stock: CountInput.optional(),
      low_stock_alert: CountInput.optional(),
      name_en: z.string().optional().openapi({ description: "English name, optional; the French name is shown when empty." }),
      category_en: z.string().optional(),
    }) } } },
  },
  responses: { 201: { description: "Created", content: { "application/json": { schema: z.object({ product: ProductSchema }) } } } },
});

app.openapi(createProduct, async (c) => {
  const body = c.req.valid("json");
  const result = await run(
    "INSERT INTO products (name, brand, category, sku, price, cost, stock, low_stock_alert, name_en, category_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [body.name, body.brand || "", body.category || "", body.sku || "",
    body.price || 0, body.cost || 0, body.stock || 0, body.low_stock_alert ?? 5, body.name_en || "", body.category_en || ""],
  );
  const product = await get<Record<string, unknown>>(`SELECT p.*, ${IMAGE_VERSION_SQL} FROM products p WHERE p.id = ?`, [result.lastInsertRowid]);
  return c.json({ product }, 201);
});

const updateProduct = createRoute({
  method: "put",
  path: "/api/products/{id}",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      name: NameInput.optional(),
      brand: z.string().optional(),
      category: z.string().optional(),
      sku: z.string().optional(),
      price: FrancsInput.optional(),
      cost: FrancsInput.optional(),
      stock: CountInput.optional(),
      low_stock_alert: CountInput.optional(),
      name_en: z.string().optional(),
      category_en: z.string().optional(),
    }) } } },
  },
  responses: { 200: { description: "Updated", content: { "application/json": { schema: OkSchema } } } },
});

app.openapi(updateProduct, async (c) => {
  const { id } = c.req.valid("param");
  const body = restrictFields(currentAccount(c).role, "products", c.req.valid("json") as Record<string, unknown>);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, val] of Object.entries(body)) {
    if (val !== undefined) { sets.push(`${key} = ?`); params.push(val); }
  }
  const before = await get<{ name: string; price: number; stock: number }>("SELECT name, price, stock FROM products WHERE id = ?", [id]);
  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    await run(`UPDATE products SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  }
  // Prix et stock seulement (décision 2), comparés à la valeur d'avant ; `body` est déjà réduit aux champs permis.
  if (before) {
    const name = typeof body.name === "string" ? body.name : before.name;
    if (typeof body.price === "number" && body.price !== before.price) {
      await journal(c, { action: "produit.prix", target: changeTarget(name, before.price, body.price, "francs") });
    }
    if (typeof body.stock === "number" && body.stock !== before.stock) {
      await journal(c, { action: "produit.stock", target: changeTarget(name, before.stock, body.stock, "stock") });
    }
  }
  return c.json({ ok: true }, 200);
});

const deleteProduct = createRoute({
  method: "delete",
  path: "/api/products/{id}",
  request: { params: IdParam },
  responses: { 200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } } },
});

app.openapi(deleteProduct, async (c) => {
  const { id } = c.req.valid("param");
  const product = await get<{ name: string }>("SELECT name FROM products WHERE id = ?", [id]);
  await run("DELETE FROM products WHERE id = ?", [id]);
  if (product) await journal(c, { action: "produit.suppression", target: product.name });
  return c.json({ ok: true }, 200);
});

export default app;
