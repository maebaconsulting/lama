// Clawnify n'applique de schema.sql que la structure des tables (DDL seul) :
// un INSERT y ferait échouer tout le déploiement. Les données de départ sont
// donc semées ici, au démarrage du serveur (relecture finale, constat M5).
import { get, run } from "./db.js";
import { preparePrintImage, saveLogo } from "./institut/logos.ts";
import { readResource } from "./caisse/ressources.ts";
import type { Database, StorageBinding } from "./storage.ts";
import { getSetting } from "./settings.ts";
import { estDemoPublique, estFormation } from "./formation/mode.ts";
import { numeroFictif } from "./formation/demo.ts";
import { fiscalSnapshot, readSaleSettings } from "./caisse/routes.ts";
import { issueSale, priceSale, type SaleRequest, type SaleSettings } from "./caisse/vente.ts";
import { issueCreditNote } from "./caisse/avoir.ts";
import { writeTags } from "./crm/etiquettes.ts";
import { dayBounds, doualaDay, REFERENCE_REQUIRED, type PaymentMethod } from "../shared/caisse.ts";
import { DEVISE_DEFAUT, prixDemo, type CodeDevise } from "../shared/devises.ts";
import { deviseActive } from "../shared/devise-active.ts";

type StaffSeed = [id: number, name: string, email: string, title: string, title_en: string, color: string];
type ServiceSeed = [
  id: number, name: string, name_en: string, description: string, description_en: string,
  duration: number, price: number, color: string, category: string, category_en: string,
];
type ClientSeed = [id: number, name: string, email: string, phone: string];
type ProductSeed = [id: number, name: string, name_en: string, brand: string, category: string, category_en: string, price: number, cost: number, stock: number];

/** Institut fictif des données de démonstration (distribution D-02) : aucun institut réel. */
const DEMO_INSTITUT = "Institut Démo";
/** Série des factures de démonstration (distribution D-02), reconnaissable sur tout ticket. */
const DEMO_PREFIX = "DEMO";

/** Démonstration semée : `LAMA_DEMO=1` (développement, essais) ou base de formation (distribution D-16), jamais la vraie base. */
function demonstration(): boolean {
  return process.env.LAMA_DEMO === "1" || estFormation();
}

// Institut de beauté fictif à Douala (spec du sous-projet 3, § 9). Versions
// anglaises remplies pour la plupart, pas toutes : l'écran anglais montre le
// repli sur le français. Couleurs : encres de la charte. Adresses fictives.
const STAFF: StaffSeed[] = [
  [1, "Solange Ekambi", "solange@exemple.cm", "Esthéticienne principale", "Head beautician", "#4A5D73"],
  [2, "Grace Nkeng", "grace@exemple.cm", "Masseuse", "Massage therapist", "#4F6552"],
  [3, "Mireille Fotso", "mireille@exemple.cm", "Prothésiste ongulaire", "", "#6B4660"],
  [4, "Brenda Tchoua", "brenda@exemple.cm", "Coiffeuse", "Hairdresser", "#2F5D62"],
];

const SERVICES: ServiceSeed[] = [
  [1, "Soin du visage éclat", "Radiance facial", "Nettoyage, gommage et masque hydratant", "Cleansing, scrub and moisturising mask", 60, 25000, "#4A5D73", "Soins du visage", "Facials"],
  [2, "Massage relaxant du dos", "Relaxing back massage", "Dos et nuque aux huiles chaudes", "Back and neck with warm oils", 30, 15000, "#4F6552", "Massages", "Massages"],
  [3, "Soin anti-taches", "", "Soin ciblé pour unifier le teint", "", 75, 35000, "#6B4660", "Soins du visage", "Facials"],
  [4, "Massage aux pierres chaudes", "Hot stone massage", "Pierres de basalte chauffées, détente profonde", "Heated basalt stones, deep relaxation", 90, 45000, "#2F5D62", "Massages", "Massages"],
  [5, "Manucure", "Manicure", "Soin des mains et pose de vernis", "Hand care and polish", 45, 8000, "#6D6480", "Onglerie", "Nails"],
  [6, "Pose de gel", "Gel nails", "Pose complète au gel", "Full set of gel nails", 90, 20000, "#8C5A6B", "Onglerie", "Nails"],
  [7, "Pédicure", "Pedicure", "Soin des pieds et pose de vernis", "Foot care and polish", 60, 12000, "#6D6480", "Onglerie", "Nails"],
  [8, "Épilation des jambes", "Leg waxing", "Jambes complètes à la cire tiède", "Full legs with warm wax", 45, 10000, "#35544A", "Épilation", "Waxing"],
  [9, "Épilation des sourcils", "", "Au fil ou à la cire", "", 15, 3000, "#35544A", "Épilation", "Waxing"],
  [10, "Maquillage de soirée", "Evening make-up", "Teint, yeux et lèvres pour une soirée", "Complexion, eyes and lips for an evening out", 60, 20000, "#8C5A6B", "Maquillage", "Make-up"],
  [11, "Maquillage de mariée", "Bridal make-up", "Essai compris", "Trial included", 120, 60000, "#6B4660", "Maquillage", "Make-up"],
  [12, "Tresses africaines", "African braids", "Mèches comprises", "Extensions included", 180, 25000, "#4B4B4B", "Coiffure", "Hair"],
  [13, "Brushing", "Blow-dry", "Shampoing et mise en forme", "Wash and styling", 45, 7000, "#4B4B4B", "Coiffure", "Hair"],
];

/** Prestations de démonstration dans la devise `code` (prix écrits en XAF, convertis et arrondis). */
export function servicesDemo(code: CodeDevise): ServiceSeed[] {
  return SERVICES.map((s) => { const c = [...s] as ServiceSeed; c[6] = prixDemo(s[6], code); return c; });
}

const CLIENTS: ClientSeed[] = [
  [1, "Aïcha Mbarga", "aicha.mbarga@exemple.cm", "+237 677 12 34 01"],
  [2, "Brenda Nkeng", "brenda.nkeng@exemple.cm", "+237 699 45 67 02"],
  [3, "Ngozi Tabi", "ngozi.tabi@exemple.cm", "+237 655 23 45 03"],
  [4, "Marie-Claire Essomba", "mc.essomba@exemple.cm", "+237 690 11 22 04"],
  [5, "Florence Ndongo", "", "+237 678 98 76 05"],
  [6, "Sandrine Kamga", "sandrine.kamga@exemple.cm", "+237 697 33 44 06"],
];

const PRODUCTS: ProductSeed[] = [
  [1, "Beurre de karité", "Shea butter", "Karité Douala", "Corps", "Body", 5000, 2500, 30],
  [2, "Huile de coco vierge", "Virgin coconut oil", "Kribi Naturel", "Corps", "Body", 4000, 2000, 25],
  [3, "Sérum éclat", "Radiance serum", "Maison Démo", "Visage", "Face", 15000, 7000, 12],
  [4, "Vernis semi-permanent", "", "Onglerie Pro", "Ongles", "Nails", 6000, 3000, 40],
  [5, "Cire tiède", "Warm wax", "Épil'Soin", "Épilation", "Waxing", 8000, 4000, 4],
  [6, "Mèches synthétiques", "Synthetic extensions", "Afro Style", "Cheveux", "Hair", 3500, 2000, 50],
];

/** Produits de démonstration dans la devise `code` : prix et coût convertis. */
export function produitsDemo(code: CodeDevise): ProductSeed[] {
  return PRODUCTS.map((p) => { const c = [...p] as ProductSeed; c[6] = prixDemo(p[6], code); c[7] = prixDemo(p[7], code); return c; });
}

/**
 * Historique de démonstration (mini CRM, décision 31). Chaque visite :
 * cliente, jours avant aujourd'hui, heure, praticienne, prestations, produits
 * achetés `[produit, quantité]`, pourboire. Une absence (`no_show`) n'est pas
 * facturée. Identifiants des fiches de démonstration ci-dessus.
 */
type VisitSeed = {
  client: number; daysAgo: number; time: string; staff: number; services: number[];
  products?: [number, number][]; tip?: number; status?: "completed" | "no_show";
};

const HISTORY: VisitSeed[] = [
  // Aïcha Mbarga : soin du visage avec Solange toutes les trois semaines, sérum et karité ; venue il y a 20 jours.
  { client: 1, daysAgo: 170, time: "10:00", staff: 1, services: [1] },
  { client: 1, daysAgo: 149, time: "10:00", staff: 1, services: [1, 9] },
  { client: 1, daysAgo: 128, time: "11:00", staff: 1, services: [1], products: [[3, 1]] },
  { client: 1, daysAgo: 106, time: "10:00", staff: 1, services: [1] },
  { client: 1, daysAgo: 85, time: "10:30", staff: 1, services: [3] },
  { client: 1, daysAgo: 63, time: "10:00", staff: 1, services: [1], products: [[1, 2]] },
  { client: 1, daysAgo: 41, time: "15:00", staff: 2, services: [2], tip: 2000 },
  { client: 1, daysAgo: 20, time: "10:00", staff: 1, services: [1, 9] },
  // Brenda Nkeng : brushing et tresses avec Brenda, mèches ; plus venue depuis 74 jours.
  { client: 2, daysAgo: 180, time: "09:00", staff: 4, services: [13] },
  { client: 2, daysAgo: 159, time: "09:00", staff: 4, services: [13] },
  { client: 2, daysAgo: 138, time: "09:00", staff: 4, services: [12], products: [[6, 3]] },
  { client: 2, daysAgo: 117, time: "09:30", staff: 4, services: [13] },
  { client: 2, daysAgo: 96, time: "09:00", staff: 4, services: [13] },
  { client: 2, daysAgo: 74, time: "09:00", staff: 4, services: [12, 13], products: [[6, 2]] },
  // Ngozi Tabi : essai puis maquillage de mariée, manucure le même jour.
  { client: 3, daysAgo: 60, time: "14:00", staff: 1, services: [10] },
  { client: 3, daysAgo: 46, time: "08:00", staff: 1, services: [11] },
  { client: 3, daysAgo: 46, time: "11:00", staff: 3, services: [5] },
  // Marie-Claire Essomba : massages avec Grace, huile de coco.
  { client: 4, daysAgo: 150, time: "16:00", staff: 2, services: [2] },
  { client: 4, daysAgo: 120, time: "16:00", staff: 2, services: [4] },
  { client: 4, daysAgo: 90, time: "16:00", staff: 2, services: [2] },
  { client: 4, daysAgo: 55, time: "16:00", staff: 2, services: [4], products: [[2, 1]] },
  { client: 4, daysAgo: 25, time: "16:00", staff: 2, services: [2] },
  // Sandrine Kamga : ongles avec Mireille ; une absence.
  { client: 6, daysAgo: 100, time: "13:00", staff: 3, services: [5, 7] },
  { client: 6, daysAgo: 70, time: "13:00", staff: 3, services: [6] },
  { client: 6, daysAgo: 55, time: "13:00", staff: 3, services: [5], status: "no_show" },
  { client: 6, daysAgo: 40, time: "13:00", staff: 3, services: [6] },
  { client: 6, daysAgo: 12, time: "13:00", staff: 3, services: [5, 7] },
];

/** Achat sans rendez-vous (Marie-Claire, deux pots de karité) et l'avoir qui en reprend un, remis en stock. */
const PURCHASE = { client: 4, daysAgo: 33, time: "12:00", products: [[1, 2]] as [number, number][] };
const CREDIT = { daysAgo: 30, time: "11:00", reason: "Pot abîmé rendu" };
/** Prochain rendez-vous d'Aïcha : dans dix jours, avec Solange. */
const NEXT = { client: 1, inDays: 10, time: "10:00", staff: 1, services: [1] };

/** Anniversaire (`today` : le jour même à Douala), préférences et étiquettes des fiches de démonstration. */
const PROFILES: [id: number, birthday: string, preferences: string, tags: string[]][] = [
  [1, "today", "Thé à la citronnelle, musique douce. Peau sensible\u00a0: pas d'huiles essentielles.", ["VIP", "Peau sensible"]],
  [2, "03-12", "Café noir sans sucre.", ["Fidèle"]],
  [3, "07-15", "Mariage en novembre, essai validé.", ["Mariée"]],
  [4, "11-22", "Pression forte pour le massage, pas de musique.", ["VIP"]],
  [6, "05-03", "Vernis nude de préférence.", ["Peau sensible"]],
];

/**
 * Logos de démonstration au signe de lama (`src/server/demo/`, copiés par la
 * construction dans `dist-server/ticket/`), déposés seulement s'il n'y en a
 * aucun ; une erreur (fichier absent) est ignorée.
 */
async function seedLogos(): Promise<void> {
  try {
    const existing = await get<{ count: number }>("SELECT COUNT(*) as count FROM institut_logos");
    if ((existing?.count ?? 0) > 0) return;
    const clair = readResource("logo-demo-clair.png");
    const sombre = readResource("logo-demo-sombre.png");
    const now = Date.now();
    await saveLogo("clair", "image/png", clair, preparePrintImage(clair, "image/png"), now);
    await saveLogo("sombre", "image/png", sombre, null, now);
  } catch {
    // La démonstration ne doit jamais échouer pour un logo.
  }
}

let seeded = false;

/** Insert `rows` into `table` only while it is still empty. */
async function seedIfEmpty(table: string, columns: string[], rows: readonly unknown[][]): Promise<void> {
  const existing = await get<{ count: number }>(`SELECT COUNT(*) as count FROM ${table}`);
  if ((existing?.count ?? 0) > 0) return;
  const placeholders = rows.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
  await run(
    `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES ${placeholders}`,
    rows.flat(),
  );
}

/** Historique de démonstration fait, ou sans objet ; retenté tant qu'aucun compte de gérante ou de réception n'existe. */
let historyDone = false;

const DAY_MS = 86_400_000;

/** Jour `aaaa-mm-jj` décalé de `days` jours (négatif : dans le passé). */
function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Minutes depuis minuit d'une heure `hh:mm`, et l'inverse. */
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const timeOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Instant d'un jour et d'une heure de Douala. */
function atDouala(day: string, time: string): number {
  return dayBounds(day).start + minutesOf(time) * 60_000;
}

interface HistoryContext {
  now: number;
  accountId: number;
  settings: SaleSettings;
  fiscal: Record<string, unknown>;
  lang: "fr" | "en";
}

/**
 * Écrit l'historique dans la transaction ouverte par `seedDemoHistory` :
 * rendez-vous, puis ventes et avoir dans l'ordre des dates (numéros de
 * facture dans l'ordre chronologique), profils et étiquettes.
 */
function writeDemoHistory(db: Database, ctx: HistoryContext): void {
  const today = doualaDay(ctx.now);
  const method: PaymentMethod = ctx.settings.methods.includes("cash") ? "cash" : ctx.settings.methods[0];
  const reference = REFERENCE_REQUIRED.includes(method) ? "DEMO" : "";
  const meta = (key: string) => (db.prepare("SELECT value FROM _meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  const prefix = meta("appointment_prefix") ?? "APT";
  let counter = Number(meta("appointment_counter") ?? 0);
  const service = db.prepare("SELECT duration, price FROM services WHERE id = ?");

  const addAppointment = (clientId: number, day: string, time: string, staffId: number, services: number[], status: string, bookedAt: number | null): number => {
    counter += 1;
    const rows = services.map((id) => service.get(id) as { duration: number; price: number });
    const end = timeOf(minutesOf(time) + rows.reduce((sum, r) => sum + r.duration, 0));
    const total = rows.reduce((sum, r) => sum + r.price, 0);
    const id = Number(db.prepare(
      `INSERT INTO appointments (identifier, client_id, staff_id, status, scheduled_date, start_time, end_time, total_price, booked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(`${prefix}-${counter}`, clientId, staffId, status, day, time, end, total, bookedAt).lastInsertRowid);
    services.forEach((svc, i) => {
      db.prepare("INSERT INTO appointment_services (appointment_id, service_id, price, duration) VALUES (?, ?, ?, ?)").run(id, svc, rows[i].price, rows[i].duration);
    });
    return id;
  };

  let requests = 0;
  /** Vente par le vrai chemin d'encaissement : prix du catalogue, versement exact, facture numérotée à la date `at`. */
  const sell = (req: Pick<SaleRequest, "client_id" | "appointment_id" | "lines" | "tip">, at: number): number => {
    requests += 1;
    const draft: SaleRequest = { ...req, request_id: `demo-historique-${String(requests).padStart(4, "0")}`, discount: null, payments: [] };
    const due = priceSale(db, draft, ctx.settings).totals.due;
    return issueSale(db, { ...draft, payments: [{ method, amount: due, reference, cash_given: null }] }, {
      now: at, lang: ctx.lang, accountId: ctx.accountId, fiscal: ctx.fiscal, settings: ctx.settings, approved: false, requestLang: ctx.lang,
    }).id;
  };

  // Événements datés, joués dans l'ordre : la suite des numéros suit les dates.
  const events: { at: number; run: () => void }[] = [];
  for (const visit of HISTORY) {
    const day = shiftDay(today, -visit.daysAgo);
    const status = visit.status ?? "completed";
    const aptId = addAppointment(visit.client, day, visit.time, visit.staff, visit.services, status, null);
    if (status !== "completed") continue;
    events.push({
      at: atDouala(day, visit.time) + 60 * 60_000,
      run: () => {
        sell({
          client_id: visit.client,
          appointment_id: aptId,
          lines: [
            ...visit.services.map((ref_id) => ({ kind: "service" as const, ref_id, quantity: 1, staff_id: visit.staff, parent: null })),
            ...(visit.products ?? []).map(([ref_id, quantity]) => ({ kind: "product" as const, ref_id, quantity, staff_id: null, parent: null })),
          ],
          tip: visit.tip && ctx.settings.tips ? { amount: prixDemo(visit.tip, deviseActive().code), staff_id: visit.staff } : null,
        }, atDouala(day, visit.time) + 60 * 60_000);
      },
    });
  }
  let purchaseId = 0;
  const purchaseDay = shiftDay(today, -PURCHASE.daysAgo);
  events.push({
    at: atDouala(purchaseDay, PURCHASE.time),
    run: () => {
      purchaseId = sell({
        client_id: PURCHASE.client, appointment_id: null, tip: null,
        lines: PURCHASE.products.map(([ref_id, quantity]) => ({ kind: "product" as const, ref_id, quantity, staff_id: null, parent: null })),
      }, atDouala(purchaseDay, PURCHASE.time));
    },
  });
  const creditAt = atDouala(shiftDay(today, -CREDIT.daysAgo), CREDIT.time);
  events.push({
    at: creditAt,
    run: () => {
      const line = db.prepare("SELECT id, unit_price FROM invoice_lines WHERE invoice_id = ? ORDER BY id LIMIT 1").get(purchaseId) as { id: number; unit_price: number };
      issueCreditNote(db, {
        request_id: "demo-historique-avoir-0001", invoice_id: purchaseId, reason: CREDIT.reason,
        lines: [{ line_id: line.id, quantity: 1, restock: true }],
        refunds: [{ method, amount: line.unit_price, reference }],
      }, { now: creditAt, accountId: ctx.accountId, identity: ctx.fiscal, requestLang: ctx.lang });
    },
  });
  events.sort((a, b) => a.at - b.at).forEach((e) => e.run());

  addAppointment(NEXT.client, shiftDay(today, NEXT.inDays), NEXT.time, NEXT.staff, NEXT.services, "booked", ctx.now);
  db.prepare("INSERT INTO _meta (key, value) VALUES ('appointment_counter', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(counter));

  for (const [id, birthday, preferences, tags] of PROFILES) {
    db.prepare("UPDATE clients SET birthday = ?, preferences = ? WHERE id = ?").run(birthday === "today" ? today.slice(5) : birthday, preferences, id);
    writeTags(db, id, tags);
  }
}

/**
 * Historique de démonstration (mini CRM, décision 31) : environ six mois de
 * visites facturées par le vrai chemin d'encaissement, des achats, un avoir,
 * une absence, un prochain rendez-vous, des anniversaires (dont un
 * aujourd'hui), des préférences et des étiquettes. Seulement si aucune
 * facture ni aucun rendez-vous n'existe et que les fiches de démonstration
 * sont toutes là. Aucun compte n'est créé : les factures portent la première
 * gérante (à défaut, la première réception) ; sans elle, rend `false` pour
 * réessayer à la requête suivante.
 */
export async function seedDemoHistory(storage: StorageBinding, now: number): Promise<boolean> {
  const account = await get<{ id: number }>(
    "SELECT id FROM accounts WHERE role IN ('manager', 'reception') ORDER BY CASE role WHEN 'manager' THEN 0 ELSE 1 END, id LIMIT 1",
  );
  if (!account) return false;
  const settings = await readSaleSettings();
  const fiscal = await fiscalSnapshot(settings);
  const lang = await getSetting<"fr" | "en">("institut.langue");
  return storage.transaction!((db) => {
    const n = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
    if (n("SELECT COUNT(*) AS n FROM invoices") > 0 || n("SELECT COUNT(*) AS n FROM appointments") > 0) return true;
    const complete = n("SELECT COUNT(*) AS n FROM clients WHERE id BETWEEN 1 AND 6") === 6
      && n("SELECT COUNT(*) AS n FROM staff WHERE id BETWEEN 1 AND 4") === 4
      && n("SELECT COUNT(*) AS n FROM services WHERE id BETWEEN 1 AND 13") === 13
      && n("SELECT COUNT(*) AS n FROM products WHERE id BETWEEN 1 AND 6") === 6;
    if (!complete) return true;
    writeDemoHistory(db, { now, accountId: account.id, settings, fiscal, lang });
    return true;
  });
}

/**
 * Fiches de démonstration et compteurs. Idempotent. The demo tables are only
 * seeded while still empty, so a redeploy never resurrects a row the user
 * deleted; the _meta rows are INSERT OR IGNORE so an existing counter is never reset.
 */
async function seedBase(): Promise<void> {
  if (!demonstration()) {
    // En service réel, l'institut part d'une base vide : pas de données fictives.
    try {
      await run("INSERT OR IGNORE INTO _meta (key, value) VALUES ('appointment_counter', '0')");
      await run("INSERT OR IGNORE INTO _meta (key, value) VALUES ('appointment_prefix', 'APT')");
      seeded = true;
    } catch {
      seeded = false;
    }
    return;
  }
  try {
    await run("INSERT OR IGNORE INTO _meta (key, value) VALUES ('appointment_counter', '0')");
    await run("INSERT OR IGNORE INTO _meta (key, value) VALUES ('appointment_prefix', 'APT')");
    await seedIfEmpty("staff", ["id", "name", "email", "title", "title_en", "color"], STAFF);
    await seedIfEmpty("services", ["id", "name", "name_en", "description", "description_en", "duration", "price", "color", "category", "category_en"], servicesDemo(deviseActive().code));
    // Démonstration publique (DP-06) : numéros visiblement fictifs (+237 600 00 00 01…), jamais un numéro qui pourrait exister.
    await seedIfEmpty("clients", ["id", "name", "email", "phone"], estDemoPublique() ? CLIENTS.map(([id, name, email]) => [id, name, email, numeroFictif(id)] as ClientSeed) : CLIENTS);
    await seedIfEmpty("products", ["id", "name", "name_en", "brand", "category", "category_en", "price", "cost", "stock"], produitsDemo(deviseActive().code));
    // Nom de l'institut de démonstration (renommage lama : vide par défaut) ; jamais par-dessus le nom saisi.
    await run("INSERT OR IGNORE INTO settings (key, value, secret, updated_at) VALUES ('institut.nom', ?, 0, ?)", [JSON.stringify(DEMO_INSTITUT), Date.now()]);
    // Série DEMO (D-02), avant toute facture de l'historique ; jamais par-dessus un préfixe écrit, jamais après une
    // facture (le préfixe serait figé : la condition évite même de tenter l'écriture, que la base refuserait).
    await run(
      `INSERT INTO settings (key, value, secret, updated_at) SELECT 'caisse.prefixe', ?, 0, ?
        WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'caisse.prefixe') AND NOT EXISTS (SELECT 1 FROM invoices)`,
      [JSON.stringify(DEMO_PREFIX), Date.now()],
    );
    await seedLogos();
    seeded = true;
  } catch {
    // Sample data must never fail a request; retry on the next one.
    seeded = false;
  }
}

/**
 * À chaque requête, avant les routes : fiches de démonstration (une fois),
 * puis historique de démonstration (`LAMA_DEMO=1`, sauf `LAMA_DEMO_HISTORY=0`
 * posé par les essais), retenté tant qu'aucun compte ne peut porter les factures.
 */
/**
 * Démonstration installée dans une autre devise que le FCFA (spec § 4) : les
 * fiches de démonstration, semées en XAF dès la première requête, reprennent
 * par identifiant leurs prix (et coûts) convertis, tant qu'aucune facture
 * n'existe et seulement s'ils n'ont pas été retouchés. Hors démonstration ou
 * en XAF, rien.
 */
export async function convertirFichesDemo(code: CodeDevise): Promise<void> {
  if (!demonstration() || code === DEVISE_DEFAUT) return;
  if (await get("SELECT 1 AS n FROM invoices LIMIT 1")) return;
  const services = servicesDemo(code);
  for (const [i, s] of SERVICES.entries()) {
    await run("UPDATE services SET price = ? WHERE id = ? AND price = ?", [services[i][6], s[0], s[6]]);
  }
  const produits = produitsDemo(code);
  for (const [i, p] of PRODUCTS.entries()) {
    await run("UPDATE products SET price = ?, cost = ? WHERE id = ? AND price = ? AND cost = ?", [produits[i][6], produits[i][7], p[0], p[6], p[7]]);
  }
}

export async function ensureSeeded(storage?: StorageBinding, now: number = Date.now()): Promise<void> {
  if (seeded && historyDone) return;
  if (!seeded) await seedBase();
  if (!seeded || historyDone) return;
  if (!demonstration() || process.env.LAMA_DEMO_HISTORY === "0" || !storage?.transaction) {
    historyDone = true;
    return;
  }
  try {
    historyDone = await seedDemoHistory(storage, now);
  } catch (error) {
    // La démonstration ne fait jamais échouer une requête ; une erreur n'est pas retentée à chaque requête.
    historyDone = true;
    console.error("Historique de démonstration\u00a0:", error instanceof Error ? error.message : error);
  }
}
