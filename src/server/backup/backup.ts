import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import { Decrypter, Encrypter } from "age-encryption";
import { get as dbGet, run as dbRun } from "@clawnify/db";
import { logAudit } from "../audit.ts";
import { enqueue } from "../outbox/outbox.ts";
import { MessageError } from "../messages.ts";

const DOUALA = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Douala", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function stamp(now: number): string {
  const p = Object.fromEntries(DOUALA.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}`;
}

export function backupFileName(now: number): string {
  return `lama-${stamp(now)}.db.gz.age`;
}

export function isFirstOfMonth(now: number): boolean {
  return stamp(now).slice(6, 8) === "01";
}

export async function recordBackup(e: { destination: "usb" | "drive"; status: "ok" | "failed" | "pending"; file: string; message?: string; now: number }) {
  await dbRun("INSERT INTO backups (at, destination, status, file, message) VALUES (?, ?, ?, ?, ?)", [e.now, e.destination, e.status, e.file, e.message ?? ""]);
}

/**
 * Compresse puis chiffre pour la clé publique `age` le fichier `raw` et écrit
 * le résultat dans `dest` (0600). `raw`, copie non chiffrée, est effacé dans
 * tous les cas, même si la compression ou le chiffrement échoue.
 */
export async function sealFile(raw: string, dest: string, recipient: string): Promise<void> {
  let compressed: Buffer;
  try {
    compressed = gzipSync(readFileSync(raw));
  } finally {
    rmSync(raw, { force: true });
  }
  const encrypter = new Encrypter();
  encrypter.addRecipient(recipient);
  writeFileSync(dest, await encrypter.encrypt(compressed), { mode: 0o600 });
}

/** Copie cohérente (VACUUM INTO), compressée, chiffrée pour la clé publique `age`. */
export async function makeEncryptedSnapshot(o: { run: (sql: string, params: unknown[]) => Promise<unknown>; recipient: string; tmpDir: string; now: number }) {
  mkdirSync(o.tmpDir, { recursive: true });
  const raw = join(o.tmpDir, `copie-${o.now}.db`);
  rmSync(raw, { force: true });
  await o.run("VACUUM INTO ?", [raw]);
  const name = backupFileName(o.now);
  const file = join(o.tmpDir, name);
  await sealFile(raw, file, o.recipient);
  return { file, name };
}

/** Garde les `keep` fichiers les plus récents (ordre des noms) ; renvoie les supprimés. */
export function pruneDir(dir: string, keep: number): string[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".db.gz.age")).sort().reverse();
  const removed = files.slice(keep);
  for (const f of removed) unlinkSync(join(dir, f));
  return removed;
}

/**
 * Fichier témoin posé à la racine du disque de sauvegarde lors de sa
 * préparation. Le point de montage existe même disque débranché (`nofail`) :
 * seul le témoin prouve que le disque est bien monté.
 */
export const USB_MARKER = ".lama-sauvegarde";

export function writeToUsb(file: string, usbDir: string, now: number): void {
  if (!existsSync(join(usbDir, USB_MARKER))) throw new MessageError("sauvegarde.usb_absent", { dossier: usbDir });
  const name = file.split("/").pop()!;
  const daily = join(usbDir, "quotidiennes");
  mkdirSync(daily, { recursive: true });
  copyFileSync(file, join(daily, name));
  pruneDir(daily, 30);
  if (isFirstOfMonth(now)) {
    const monthly = join(usbDir, "mensuelles");
    mkdirSync(monthly, { recursive: true });
    copyFileSync(file, join(monthly, name));
    pruneDir(monthly, 12);
  }
}

export async function decryptBackup(data: Uint8Array, identity: string): Promise<Buffer> {
  // `addIdentity` peut lever de façon synchrone (clé mal formée : @scure/base
  // lève « Invalid checksum in <clé complète> ») ; `decrypt` et `gunzipSync`
  // peuvent lever eux aussi. Les trois sont sous le même essai, avec un
  // message fixe qui n'inclut jamais l'entrée : la clé privée ne doit jamais
  // se retrouver dans une réponse d'API ou une sortie de console.
  try {
    const decrypter = new Decrypter();
    decrypter.addIdentity(identity);
    const compressed = await decrypter.decrypt(data);
    return gunzipSync(compressed);
  } catch {
    throw new MessageError("sauvegarde.dechiffrement");
  }
}

/** Écrit la base à restaurer à côté de la base en service, après contrôle d'intégrité. */
export function prepareRestore(plain: Buffer, dataDir: string): string {
  mkdirSync(dataDir, { recursive: true });
  const candidate = join(dataDir, "lama.db.verification");
  writeFileSync(candidate, plain);
  try {
    const db = new DatabaseSync(candidate);
    const result = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string } | undefined;
    db.close();
    if (result?.integrity_check !== "ok") throw new MessageError("sauvegarde.controle_negatif");
  } catch (error) {
    rmSync(candidate, { force: true });
    throw new MessageError("sauvegarde.integrite", { detail: (error as Error).message });
  }
  const pending = join(dataDir, "lama.db.restauration");
  renameSync(candidate, pending);
  return pending;
}

/** Note de restauration (qui, quoi, d'où, quand), écrite à côté de la base à restaurer. */
export const RESTORE_NOTE = "lama.db.restauration.json";
export interface RestoreNote { accountId: number | null; login: string; name: string; ip: string; at: number }

/**
 * La restauration est journalisée au redémarrage, dans la base restaurée : une
 * entrée écrite dans la base en service partirait avec elle dans
 * `avant-restauration-*.db`. La note ne contient jamais la clé privée.
 */
export function writeRestoreNote(dataDir: string, note: RestoreNote): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, RESTORE_NOTE), JSON.stringify(note), { mode: 0o600 });
}

/** Lit et supprime la note de restauration ; null si absente ou illisible. */
export function takeRestoreNote(dataDir: string): RestoreNote | null {
  const file = join(dataDir, RESTORE_NOTE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as RestoreNote;
  } catch {
    return null;
  } finally {
    rmSync(file, { force: true });
  }
}

/**
 * Inscrit la restauration au journal de la base en service (la base restaurée).
 * Le compte n'est relié que s'il existe dans cette base avec le même
 * identifiant ; sinon le numéro reste vide et l'identifiant passe en cible.
 */
export async function recordRestore(note: RestoreNote): Promise<void> {
  const same = note.accountId !== null
    && (await dbGet<{ id: number }>("SELECT id FROM accounts WHERE id = ? AND login = ?", [note.accountId, note.login])) !== undefined;
  await logAudit({
    accountId: same ? note.accountId : null, action: "restauration",
    target: same ? note.name : `${note.name} (${note.login})`, ip: note.ip, now: note.at,
  });
}

/** Au démarrage : met la base actuelle de côté et installe la base restaurée, s'il y en a une. */
export function applyPendingRestore(dataDir: string, now: number): string | null {
  const pending = join(dataDir, "lama.db.restauration");
  if (!existsSync(pending)) return null;
  const current = join(dataDir, "lama.db");
  // Nom unique : deux restaurations dans la même minute ne doivent jamais
  // écraser la base mise de côté la première fois (ni ses -wal/-shm).
  const taken = (name: string) => ["", "-wal", "-shm", ".gz.age"].some((suffix) => existsSync(join(dataDir, name + suffix)));
  let aside = `avant-restauration-${stamp(now)}.db`;
  for (let n = 2; taken(aside); n++) aside = `avant-restauration-${stamp(now)}-${n}.db`;
  if (existsSync(current)) {
    renameSync(current, join(dataDir, aside));
    // La base est en WAL : des transactions validées peuvent encore vivre
    // uniquement dans `-wal`. On les conserve à côté de la base mise de côté
    // au lieu de les supprimer, pour ne jamais perdre de données non reportées.
    for (const suffix of ["-wal", "-shm"]) {
      const from = current + suffix;
      if (existsSync(from)) renameSync(from, join(dataDir, aside + suffix));
    }
  } else {
    for (const suffix of ["-wal", "-shm"]) rmSync(current + suffix, { force: true });
  }
  renameSync(pending, current);
  return aside;
}

export interface BackupDeps {
  run: (sql: string, params: unknown[]) => Promise<unknown>;
  recipient: string;
  usbDir: string;
  tmpDir: string;
  /** Destination Google Drive ; `null` tant que l'administrateur ne l'a pas réglée (décision 15 de la passe V 1.0). */
  remote: string | null;
  now: number;
}

/**
 * Sauvegarde complète : copie chiffrée, disque USB, puis envoi Drive par la
 * file, seulement si Google Drive est réglé (sinon ni envoi en file ni ligne
 * « Drive en attente », `drive: "none"`).
 */
export async function runBackup(d: BackupDeps): Promise<{ usb: "ok" | "failed"; drive: "pending" | "none" }> {
  const { file, name } = await makeEncryptedSnapshot(d);
  let usb: "ok" | "failed" = "ok";
  try {
    writeToUsb(file, d.usbDir, d.now);
    await recordBackup({ destination: "usb", status: "ok", file: name, now: d.now });
  } catch (error) {
    usb = "failed";
    await recordBackup({ destination: "usb", status: "failed", file: name, message: (error as Error).message, now: d.now });
  }
  if (d.remote === null) {
    // Le fichier chiffré n'est d'habitude supprimé que par l'envoi Drive (drive.ts) : sans Drive, tout de suite.
    rmSync(file, { force: true });
    return { usb, drive: "none" };
  }
  await enqueue({ kind: "sauvegarde.drive", payload: { file, name, remote: d.remote, monthly: isFirstOfMonth(d.now) }, dedupeKey: `sauvegarde-${name}`, now: d.now });
  await recordBackup({ destination: "drive", status: "pending", file: name, now: d.now });
  return { usb, drive: "pending" };
}
