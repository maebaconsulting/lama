import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { initDB } from "@clawnify/db";
import { generateIdentity, identityToRecipient } from "age-encryption";
import api, { type AppBindings } from "./index.ts";
import { MIGRATIONS, runMigrations } from "./migrations.ts";
import { publish } from "./realtime.ts";
import { getSetting, setMasterKey } from "./settings.ts";
import { openDatabase, sqliteStorage } from "./storage.ts";
import { registerHandler } from "./outbox/outbox.ts";
import { startWorker } from "./outbox/worker.ts";
import { applyPendingRestore, recordRestore, takeRestoreNote, USB_MARKER } from "./backup/backup.ts";
import { secureLocalCopies } from "./backup/copies.ts";
import { createDriveGiveUp, createDriveHandler, execRclone } from "./backup/drive.ts";
import { createPacer, createWhatsappHandler, providerFromSettings, WHATSAPP_KIND } from "./whatsapp/envoi.ts";
import { smsProviderFromSettings } from "./sms/passerelle.ts";
import { renderDocument } from "./whatsapp/pdf-document.ts";
import { startReminders } from "./whatsapp/rappels.ts";
import { startRelances } from "./crm/relances.ts";
import { CHEMINS_HTTP, redirectionHttps, routesCertificat } from "./certificat/routes.ts";
import { horlogeTimedatectl } from "./heure/horloge.ts";
import { lirePaire, signaturePaire, surveillerPaire, type Rechargeur } from "./tls/contexte.ts";
import { noterPassageHttps } from "./auth/passage-https.ts";
import { requeteHttps } from "./tls/proxy.ts";
import { lireManifeste, reponseManifeste } from "./pwa/manifeste.ts";
import { ecrireComptesDemo, retablirComptesFormation } from "./formation/comptes.ts";
import { ADMIN_DEMO } from "./formation/demo.ts";
import { definirDemoPublique, definirFormation, garderContreVraieBase } from "./formation/mode.ts";
import { appliquerRemiseAZero } from "./formation/remise-a-zero.ts";
import { programmerRemiseNocturne, remettreCetteNuit } from "./formation/remise-nocturne.ts";
import { ensureSeeded } from "./seed.ts";
import { langFromEnv, message } from "./messages.ts";

export interface Config {
  dataDir: string;
  configDir: string;
  /** Port de l'application : https quand le certificat est lisible (443 en service), sinon http (8787 en développement). */
  port: number;
  staticDir: string | null;
  dev: boolean;
  usbDir: string;
  /**
   * Dossier du certificat (`LAMA_TLS_DIR`, distribution D-07) : `serveur.key`,
   * `serveur.crt`, `autorite.crt`. `null` ou absent : http seul (développement, essais).
   */
  tlsDir?: string | null;
  /**
   * Écoute http (port 80 en service) : page du certificat et redirection 301
   * vers https ; sans certificat lisible, toute l'application en http.
   * `null` ou absent : aucune (développement ; base de formation de la vague 3, `LAMA_HTTP_PORT=aucun`).
   */
  httpPort?: number | null;
  /**
   * Base de formation (`LAMA_FORMATION=1`, distribution D-14) : mêmes programme
   * et certificat, ses propres dossiers, port 8443, aucun envoi ni sauvegarde.
   */
  formation?: boolean;
  /**
   * Démonstration publique (`LAMA_DEMO_PUBLIQUE=1`, démo publique DP-01) : une
   * base de formation servie derrière un proxy https (Traefik de Dokploy) ;
   * données dans `/data`, port 8080, ni certificat ni page du certificat.
   */
  demoPublique?: boolean;
  /**
   * Derrière un proxy https (`LAMA_PROXY_HTTPS=1`, démo publique DP-07) : `X-Forwarded-Proto: https` rend la
   * requête https (cookies `__Host-`, `Secure`). Absent, ou hors démonstration publique : l'en-tête est ignoré.
   */
  proxyHttps?: boolean;
  /** Mot de passe de l'administration de la démonstration publique (`LAMA_DEMO_MDP_ADMIN`, secret de Dokploy, DP-02). */
  demoMdpAdmin?: string;
}

/** `LAMA_HTTP_PORT` : un numéro, ou `aucun` pour ne pas écouter en http. */
function httpPortOf(value: string | undefined, dev: boolean): number | null {
  if (value === undefined) return dev ? null : 80;
  return value === "aucun" || value === "" ? null : Number(value);
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dev = env.LAMA_DEV === "1";
  // Base de formation (distribution D-14) : ses propres dossiers, jamais ceux de la vraie base ; port 8443 avec
  // le même certificat ; aucune écoute http (le port 80 reste à la vraie base) ; aucun disque de sauvegarde, même
  // si LAMA_BACKUP_DIR est posé (dossier qui n'existe jamais).
  // Démonstration publique (DP-01, DP-07, DP-08) : la formation, dans le volume /data de l'image, sur le port 8080,
  // sans certificat (le proxy fait le https) ; LAMA_TLS_DIR est ignoré.
  const demoPublique = env.LAMA_DEMO_PUBLIQUE === "1";
  const formation = env.LAMA_FORMATION === "1" || demoPublique;
  const dataDir = resolve(env.LAMA_DATA_DIR ?? (demoPublique ? "/data" : formation ? (dev ? "./data/formation" : "/var/lib/lama-formation") : dev ? "./data" : "/var/lib/lama"));
  return {
    dataDir,
    configDir: resolve(env.LAMA_CONFIG_DIR ?? (demoPublique ? join(dataDir, "config") : formation ? (dev ? "./data/formation/config" : "/etc/lama-formation") : dev ? "./data/config" : "/etc/lama")),
    port: Number(env.LAMA_PORT ?? (demoPublique ? 8080 : formation ? 8443 : dev ? 8787 : 443)),
    staticDir: env.LAMA_STATIC_DIR ?? (dev ? null : "dist"),
    dev,
    usbDir: formation ? join(dataDir, "sans-sauvegarde") : resolve(env.LAMA_BACKUP_DIR ?? (dev ? "./data/usb" : "/mnt/lama-sauvegarde")),
    tlsDir: demoPublique ? null : env.LAMA_TLS_DIR ? resolve(env.LAMA_TLS_DIR) : dev ? null : "/etc/lama/tls",
    httpPort: formation ? null : httpPortOf(env.LAMA_HTTP_PORT, dev),
    formation,
    demoPublique,
    demoMdpAdmin: env.LAMA_DEMO_MDP_ADMIN,
    // Démonstration publique seulement : sur le mini-PC d'un institut, la variable est ignorée.
    proxyHttps: demoPublique && env.LAMA_PROXY_HTTPS === "1",
  };
}

/** Clé maîtresse des secrets (32 octets, base64). Créée seulement en développement et dans la démonstration publique (DP-08). */
export function loadMasterKey(configDir: string, dev: boolean): Uint8Array {
  const file = join(configDir, "master.key");
  if (!existsSync(file)) {
    if (!dev) throw new Error(`Clé maîtresse introuvable\u00a0: ${file}. Lancez deploy/installer.sh.`);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
  }
  const key = Buffer.from(readFileSync(file, "utf8").trim(), "base64");
  if (key.length !== 32) throw new Error("Clé maîtresse invalide\u00a0: 32 octets attendus.");
  return new Uint8Array(key);
}

/** Clé publique `age` des sauvegardes. Créée par deploy/installer.sh en production. */
export function loadRecipient(configDir: string, dev: boolean): string {
  const file = join(configDir, "sauvegarde.pub");
  if (!existsSync(file)) {
    if (!dev) throw new Error(`Clé publique de sauvegarde introuvable\u00a0: ${file}. Lancez deploy/installer.sh.`);
    return "";
  }
  return readFileSync(file, "utf8").trim();
}

/**
 * En développement seulement : crée une paire de clés `age` d'essai pour que
 * « Sauvegarder maintenant » et la restauration marchent en local. La clé
 * privée va dans `sauvegarde-DEV.key` (0600) ; en production, elle n'est
 * jamais écrite sur le serveur (deploy/installer.sh l'affiche une seule fois).
 */
export async function ensureDevBackupKeys(configDir: string): Promise<void> {
  const pub = join(configDir, "sauvegarde.pub");
  if (existsSync(pub)) return;
  mkdirSync(configDir, { recursive: true });
  const identity = await generateIdentity();
  const keyFile = join(configDir, "sauvegarde-DEV.key");
  writeFileSync(keyFile, `${identity}\n`, { mode: 0o600 });
  writeFileSync(pub, `${await identityToRecipient(identity)}\n`);
  console.log(`Clés de sauvegarde d'essai créées, clé privée dans ${keyFile}`);
}

export interface Running {
  /** Écoute de l'application : https si `secure`, sinon http. */
  server: Server | HttpsServer;
  port: number;
  /** Vrai si l'application est servie en https (certificat lisible au démarrage). */
  secure: boolean;
  /** Écoute http limitée à la page du certificat (port 80 en service), quand l'application est en https. */
  http: Server | null;
  httpPort: number | null;
  db: DatabaseSync;
  env: AppBindings;
  /** Rechargement à chaud du certificat, quand l'application est en https. */
  reloader: Rechargeur | null;
  /** Démonstration publique (DP-05) : échéance de la prochaine remise de la nuit (3 h de Douala) ; `null` ailleurs. */
  remiseNocturne: number | null;
  stopWorker: () => void;
}

/**
 * Arrêt propre (signal de systemd) : travailleur arrêté, connexions fermées,
 * y compris les flux temps réel qui ne se terminent jamais d'eux-mêmes, puis
 * base fermée (le journal WAL est reporté dans le fichier principal).
 */
export async function shutdown(running: Pick<Running, "server" | "db" | "stopWorker"> & Partial<Pick<Running, "http">>): Promise<void> {
  running.stopWorker();
  const close = (server: Server | HttpsServer) => new Promise<void>((done) => {
    server.close(() => done());
    server.closeAllConnections();
  });
  await Promise.all([close(running.server), ...(running.http ? [close(running.http)] : [])]);
  running.db.close();
}

/** Attend l'écoute et rend le port réel (0 en essai : port libre choisi par le système). */
async function listening(server: Server | HttpsServer, asked: number): Promise<number> {
  await new Promise<void>((ok) => (server.listening ? ok() : server.once("listening", () => ok())));
  const address = server.address();
  return typeof address === "object" && address ? address.port : asked;
}

export async function start(demande: Config = readConfig()): Promise<Running> {
  // Démonstration publique (DP-01) : toujours une base de formation, même si l'appelant ne l'a pas dit. Tout ce qui suit
  // (garde contre la vraie base, file d'envoi, horloge, clés de sauvegarde, remise à zéro) lit `config.formation`.
  // La démonstration ne dépend jamais de l'appelant pour le réseau : ni certificat ni écoute http (le proxy fait le https).
  const config: Config = { ...demande, formation: demande.formation === true || demande.demoPublique === true, ...(demande.demoPublique === true ? { httpPort: null, tlsDir: null } : {}) };
  // Mode du processus posé avant tout : semis, cookies, envois, sauvegardes et documents le lisent (distribution D-14).
  definirDemoPublique(config.demoPublique === true);
  definirFormation(config.formation === true);
  // La formation ne touche jamais la vraie base : refus avant de créer ou d'ouvrir quoi que ce soit.
  if (config.formation) garderContreVraieBase(config.dataDir, config.configDir);
  mkdirSync(config.dataDir, { recursive: true });
  // En formation, ni disque de sauvegarde simulé ni clés de sauvegarde de développement (relecture P-5).
  if (config.dev && !config.formation) {
    await ensureDevBackupKeys(config.configDir);
    // Disque de sauvegarde simulé : le témoin indique que le « disque » est branché.
    mkdirSync(config.usbDir, { recursive: true });
    const marker = join(config.usbDir, USB_MARKER);
    if (!existsSync(marker)) writeFileSync(marker, "");
  }
  const aside = applyPendingRestore(config.dataDir, Date.now());
  if (aside) console.log(`Restauration appliquée\u00a0; ancienne base conservée sous ${aside}`);
  // Remise à zéro de la base de formation (D-19), avant d'ouvrir la base ; une demande trouvée dans la vraie base n'est jamais lue.
  const remise = config.formation === true && appliquerRemiseAZero(config.dataDir);
  const db = openDatabase(join(config.dataDir, "lama.db"));
  runMigrations(db, MIGRATIONS, () => {
    const hasData = (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'clients'").get() as { n: number }).n > 0;
    if (!hasData) return;
    const copy = join(config.dataDir, `avant-migration-${Date.now()}.db`);
    db.prepare("VACUUM INTO ?").run(copy);
    console.log(`Copie de sécurité avant migration\u00a0: ${copy}`);
  });
  // Horloge du système (distribution D-12) : réglée par timedatectl, autorisé au compte lama par polkit.
  // Base de formation (D-17) : aucune horloge du système, qu'elle partage avec la vraie base.
  const env: AppBindings = { STORAGE: sqliteStorage(db), MASTER_KEY: loadMasterKey(config.configDir, config.dev || config.demoPublique === true), ...(config.formation ? {} : { HORLOGE: horlogeTimedatectl() }) };
  initDB(env);
  setMasterKey(env.MASTER_KEY!);
  if (config.demoPublique) {
    // Démonstration publique (DP-02) : à chaque démarrage, fiches, puis les comptes publics et l'administration, puis l'historique.
    const lang = langFromEnv(process.env);
    if (remise) console.log(message(lang, "demo.remise_faite"));
    try {
      await ensureSeeded(env.STORAGE, Date.now());
      const { comptes, admin } = await ecrireComptesDemo(lang, Date.now(), config.demoMdpAdmin);
      await ensureSeeded(env.STORAGE, Date.now());
      console.log(message(lang, "demo.comptes_prets", { comptes: comptes.join(", ") }));
      const cle = admin === "pret" ? "demo.admin_pret" : admin === "trop_court" ? "demo.admin_court" : "demo.admin_absent";
      // Erreur pour le cas trop court : visible dans l'onglet Logs de Dokploy.
      (admin === "trop_court" ? console.error : console.log)(message(lang, cle, { login: ADMIN_DEMO.login }));
    } catch (error) {
      // Le service démarre quand même ; le démarrage suivant rétablit les comptes.
      console.error(message(lang, "demo.comptes_echec", { detail: error instanceof Error ? error.message : String(error) }));
    }
  } else if (remise) {
    // Fiches de la démonstration d'abord (la praticienne est reliée à la fiche n° 1), puis les comptes de formation, puis l'historique, qui attend une gérante.
    const lang = langFromEnv(process.env);
    console.log(message(lang, "formation.remise_faite"));
    try {
      await ensureSeeded(env.STORAGE, Date.now());
      const retablis = await retablirComptesFormation();
      await ensureSeeded(env.STORAGE, Date.now());
      console.log(message(lang, retablis.length ? "formation.remise_comptes" : "formation.remise_sans_compte", { comptes: retablis.join(", ") }));
    } catch (error) {
      // Le service démarre quand même : les comptes se rétablissent par la commande du technicien.
      console.error(message(lang, "formation.remise_echec", { detail: error instanceof Error ? error.message : String(error) }));
    }
  }
  // Note consommée à chaque démarrage ; journalisée seulement si la
  // restauration vient réellement d'être appliquée.
  const note = takeRestoreNote(config.dataDir);
  if (note && aside) await recordRestore(note);
  // Enregistré avant le démarrage du travailleur : un élément « sauvegarde.drive »
  // repris après une coupure ne doit jamais tomber sur un gestionnaire absent.
  registerHandler("sauvegarde.drive", createDriveHandler({ exec: execRclone, now: Date.now }), createDriveGiveUp({ now: Date.now }));
  // WhatsApp (sous-projet 7 § 3) et SMS de secours (spec du 04/10/2026) : fournisseurs relus à chaque envoi, un envoi à la fois,
  // espacés de 4 à 8 s (2 s après un SMS) ; documents produits en PDF au moment de l'envoi ; hors ligne, la file tourne si une passerelle SMS est réglée.
  const pacer = createPacer();
  registerHandler(
    WHATSAPP_KIND,
    createWhatsappHandler({ provider: () => providerFromSettings(), sms: () => smsProviderFromSettings(), document: (doc) => renderDocument(env.STORAGE, doc) }, pacer),
    undefined,
    pacer,
    { offline: async () => { try { return (await getSetting<string>("sms.fournisseur")) === "passerelle"; } catch { return false; } } },
  );
  env.BACKUP = {
    usbDir: config.usbDir,
    tmpDir: join(config.dataDir, "sauvegardes-en-attente"),
    dataDir: config.dataDir,
    // Base de formation : aucune sauvegarde (D-17), donc aucune clé de sauvegarde à lire.
    recipient: config.formation ? "" : loadRecipient(config.configDir, config.dev),
    exec: execRclone,
    // systemd relance le service (Restart=always, plan 2B) après cette sortie.
    // La base est fermée proprement avant de sortir (WAL purgé), pour ne pas
    // laisser de fichiers `-wal`/`-shm` derrière la base venant d'être remplacée.
    // `process.exit` a lieu même si la fermeture lève : sinon le serveur
    // resterait en maintenance jusqu'à un redémarrage manuel.
    requestRestart: () => setTimeout(() => {
      try {
        db.close();
      } finally {
        process.exit(0);
      }
    }, 500),
  };
  // Base de formation (D-17) : la file n'est jamais expédiée ; rappels, relances et campagnes y restent, visibles dans « File d'envoi ».
  const stopOutbox = config.formation ? () => undefined : startWorker({ onChange: () => publish({ resource: "outbox" }) });
  const stopReminders = startReminders({ storage: env.STORAGE, onChange: () => publish({ resource: "outbox" }) });
  // Relances du mini CRM (anniversaire, « vous nous manquez ») : même rythme et même signal que les rappels.
  const stopRelances = startRelances({ storage: env.STORAGE, onChange: () => publish({ resource: "outbox" }) });
  // Démonstration publique (DP-05) : à 3 h de Douala, demande de remise, maintenance, arrêt ; Docker relance et la remise s'applique au démarrage.
  const backup = env.BACKUP;
  const nuit = config.demoPublique ? programmerRemiseNocturne({ now: Date.now, remettre: () => remettreCetteNuit(config.dataDir, backup.requestRestart) }) : null;
  // Certificat du serveur (distribution D-07) : sans paire lisible, http seul, et le journal le dit.
  const tlsDir = config.tlsDir ?? null;
  // Signature prise avant la lecture : un renouvellement tombé entre les deux est rechargé au premier tour.
  const signature = tlsDir ? signaturePaire(tlsDir) : null;
  const read = tlsDir ? lirePaire(tlsDir) : null;
  const pair = read && "paire" in read ? read.paire : null;
  if (tlsDir && read && "motif" in read) {
    console.log(`Certificat illisible dans ${tlsDir} (${read.motif})\u00a0: lama démarre en HTTP seul`);
  }
  let reloader: Rechargeur | null = null;
  const stopWorker = () => {
    stopOutbox();
    stopReminders();
    stopRelances();
    nuit?.arreter();
    reloader?.arreter();
  };

  // Port https réel, connu après l'écoute (le bouton « Vérifier » et la redirection 301 y renvoient).
  let httpsPort = config.port;
  /** Application complète ; `secure` dit à l'API si la requête est arrivée en https (cookies `Secure`, D-08). */
  const application = (secure: boolean) => {
    const root = new Hono();
    // Adresse du poste et https transmis à l'API par des en-têtes internes ; une valeur envoyée par le client est écrasée.
    const internal = (c: Context) => {
      const headers = new Headers(c.req.raw.headers);
      headers.set("x-lama-ip", getConnInfo(c).remote.address ?? "");
      // Derrière un proxy de confiance seulement (LAMA_PROXY_HTTPS=1, DP-07), son X-Forwarded-Proto compte.
      headers.set("x-lama-https", requeteHttps({ ecouteHttps: secure, proxyHttps: config.proxyHttps === true, forwardedProto: c.req.header("x-forwarded-proto") }) ? "1" : "0");
      return headers;
    };
    root.all("/api/*", (c) => api.fetch(new Request(c.req.raw, { headers: internal(c) }), env));
    // /llms.txt (cité par agent.md) : relayé à l'API sous /api/llms.txt, donc derrière la session
    // comme /api/openapi.json ; le /llms.txt nu de la bibliothèque n'est jamais exposé.
    root.get("/llms.txt", (c) => {
      const url = new URL(c.req.url);
      url.pathname = "/api/llms.txt";
      return api.fetch(new Request(url, { method: "GET", headers: internal(c) }), env);
    });
    if (config.demoPublique) {
      // Démonstration publique (DP-07) : aucune autorité à installer, le proxy fait le https ; la page du certificat n'existe pas.
      root.all("/certificat", (c) => c.notFound());
      root.all("/certificat/*", (c) => c.notFound());
    } else {
      root.route("/", routesCertificat({ tlsDir, securisee: secure, portHttps: () => httpsPort }));
    }
    // Manifeste de l'application installable (PWA, P-01) : public, hors de l'API et de sa session, comme la page du certificat.
    root.get("/manifest.webmanifest", async () => reponseManifeste(await lireManifeste(getSetting, config.formation === true, config.demoPublique === true)));
    if (config.staticDir) {
      // Service worker et page d'entrée toujours revalidés (PWA, P-03, P-05) : une version installée sur le mini-PC est vue au chargement suivant.
      root.use("/*", async (c, next) => {
        await next();
        if (c.req.path === "/sw.js" || (c.res.headers.get("content-type") ?? "").startsWith("text/html")) c.header("Cache-Control", "no-cache");
      });
      root.use("/*", serveStatic({ root: config.staticDir }));
      root.get("*", serveStatic({ path: `${config.staticDir}/index.html` }));
    }
    return root;
  };

  let server: Server | HttpsServer;
  let http: Server | null = null;
  let port: number;
  let httpPort: number | null = null;
  if (pair) {
    // Premier service en https noté une fois pour toutes : seuls les postes et sessions d'avant passent du cookie nu à `__Host-` (T3-4).
    noterPassageHttps(db, Date.now());
    const secureServer = serve({ fetch: application(true).fetch, port: config.port, hostname: "0.0.0.0", createServer: createHttpsServer, serverOptions: pair }) as HttpsServer;
    server = secureServer;
    port = httpsPort = await listening(secureServer, config.port);
    reloader = surveillerPaire(tlsDir!, secureServer, { signature, servie: pair });
    if (config.httpPort != null) {
      // Port 80 : la page du certificat et ses fichiers ; tout le reste part en https (301), sans HSTS.
      const certificat = routesCertificat({ tlsDir, securisee: false, portHttps: () => httpsPort });
      const limited = new Hono();
      limited.all("*", (c) => (c.req.method === "GET" || c.req.method === "HEAD") && CHEMINS_HTTP.has(c.req.path)
        ? certificat.fetch(c.req.raw)
        : redirectionHttps(c.req.url, c.req.header("host"), httpsPort));
      http = serve({ fetch: limited.fetch, port: config.httpPort, hostname: "0.0.0.0" }) as Server;
      httpPort = await listening(http, config.httpPort);
    }
    console.log(`lama à l'écoute en HTTPS sur le port ${port}${httpPort === null ? "" : `, page du certificat en HTTP sur le port ${httpPort}`}`);
  } else {
    const asked = config.httpPort ?? config.port;
    server = serve({ fetch: application(false).fetch, port: asked, hostname: "0.0.0.0" }) as Server;
    port = await listening(server, asked);
    console.log(`lama à l'écoute sur le port ${port}`);
  }
  // Copies de sécurité (V1-02, décision 1) : chiffrées, ou protégées en 0600 sans clé, puis élaguées à 3 par
  // sorte, une fois l'application démarrée sans erreur ; un échec est dit à la console sans arrêter le service.
  try {
    const { sealed, removed } = await secureLocalCopies(config.dataDir, env.BACKUP.recipient);
    if (sealed.length || removed.length) console.log(`Copies de sécurité\u00a0: ${sealed.length} chiffrée(s), ${removed.length} supprimée(s)`);
  } catch (error) {
    console.error("Copies de sécurité non traitées\u00a0:", error instanceof Error ? error.message : String(error));
  }
  return { server, port, secure: pair !== null, http, httpPort, db, env, reloader, remiseNocturne: nuit?.echeance ?? null, stopWorker };
}
