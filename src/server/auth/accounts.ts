import { get, query, run } from "@clawnify/db";
import { hashSecret, hashToken, passwordProblem, pinProblem, verifySecret } from "./crypto.ts";
import { afterFailure } from "./lockout.ts";
import { MessageError, type MessageKey, type Values } from "../messages.ts";
import { compteDemoFige } from "../formation/demo.ts";

export type Role = "admin" | "manager" | "reception" | "practitioner";
export const ROLES: Role[] = ["admin", "manager", "reception", "practitioner"];

export type Language = "fr" | "en";
export const LANGUAGES: Language[] = ["fr", "en"];

export type Theme = "light" | "dark" | "system";
export const THEMES: Theme[] = ["light", "dark", "system"];

export interface Account {
  id: number;
  display_name: string;
  login: string;
  role: Role;
  staff_id: number | null;
  active: number;
  has_pin: boolean;
  locked_until: number | null;
  language: Language;
  theme: Theme;
}

interface AccountRow {
  id: number; display_name: string; login: string; role: Role; staff_id: number | null; active: number;
  password_hash: string; pin_hash: string | null; failed_attempts: number; lock_series: number; locked_until: number | null;
  language: string;
  theme: string;
}

export interface NewAccount { display_name: string; login: string; role: Role; password: string; pin?: string | null; staff_id?: number | null; language?: Language }
export interface AccountPatch { display_name?: string; role?: Role; staff_id?: number | null; active?: number; password?: string; pin?: string | null; language?: Language; theme?: Theme }
export type AuthResult = { ok: true; account: Account } | { ok: false; reason: "invalid" | "locked" | "inactive"; locked_until?: number };

/** Refus d'une opération sur un compte : message du dictionnaire (codé) et statut HTTP. */
export class AccountError extends MessageError {
  status: number;

  constructor(key: MessageKey, status = 400, values: Values = {}) {
    super(key, values);
    this.name = "AccountError";
    this.status = status;
  }
}

const COLUMNS = "id, display_name, login, role, staff_id, active, password_hash, pin_hash, failed_attempts, lock_series, locked_until, language, theme";

function toAccount(row: AccountRow): Account {
  return {
    id: row.id, display_name: row.display_name, login: row.login, role: row.role, staff_id: row.staff_id,
    active: row.active, has_pin: row.pin_hash !== null, locked_until: row.locked_until,
    language: row.language === "en" ? "en" : "fr",
    theme: THEMES.includes(row.theme as Theme) ? (row.theme as Theme) : "system",
  };
}

function check(input: { display_name?: string; login?: string; role?: Role; password?: string; pin?: string | null; staff_id?: number | null; language?: string; theme?: string }) {
  if (input.display_name !== undefined && !input.display_name.trim()) throw new AccountError("compte.nom_obligatoire");
  if (input.login !== undefined && !/^[a-z0-9._-]{3,32}$/i.test(input.login)) throw new AccountError("compte.identifiant_invalide");
  if (input.role !== undefined && !ROLES.includes(input.role)) throw new AccountError("compte.role_inconnu");
  if (input.password !== undefined) { const p = passwordProblem(input.password); if (p) throw new AccountError(p); }
  if (input.pin != null) { const p = pinProblem(input.pin); if (p) throw new AccountError(p); }
  if (input.language !== undefined && !LANGUAGES.includes(input.language as Language)) throw new AccountError("compte.langue_inconnue");
  if (input.theme !== undefined && !THEMES.includes(input.theme as Theme)) throw new AccountError("compte.theme_inconnu");
}

/**
 * Vérifie le couple rôle et fiche résultant d'une création ou d'une
 * modification : une praticienne doit être reliée à sa fiche, et toute fiche
 * indiquée doit exister. Appelée avant toute écriture.
 */
async function checkStaff(role: Role, staffId: number | null | undefined): Promise<void> {
  if (staffId != null && (!Number.isSafeInteger(staffId) || !(await get("SELECT id FROM staff WHERE id = ?", [staffId])))) {
    throw new AccountError("compte.fiche_introuvable");
  }
  if (role === "practitioner" && !staffId) throw new AccountError("compte.praticienne_sans_fiche");
}

export async function countAccounts(): Promise<number> {
  return (await get<{ n: number }>("SELECT COUNT(*) AS n FROM accounts"))?.n ?? 0;
}

export async function getAccount(id: number): Promise<Account | null> {
  const row = await get<AccountRow>(`SELECT ${COLUMNS} FROM accounts WHERE id = ?`, [id]);
  return row ? toAccount(row) : null;
}

export async function listAccounts(): Promise<Account[]> {
  return (await query<AccountRow>(`SELECT ${COLUMNS} FROM accounts ORDER BY display_name COLLATE NOCASE`)).map(toAccount);
}

/**
 * Crée un compte. Avec `onlyIfEmpty` (installation), l'insertion est
 * conditionnelle et atomique : si un compte existe déjà, rien n'est créé et
 * l'appel lève 409, même quand deux installations arrivent en même temps.
 */
export async function createAccount(input: NewAccount, now: number, opts: { onlyIfEmpty?: boolean } = {}): Promise<Account> {
  check(input);
  await checkStaff(input.role, input.staff_id);
  if (await get("SELECT id FROM accounts WHERE login = ?", [input.login])) throw new AccountError("compte.identifiant_pris", 409);
  const passwordHash = await hashSecret(input.password);
  const pinHash = input.pin ? await hashSecret(input.pin) : null;
  const values = [input.display_name.trim(), input.login, input.role, passwordHash, pinHash, input.staff_id ?? null, now, input.language ?? "fr"];
  const result = opts.onlyIfEmpty
    ? await run(
      "INSERT INTO accounts (display_name, login, role, password_hash, pin_hash, staff_id, created_at, language) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM accounts)",
      values,
    )
    : await run("INSERT INTO accounts (display_name, login, role, password_hash, pin_hash, staff_id, created_at, language) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", values);
  if (Number(result.changes) === 0) throw new AccountError("installation.deja_faite", 409);
  return (await getAccount(Number(result.lastInsertRowid)))!;
}

export async function updateAccount(id: number, patch: AccountPatch): Promise<Account> {
  check(patch);
  // Validation complète avant toute écriture : une réponse d'erreur ne laisse
  // jamais une modification partielle en base.
  const current = await getAccount(id);
  if (!current) throw new AccountError("compte.introuvable", 404);
  // La règle rôle/fiche ne concerne que les modifications qui touchent au rôle
  // ou à la fiche : sinon, une fiche déjà supprimée (staff_id mis à NULL par
  // ON DELETE SET NULL) ne doit pas bloquer les autres modifications du compte.
  if (patch.role !== undefined || patch.staff_id !== undefined) {
    await checkStaff(patch.role ?? current.role, patch.staff_id !== undefined ? patch.staff_id : current.staff_id);
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.display_name !== undefined) { sets.push("display_name = ?"); params.push(patch.display_name.trim()); }
  if (patch.role !== undefined) { sets.push("role = ?"); params.push(patch.role); }
  if (patch.staff_id !== undefined) { sets.push("staff_id = ?"); params.push(patch.staff_id); }
  if (patch.active !== undefined) { sets.push("active = ?"); params.push(patch.active ? 1 : 0); }
  if (patch.password !== undefined) { sets.push("password_hash = ?"); params.push(await hashSecret(patch.password)); }
  if (patch.pin !== undefined) { sets.push("pin_hash = ?"); params.push(patch.pin ? await hashSecret(patch.pin) : null); }
  if (patch.language !== undefined) { sets.push("language = ?"); params.push(patch.language); }
  if (patch.theme !== undefined) { sets.push("theme = ?"); params.push(patch.theme); }
  if (sets.length) await run(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  const account = await getAccount(id);
  if (!account) throw new AccountError("compte.introuvable", 404);
  return account;
}

export async function unlockAccount(id: number): Promise<void> {
  await run("UPDATE accounts SET failed_attempts = 0, lock_series = 0, locked_until = NULL WHERE id = ?", [id]);
}

type Counter = { failed_attempts: number; lock_series: number; locked_until: number | null };

// Échecs sur des identifiants inconnus, tenus en mémoire avec la même règle de
// blocage que les comptes : un identifiant inconnu se bloque comme un connu, et
// rien ne permet de les distinguer. Clé : empreinte de l'identifiant (taille
// fixe) ; au-delà de MAX_UNKNOWN entrées, les plus anciennes sont oubliées.
const unknownFailures = new Map<string, Counter>();
const MAX_UNKNOWN = 10_000;

function isLocked(counter: Counter, now: number): boolean {
  return counter.locked_until !== null && counter.locked_until > now;
}

type Reservation = { next: Counter } | { locked_until: number };

/**
 * Réserve un essai avant toute vérification, de façon atomique : l'échec est
 * compté d'avance (et le blocage posé au cinquième), puis annulé si le secret
 * est juste. Des essais parallèles ne peuvent donc jamais être évalués au-delà
 * de la limite, même pendant le calcul scrypt asynchrone.
 */
async function reserve(row: AccountRow, now: number): Promise<Reservation> {
  for (let current: AccountRow | null | undefined = row; current; current = await get<AccountRow>(`SELECT ${COLUMNS} FROM accounts WHERE id = ?`, [row.id])) {
    if (isLocked(current, now)) return { locked_until: current.locked_until! };
    const next = afterFailure(current, now);
    // Comparer-et-échanger : ne réussit que si personne n'a compté un essai
    // entre la lecture et cette écriture ; sinon, on relit et on recommence.
    const result = await run(
      `UPDATE accounts SET failed_attempts = ?, lock_series = ?, locked_until = COALESCE(?, locked_until)
        WHERE id = ? AND failed_attempts = ? AND lock_series = ? AND (locked_until IS NULL OR locked_until <= ?)`,
      [next.failed_attempts, next.lock_series, next.locked_until, current.id, current.failed_attempts, current.lock_series, now],
    );
    if (Number(result.changes) > 0) return { next };
  }
  return { next: { failed_attempts: 0, lock_series: 0, locked_until: null } };
}

/** Même réservation pour un identifiant inconnu, en mémoire (synchrone, donc atomique). */
function reserveUnknown(key: string, now: number): Reservation {
  const counter = unknownFailures.get(key) ?? { failed_attempts: 0, lock_series: 0, locked_until: null };
  if (isLocked(counter, now)) return { locked_until: counter.locked_until! };
  const next = afterFailure(counter, now);
  unknownFailures.delete(key);
  unknownFailures.set(key, next);
  if (unknownFailures.size > MAX_UNKNOWN) unknownFailures.delete(unknownFailures.keys().next().value!);
  return { next };
}

/**
 * Un essai : réservation, puis un calcul scrypt (factice pour un identifiant
 * inconnu). Connu ou inconnu, la réponse et la durée sont les mêmes : un
 * scrypt tant que l'identifiant n'est pas bloqué, aucun une fois bloqué.
 */
async function attempt(row: AccountRow | null | undefined, unknownKey: string, secret: string, field: "password_hash" | "pin_hash", now: number): Promise<AuthResult> {
  // Démonstration publique (DP-06) : un compte public, au mot de passe affiché, n'est jamais bloqué (un visiteur ne peut pas en priver les autres).
  const reserved: Reservation = row && compteDemoFige(row.login)
    ? { next: { failed_attempts: 0, lock_series: 0, locked_until: null } }
    : row ? await reserve(row, now) : reserveUnknown(unknownKey, now);
  if ("locked_until" in reserved) return { ok: false, reason: "locked", locked_until: reserved.locked_until };
  const valid = await verifySecret(secret, row ? row[field] : null);
  if (!row || !valid) {
    return reserved.next.locked_until ? { ok: false, reason: "locked", locked_until: reserved.next.locked_until } : { ok: false, reason: "invalid" };
  }
  // Secret juste : la réservation est annulée (compteur remis à zéro).
  if (!row.active) {
    await run("UPDATE accounts SET failed_attempts = 0, lock_series = 0, locked_until = NULL WHERE id = ?", [row.id]);
    return { ok: false, reason: "inactive" };
  }
  await run("UPDATE accounts SET failed_attempts = 0, lock_series = 0, locked_until = NULL, last_login_at = ? WHERE id = ?", [now, row.id]);
  return { ok: true, account: toAccount({ ...row, locked_until: null }) };
}

export async function authenticatePassword(login: string, password: string, now: number): Promise<AuthResult> {
  return attempt(await get<AccountRow>(`SELECT ${COLUMNS} FROM accounts WHERE login = ?`, [login]), `login:${hashToken(login.toLowerCase())}`, password, "password_hash", now);
}

/**
 * Connexion par PIN sur un poste. L'administrateur ne se connecte jamais ainsi :
 * il est traité comme un numéro inconnu (même réponse, compteur en mémoire),
 * si bien que des PIN faux depuis un poste ne peuvent pas bloquer son compte.
 */
export async function authenticatePin(accountId: number, pin: string, now: number): Promise<AuthResult> {
  const row = Number.isSafeInteger(accountId) ? await get<AccountRow>(`SELECT ${COLUMNS} FROM accounts WHERE id = ?`, [accountId]) : null;
  return attempt(row && row.role !== "admin" ? row : null, `pin:${accountId}`, pin, "pin_hash", now);
}

/** Numéro d'un compte joignable par PIN (existant et non administrateur), sinon null : sert au journal. */
export async function pinAccountId(accountId: number): Promise<number | null> {
  if (!Number.isSafeInteger(accountId)) return null;
  return (await get<{ id: number }>("SELECT id FROM accounts WHERE id = ? AND role != 'admin'", [accountId]))?.id ?? null;
}
