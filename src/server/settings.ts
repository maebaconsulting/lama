import type { OpenAPIHono } from "@hono/zod-openapi";
import { get, run } from "@clawnify/db";
import type { Role } from "./auth/accounts.ts";
import { openSecret, sealSecret } from "./auth/crypto.ts";
import { clientIp, currentAccount, requireConfirmation } from "./auth/middleware.ts";
import { logAudit } from "./audit.ts";
import { nowOf } from "./clock.ts";
import { coded, localize, montant, msg, type MessageKey } from "./messages.ts";
import { adresseRelaisValide, MOTIF_SALON, problemeTheme, TEXTE_DONNEES } from "../shared/en-ligne.ts";
import { DEFAULT_TEXTS, templateProblem, textSetting, TEMPLATE_KINDS } from "./whatsapp/textes.ts";
import { parseAddress } from "./impression/imprimante.ts";
import { parseLocalAddress } from "./reseau-local.ts";
import { DEFAULT_TIERS, loyaltyLimits, tiersProblem } from "../shared/fidelite.ts";
import { DEFAULT_INVOICE_PREFIX, isInvoicePrefix, normalizeInvoicePrefix } from "../shared/caisse.ts";
import { prefixFrozenBy } from "./caisse/prefixe.ts";
import { chargerDevise, deviseFigeePar } from "./devise.ts";
import { DEVISE_DEFAUT, estCodeDevise } from "../shared/devises.ts";
import type { Database, StorageBinding } from "./storage.ts";
import { SEMAINE_DEFAUT, semaineProblem } from "../shared/horaires.ts";

/**
 * Définition d'un réglage. `roles` : qui le lit et l'écrit ; `read` : qui le
 * lit seulement. `normalize` met la saisie en forme avant `validate`.
 * `frozen` : ce qui fige le réglage (distribution D-01, la première facture
 * pour le préfixe), lu et écrit dans une seule transaction.
 */
type Def = {
  roles: Role[];
  read?: Role[];
  secret: boolean;
  default: unknown;
  validate?: (v: unknown) => string | null;
  normalize?: (v: unknown) => unknown;
  frozen?: (db: Database) => { numero: string } | null;
  /** Réglage écrit seulement par sa route dédiée (devise : `PUT /api/devise`, qui convertit le catalogue). */
  dedicated?: true;
};

const text = (max: number) => (v: unknown) => (typeof v === "string" && v.length <= max ? null : coded("reglage.texte_long", { max }));
const yesNo = (v: unknown) => (typeof v === "boolean" ? null : coded("reglage.oui_non"));
const PAYMENT_METHODS = ["cash", "card", "orange_money", "momo"];
const days = (min: number, max: number) => (v: unknown) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : coded("reglage.jours", { min, max }));
const minutes = (min: number, max: number) => (v: unknown) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : coded("reglage.minutes", { min, max }));
const hhmm = (v: unknown) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? null : coded("reglage.heure"));

/** Nombre entier borné, refus par la clé donnée (règle de la fidélité). */
const whole = (limits: () => { min: number; max: number }, key: "reglage.fidelite_tranche" | "reglage.fidelite_points") => (v: unknown) => {
  const { min, max } = limits();
  return Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : coded(key, key === "reglage.fidelite_tranche" ? { min: montant(min), max: montant(max) } : {});
};

/** Textes des messages WhatsApp (sous-projet 7 § 3) : à la gérante seulement, jamais à l'administrateur. */
const WHATSAPP_TEXTS: Record<string, Def> = Object.fromEntries(TEMPLATE_KINDS.flatMap((kind) => (["fr", "en"] as const).map((lang) => [
  textSetting(kind, lang), { roles: ["manager"], secret: false, default: DEFAULT_TEXTS[kind][lang], validate: (v: unknown) => templateProblem(v, kind) } satisfies Def,
])));

/**
 * `remote:dossier` attendu par rclone. Le premier caractère du nom de remote
 * ne peut pas être un tiret (rclone le confondrait avec une option).
 */
export const DRIVE_REMOTE_PATTERN = /^[A-Za-z0-9_][\w-]*:.+$/;
/** Réutilisé au-delà de l'écriture du réglage : `drive.ts` (envoi) et `backup/routes.ts` (téléchargement) revalident la valeur lue avant de s'en servir. */
export function validateDriveRemote(v: unknown): string | null {
  return typeof v === "string" && DRIVE_REMOTE_PATTERN.test(v) ? null : coded("reglage.drive_format");
}

/** Texte d'accord sur les données (réservation en ligne) : 1 à 2 000 caractères. */
const texteDonnees = (v: unknown) => (typeof v === "string" && v.trim() !== "" && v.length <= 2000 ? null : coded("reglage.en_ligne_texte"));

/** Thème de la page du salon : trois champs gardés, couleurs en majuscules ; `null` revient à la charte de lama. */
function normaliserTheme(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const t = v as Record<string, unknown>;
  const haut = (x: unknown) => (typeof x === "string" ? x.toUpperCase() : x);
  return { fond: haut(t.fond), accent: haut(t.accent), police: t.police };
}

function themeRefuse(v: unknown): string | null {
  if (v === null) return null;
  if (!v || typeof v !== "object" || Array.isArray(v)) return coded("reglage.en_ligne_theme_couleur");
  const probleme = problemeTheme(v as Record<string, unknown>);
  return probleme ? coded(`reglage.en_ligne_theme_${probleme}` as MessageKey) : null;
}

export const SETTING_DEFS: Record<string, Def> = {
  "institut.nom": { roles: ["manager"], secret: false, default: "", validate: text(80) },
  "institut.adresse": { roles: ["manager"], secret: false, default: "", validate: text(200) },
  "institut.telephone": { roles: ["manager"], secret: false, default: "", validate: text(30) },
  "institut.langue": { roles: ["manager"], secret: false, default: "fr", validate: (v) => (v === "fr" || v === "en" ? null : coded("reglage.langue")) },
  // Horaires d'ouverture (réservation en ligne, spec du 16/10/2026 § 4.1) : écrits par la gérante, lus par tous pour griser l'agenda.
  "institut.horaires": { roles: ["manager"], read: ["admin", "reception", "practitioner"], secret: false, default: SEMAINE_DEFAUT, validate: (v) => (semaineProblem(v) ? coded("reglage.horaires") : null) },
  // Devise (spec du 15/10/2026) : choisie à l'installation, changée par `PUT /api/devise` tant que rien ne la fige.
  "institut.devise": { roles: ["admin", "manager"], secret: false, default: DEVISE_DEFAUT, validate: (v) => (estCodeDevise(v) ? null : coded("reglage.devise")), frozen: deviseFigeePar, dedicated: true },
  "affichage.symbole_position": { roles: ["admin", "manager"], secret: false, default: null, validate: (v) => (v === null || v === "avant" || v === "apres" ? null : coded("reglage.symbole_position")) },
  "affichage.symbole_ecran": { roles: ["admin", "manager"], secret: false, default: true, validate: yesNo },
  // Marque à l'écran (renommage lama) : « logo et nom » ou « logo seul » ; lue sans session par l'écran de connexion.
  // Marque en tête des documents (vague B) : « logo et nom » ou « logo seul » ; sans logo déposé, le nom reste en tête.
  "marque.documents": { roles: ["manager"], secret: false, default: "logo_nom", validate: (v) => (v === "logo_nom" || v === "logo" ? null : coded("reglage.marque")) },
  "marque.ecran": { roles: ["manager"], secret: false, default: "logo_nom", validate: (v) => (v === "logo_nom" || v === "logo" ? null : coded("reglage.marque")) },
  "postes.verrouillage_minutes": {
    roles: ["admin", "manager"], secret: false, default: 5,
    validate: (v) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 30 ? null : coded("reglage.duree")),
  },
  "technique.drive_remote": { roles: ["admin"], secret: false, default: "gdrive:lama", validate: validateDriveRemote },
  "technique.test_internet_url": { roles: ["admin"], secret: false, default: "https://www.google.com/generate_204", validate: (v) => (typeof v === "string" && /^https:\/\//.test(v) ? null : coded("reglage.https")) },
  "whatsapp.jeton_acces": { roles: ["admin"], secret: true, default: null, validate: text(512) },
  // WhatsApp (sous-projet 7 § 4) : fournisseur et passerelle WAHA à l'administrateur ; `whatsapp.jeton_acces` reste à l'API Meta (vague 3).
  "whatsapp.fournisseur": { roles: ["admin"], secret: false, default: "aucun", validate: (v) => (v === "aucun" || v === "waha" ? null : coded("reglage.fournisseur")) },
  "waha.adresse": { roles: ["admin"], secret: false, default: "http://127.0.0.1:3000", validate: (v) => (typeof v === "string" && v.length <= 200 && /^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(v) ? null : coded("reglage.adresse_http")) },
  "waha.cle": { roles: ["admin"], secret: true, default: null, validate: text(200) },
  "waha.session": { roles: ["admin"], secret: false, default: "default", validate: (v) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? null : coded("reglage.session")) },
  "whatsapp.indicatif": { roles: ["admin", "manager"], secret: false, default: "237", validate: (v) => (typeof v === "string" && /^[1-9]\d{0,3}$/.test(v) ? null : coded("reglage.indicatif")) },
  "whatsapp.rappel_heures": {
    roles: ["manager"], secret: false, default: 24,
    validate: (v) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 72 ? null : coded("reglage.rappel_heures")),
  },
  "whatsapp.silence_debut": { roles: ["manager"], secret: false, default: "21:00", validate: hhmm },
  "whatsapp.silence_fin": { roles: ["manager"], secret: false, default: "08:00", validate: hhmm },
  // Passerelle SMS (spec du 04/10/2026, § 1) : téléphone Android de l'institut, à l'administrateur ; délais de secours à la gérante.
  "sms.fournisseur": { roles: ["admin"], secret: false, default: "aucun", validate: (v) => (v === "aucun" || v === "passerelle" ? null : coded("reglage.sms_fournisseur")) },
  "sms.adresse": { roles: ["admin"], secret: false, default: "", validate: (v) => (typeof v === "string" && (v.trim() === "" || parseLocalAddress(v, 8080, process.env.LAMA_SMS_ESSAI === "1") !== null) ? null : coded("reglage.sms_adresse")) },
  "sms.identifiant": { roles: ["admin"], secret: false, default: "", validate: text(100) },
  "sms.mot_de_passe": { roles: ["admin"], secret: true, default: null, validate: text(200) },
  "sms.delai_rendez_vous_minutes": { roles: ["manager"], secret: false, default: 180, validate: minutes(15, 1440) },
  "sms.delai_libre_minutes": { roles: ["manager"], secret: false, default: 15, validate: minutes(1, 240) },
  // Interrupteur général du mini CRM (spec du 04/10/2026) : activé par défaut ; désactivé, ni fiche enrichie,
  // ni fidélité, ni relances, ni campagnes, sans rien effacer. Lu par `crmActive`.
  "crm.active": { roles: ["manager"], secret: false, default: true, validate: yesNo },
  // Relances (mini CRM, décisions 23 à 25) : désactivées par défaut, à la gérante ; lues par la tâche des relances
  // et, à l'envoi, par la règle « sans objet » (décision 26).
  "relances.anniversaire": { roles: ["manager"], secret: false, default: false, validate: yesNo },
  "relances.absence": { roles: ["manager"], secret: false, default: false, validate: yesNo },
  "relances.absence_jours": { roles: ["manager"], secret: false, default: 60, validate: days(15, 365) },
  "relances.heure": { roles: ["manager"], secret: false, default: "10:00", validate: hhmm },
  // Réservation en ligne (spec du 16/10/2026 § 4.6, § 9.4) : désactivée par défaut ; liaison (salon, clé) à l'administrateur.
  "en_ligne.active": { roles: ["manager"], read: ["admin"], secret: false, default: false, validate: yesNo },
  "en_ligne.horizon_jours": { roles: ["manager"], secret: false, default: 30, validate: days(7, 92) },
  "en_ligne.delai_minimal_heures": {
    roles: ["manager"], secret: false, default: 2,
    validate: (v) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 168 ? null : coded("reglage.en_ligne_delai", { min: 0, max: 168 })),
  },
  "en_ligne.texte_donnees.fr": { roles: ["manager"], secret: false, default: TEXTE_DONNEES.fr, validate: texteDonnees },
  "en_ligne.texte_donnees.en": { roles: ["manager"], secret: false, default: TEXTE_DONNEES.en, validate: texteDonnees },
  "en_ligne.adresse": { roles: ["manager"], read: ["admin"], secret: false, default: "", validate: (v) => (adresseRelaisValide(v) ? null : coded("reglage.en_ligne_adresse")) },
  "en_ligne.theme": { roles: ["manager"], secret: false, default: null, normalize: normaliserTheme, validate: themeRefuse },
  "en_ligne.salon": { roles: ["admin"], read: ["manager"], secret: false, default: "", validate: (v) => (typeof v === "string" && (v === "" || MOTIF_SALON.test(v)) ? null : coded("reglage.en_ligne_salon")) },
  "en_ligne.cle": { roles: ["admin"], secret: true, default: null, validate: (v) => (typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? null : coded("reglage.en_ligne_cle")) },
  ...WHATSAPP_TEXTS,
  // Caisse (sous-projet 5 § 5.2) : lus par la vente dès la vague 1, rubrique « Caisse » des Réglages en vague 2.
  "institut.niu": { roles: ["manager"], secret: false, default: "", validate: text(40) },
  "institut.rccm": { roles: ["manager"], secret: false, default: "", validate: text(40) },
  "caisse.tva_active": { roles: ["manager"], secret: false, default: true, validate: yesNo },
  "caisse.tva_taux": {
    roles: ["manager"], secret: false, default: 19.25,
    validate: (v) => (typeof v === "number" && v >= 0 && v <= 100 && Math.abs(Math.round(v * 100) - v * 100) < 1e-9 ? null : coded("reglage.taux")),
  },
  "caisse.remises": { roles: ["manager"], secret: false, default: true, validate: yesNo },
  "caisse.remise_plafond": {
    roles: ["manager"], secret: false, default: 10,
    validate: (v) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100 ? null : coded("reglage.pourcentage")),
  },
  "caisse.pourboires": { roles: ["manager"], secret: false, default: true, validate: yesNo },
  // Préfixe des factures (distribution D-01) : à l'administrateur tant qu'aucune facture n'existe ; la gérante le lit.
  "caisse.prefixe": {
    roles: ["admin"], read: ["manager"], secret: false, default: DEFAULT_INVOICE_PREFIX,
    normalize: (v) => (typeof v === "string" ? normalizeInvoicePrefix(v) : v),
    validate: (v) => (isInvoicePrefix(v) ? null : coded("reglage.prefixe")),
    frozen: prefixFrozenBy,
  },
  // Fonctions de la vague 3 (§ 6), réglables dès la vague 2 : désactivées par défaut.
  "caisse.acomptes": { roles: ["manager"], secret: false, default: false, validate: yesNo },
  "caisse.avoirs_reception": { roles: ["manager"], secret: false, default: false, validate: yesNo },
  // Encaissement par la praticienne (demande produit du 30/09/2026) : ses propres rendez-vous seulement.
  "caisse.encaissement_praticienne": { roles: ["manager"], secret: false, default: false, validate: yesNo },
  "caisse.moyens": {
    roles: ["manager"], secret: false, default: ["cash", "card", "orange_money", "momo"],
    validate: (v) => (Array.isArray(v) && v.length > 0 && new Set(v).size === v.length && v.every((m) => PAYMENT_METHODS.includes(m)) ? null : coded("reglage.moyens")),
  },
  // Impression directe (spec du 03/10/2026) : adresse de l'imprimante de tickets, vide = pas d'impression directe.
  // Logo de l'institut en tête du ticket papier (vague B), décoché par défaut.
  "caisse.imprimer_logo": { roles: ["manager"], secret: false, default: false, validate: yesNo },
  "caisse.imprimante": { roles: ["manager"], secret: false, default: "", validate: (v) => (typeof v === "string" && (v.trim() === "" || parseAddress(v) !== null) ? null : coded("reglage.imprimante")) },
  "caisse.mentions_fr": { roles: ["manager"], secret: false, default: "", validate: text(500) },
  "caisse.mentions_en": { roles: ["manager"], secret: false, default: "", validate: text(500) },
  // Fidélité (mini CRM § 2) : désactivée par défaut ; règle de gain et paliers de récompense, gérante seulement.
  "fidelite.active": { roles: ["manager"], secret: false, default: false, validate: yesNo },
  "fidelite.tranche": { roles: ["manager"], secret: false, default: 1000, validate: whole(() => loyaltyLimits().tranche, "reglage.fidelite_tranche") },
  "fidelite.points": { roles: ["manager"], secret: false, default: 1, validate: whole(() => loyaltyLimits().points, "reglage.fidelite_points") },
  "fidelite.paliers": {
    roles: ["manager"], secret: false, default: DEFAULT_TIERS.map((tier) => ({ ...tier })),
    validate: (v) => {
      const L = loyaltyLimits();
      const problem = tiersProblem(v);
      return problem ? coded(problem, problem === "reglage.paliers_montant" ? { min: montant(L.tierMontant.min), max: montant(L.tierMontant.max) } : {}) : null;
    },
  },
};

let masterKey: Uint8Array | null = null;
export function setMasterKey(key: Uint8Array | null): void { masterKey = key; }
/** Pour les routes : sait si la clé maîtresse est chargée, sans lever, avant d'appeler `getSetting`/`setSetting`. */
function hasMasterKey(): boolean { return masterKey !== null; }
function key(): Uint8Array {
  if (!masterKey) throw new Error("Clé maîtresse non chargée.");
  return masterKey;
}

export async function getSetting<T = unknown>(name: string): Promise<T> {
  const def = SETTING_DEFS[name];
  if (!def) throw new Error(`Réglage inconnu\u00a0: ${name}`);
  const row = await get<{ value: string; secret: number }>("SELECT value, secret FROM settings WHERE key = ?", [name]);
  if (!row) return def.default as T;
  return JSON.parse(row.secret ? openSecret(row.value, key()) : row.value) as T;
}

/** Interrupteur général du mini CRM (`crm.active`) : faux, lama se comporte comme avant le chantier. */
export async function crmActive(): Promise<boolean> {
  return (await getSetting<boolean>("crm.active")) !== false;
}

export async function setSetting(name: string, value: unknown, accountId: number | null, now: number): Promise<void> {
  const def = SETTING_DEFS[name];
  if (!def) throw new Error(`Réglage inconnu\u00a0: ${name}`);
  const encoded = JSON.stringify(value);
  const stored = def.secret ? sealSecret(encoded, key()) : encoded;
  await run(
    `INSERT INTO settings (key, value, secret, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, secret = excluded.secret, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [name, stored, def.secret ? 1 : 0, now, accountId],
  );
}

/** Écrit un réglage non secret dans la transaction ouverte par l'appelant (même requête que `setSetting`). */
export function writeSettingNow(db: Database, name: string, value: unknown, accountId: number, now: number): void {
  db.prepare(
    `INSERT INTO settings (key, value, secret, updated_at, updated_by) VALUES (?, ?, 0, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, secret = excluded.secret, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).run(name, JSON.stringify(value), now, accountId);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountSettingsRoutes(app: OpenAPIHono<any>): void {
  app.get("/api/settings", async (c) => {
    const role = currentAccount(c).role;
    const settings = [];
    for (const [name, def] of Object.entries(SETTING_DEFS)) {
      const writer = def.roles.includes(role);
      if (!writer && !def.read?.includes(role)) continue;
      if (def.secret) {
        const row = await get("SELECT key FROM settings WHERE key = ?", [name]);
        settings.push({ key: name, secret: true, value: null, set: Boolean(row) });
      } else if (def.frozen) {
        // Réglage figé par une donnée (D-01) : l'écran montre la raison et si la personne peut encore l'écrire.
        const frozen = (c.env.STORAGE as StorageBinding).transaction!((db) => def.frozen!(db));
        settings.push({ key: name, secret: false, value: await getSetting(name), set: true, editable: writer && frozen === null, frozen });
      } else {
        settings.push({ key: name, secret: false, value: await getSetting(name), set: true });
      }
    }
    return c.json({ settings });
  });

  app.put("/api/settings/:key", async (c) => {
    const account = currentAccount(c);
    const name = c.req.param("key");
    const def = SETTING_DEFS[name];
    if (!def) return c.json({ error: msg(c, "reglage.inconnu") }, 404);
    if (!def.roles.includes(account.role)) return c.json({ error: msg(c, "acces.refuse") }, 403);
    if (def.dedicated) return c.json({ error: msg(c, "devise.route") }, 409);
    if (def.secret || account.role === "admin") {
      const refused = requireConfirmation(c);
      if (refused) return refused;
    }
    const { value: raw } = (await c.req.json().catch(() => ({}))) as { value?: unknown };
    const value = def.normalize ? def.normalize(raw) : raw;
    const problem = def.validate?.(value) ?? null;
    if (problem) return c.json({ error: localize(c, problem) }, 400);
    if (def.secret && !hasMasterKey()) {
      return c.json({ error: msg(c, "reglage.cle_absente") }, 503);
    }
    if (def.frozen) {
      // Contrôle et écriture dans la même transaction que l'émission d'une facture : une vente
      // concurrente passe avant (refus 409) ou après (elle prend le nouveau préfixe), jamais entre les deux.
      const frozen = (c.env.STORAGE as StorageBinding).transaction!((db) => {
        const by = def.frozen!(db);
        if (!by) writeSettingNow(db, name, value, account.id, nowOf(c));
        return by;
      });
      if (frozen) return c.json({ error: msg(c, "reglage.prefixe_fige", frozen) }, 409);
    } else {
      await setSetting(name, value, account.id, nowOf(c));
    }
    if (name.startsWith("affichage.")) await chargerDevise();
    await logAudit({ accountId: account.id, action: "reglage", target: name, ip: clientIp(c), now: nowOf(c) });
    return c.json({ ok: true });
  });
}
