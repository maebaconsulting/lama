import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildSync } from "esbuild";
import { pathToFileURL } from "node:url";
import { runMigrations } from "./migrations.ts";
import { registerFunctions, sqliteStorage } from "./storage.ts";
import { hashSecret } from "./auth/crypto.ts";
import type { Role } from "./auth/accounts.ts";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

const bundles = new Map<string, Promise<string>>();
let scenario = 0;

/** Bannière du serveur assemblé (`build:server`) : pdfkit et ses modules CommonJS appellent `require`. */
const BANNER = "import { createRequire as lamaCreateRequire } from 'node:module'; const require = lamaCreateRequire(import.meta.url);";
let outDir: string | null = null;

/**
 * Assemble un point d'entrée serveur une fois par exécution de test, comme en
 * production (même bannière). Écrit dans un fichier temporaire, pas une
 * adresse `data:` : pdfkit lit `import.meta.url` pour `createRequire`.
 */
export function bundleOf(entry: string): Promise<string> {
  if (!bundles.has(entry)) {
    if (!outDir) {
      const dir = mkdtempSync(join(tmpdir(), "lama-tests-"));
      process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
      outDir = dir;
    }
    const file = join(outDir, `${bundles.size}.mjs`);
    bundles.set(entry, build({
      entryPoints: [new URL(entry, import.meta.url).pathname],
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      banner: { js: BANNER },
    }).then((r: { outputFiles: { text: string }[] }) => {
      writeFileSync(file, r.outputFiles[0].text);
      return pathToFileURL(file).href;
    }));
  }
  return bundles.get(entry)!;
}

export const appBundle = () => bundleOf("./index.ts");

let cli: string | null = null;

/**
 * Chemin de la ligne de commande assemblée une fois par exécution, comme en production
 * (`build:server`) : les imports en « .js » des sources ne se résolvent qu'à la construction.
 */
export function cliBundle(): string {
  if (!cli) {
    const dir = mkdtempSync(join(tmpdir(), "lama-cli-build-"));
    process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "cli.mjs");
    buildSync({ entryPoints: [new URL("./cli.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", target: "node24", outfile: file, logLevel: "silent", banner: { js: BANNER } });
    cli = file;
  }
  return cli;
}

/**
 * Exécute `travail` avec `LAMA_FORMATION` posée (`actif`) puis remet la variable comme avant,
 * absente si elle l'était, même en cas d'échec.
 */
export async function avecFormation<T>(actif: boolean, travail: () => T | Promise<T>): Promise<T> {
  const avant = process.env.LAMA_FORMATION;
  process.env.LAMA_FORMATION = actif ? "1" : "0";
  try {
    return await travail();
  } finally {
    if (avant === undefined) delete process.env.LAMA_FORMATION;
    else process.env.LAMA_FORMATION = avant;
  }
}

/**
 * Exécute `travail` en démonstration publique (`actif`, avec la formation) ou hors d'elle,
 * puis remet `LAMA_FORMATION` et `LAMA_DEMO_PUBLIQUE` comme avant, même en cas d'échec.
 */
export async function avecDemoPublique<T>(actif: boolean, travail: () => T | Promise<T>): Promise<T> {
  const avant = process.env.LAMA_DEMO_PUBLIQUE;
  process.env.LAMA_DEMO_PUBLIQUE = actif ? "1" : "0";
  try {
    return await avecFormation(actif, travail);
  } finally {
    if (avant === undefined) delete process.env.LAMA_DEMO_PUBLIQUE;
    else process.env.LAMA_DEMO_PUBLIQUE = avant;
  }
}

export type Reply = { status: number; body: any; headers: Headers; bytes: Buffer };
export type Caller = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Reply>;

export interface TestApp {
  app: { request: (path: string, init: RequestInit, env: unknown) => Promise<Response> };
  db: DatabaseSync;
  env: { STORAGE: ReturnType<typeof sqliteStorage>; MASTER_KEY: Uint8Array; CLOCK: () => number } & Record<string, unknown>;
  clock: { now: number };
  raw: Caller;
  anonymous(): Caller;
  seedAccount(role: Role, login?: string, extra?: { pin?: string; staff_id?: number }): Promise<{ id: number; login: string; password: string }>;
  as(role: Role): Promise<Caller>;
}

const PASSWORD = "mot-de-passe-test";

/** Enveloppe un appelant brut avec un pot à cookies, comme le ferait un navigateur. */
function jar(raw: Caller): Caller {
  const cookies = new Map<string, string>();
  return async (method, path, body, headers = {}) => {
    const cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const reply = await raw(method, path, body, { "X-Lama": "1", ...(cookie ? { cookie } : {}), ...headers });
    for (const line of reply.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const [name, value] = [pair.slice(0, pair.indexOf("=")).trim(), pair.slice(pair.indexOf("=") + 1).trim()];
      if (attrs.some((a) => /max-age=0/i.test(a)) || value === "") cookies.delete(name);
      else cookies.set(name, value);
    }
    return reply;
  };
}

export async function setupApp(t: { after: (fn: () => void) => void }, opts: { demo?: boolean; history?: boolean; bindings?: Record<string, unknown> } = {}): Promise<TestApp> {
  process.env.LAMA_DEMO = opts.demo === false ? "0" : "1";
  // Historique de démonstration (mini CRM, décision 31) : seulement quand l'essai le demande ;
  // sinon les factures semées dérangeraient la numérotation et les comptes des autres essais.
  process.env.LAMA_DEMO_HISTORY = opts.history ? "1" : "0";
  const { default: app } = await import(`${await appBundle()}#${scenario++}`);
  const db = new DatabaseSync(":memory:");
  registerFunctions(db);
  t.after(() => db.close());
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  const clock = { now: Date.parse("2026-09-28T08:00:00Z") };
  // Liaisons Hono supplémentaires (par exemple `RENDER_TICKET`) : un point d'ancrage propre pour un test qui
  // doit provoquer un échec sans toucher à une donnée réelle, comme `CLOCK` pour l'heure.
  const env = { STORAGE: sqliteStorage(db), MASTER_KEY: new Uint8Array(32).fill(7), CLOCK: () => clock.now, ...opts.bindings };
  const raw: Caller = async (method, path, body, headers = {}) => {
    // Un corps binaire (`Buffer`) part tel quel, sans en-tête JSON : dépôt d'une image.
    const binary = body instanceof Uint8Array;
    const res = await app.request(path, {
      method,
      headers: { ...(binary ? {} : { "content-type": "application/json" }), ...headers },
      ...(body !== undefined ? { body: binary ? new Uint8Array(body) : JSON.stringify(body) } : {}),
    }, env);
    const bytes = Buffer.from(await res.arrayBuffer());
    const text = bytes.toString("utf-8");
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed, headers: res.headers, bytes };
  };
  let staffSeq = 100;
  const seedAccount: TestApp["seedAccount"] = async (role, login = role, extra = {}) => {
    const existing = db.prepare("SELECT id FROM accounts WHERE login = ?").get(login) as { id: number } | undefined;
    if (existing) return { id: existing.id, login, password: PASSWORD };
    let staffId = extra.staff_id ?? null;
    if (role === "practitioner" && staffId === null) {
      staffId = staffSeq++;
      db.prepare("INSERT INTO staff (id, name, email, title, color) VALUES (?, ?, '', '', '#4A5D73')").run(staffId, `Praticienne ${staffId}`);
    }
    const passwordHash = await hashSecret(PASSWORD);
    const pinHash = extra.pin ? await hashSecret(extra.pin) : null;
    const info = db.prepare(
      "INSERT INTO accounts (display_name, login, role, password_hash, pin_hash, staff_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(login, login, role, passwordHash, pinHash, staffId, clock.now);
    return { id: Number(info.lastInsertRowid), login, password: PASSWORD };
  };
  const as: TestApp["as"] = async (role) => {
    const { login } = await seedAccount(role);
    const call = jar(raw);
    const res = await call("POST", "/api/auth/login", { login, password: PASSWORD });
    if (res.status !== 200) throw new Error(`Connexion de test impossible (${role})\u00a0: ${res.status} ${JSON.stringify(res.body)}`);
    return call;
  };
  return { app, db, env, clock, raw, anonymous: () => jar(raw), seedAccount, as };
}
