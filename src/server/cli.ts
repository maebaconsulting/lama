import { mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { initDB, run } from "@clawnify/db";
import { loadMasterKey, loadRecipient, readConfig } from "./boot.ts";
import { logAudit } from "./audit.ts";
import { setMasterKey, setSetting } from "./settings.ts";
import { runMigrations } from "./migrations.ts";
import { decryptBackup, prepareRestore, runBackup, writeRestoreNote } from "./backup/backup.ts";
import { openDatabase, sqliteStorage } from "./storage.ts";
import { decode, langFromEnv, message, MessageError } from "./messages.ts";
import { ensureSeeded } from "./seed.ts";
import { ecrireComptesFormation } from "./formation/comptes.ts";
import { garderContreVraieBase } from "./formation/mode.ts";

const lang = langFromEnv(process.env);

async function main(argv: string[]) {
  const config = readConfig();
  const [command, ...args] = argv;
  if (config.formation && (command === "sauvegarder" || command === "restaurer")) {
    // Base de formation (D-17) : aucune sauvegarde ni restauration ; lancée par erreur, la sauvegarde de 2 h n'a aucun effet.
    console.log(message(lang, "cli.formation_sans_sauvegarde"));
    return command === "sauvegarder" ? 0 : 1;
  }
  if (command === "sauvegarder") {
    const db = openDatabase(join(config.dataDir, "lama.db"));
    runMigrations(db);
    initDB({ STORAGE: sqliteStorage(db) });
    const remoteRow = db.prepare("SELECT value FROM settings WHERE key = 'technique.drive_remote'").get() as { value: string } | undefined;
    // Non revalidé ici : un remote invalide ne doit pas empêcher la copie USB ;
    // l'envoi Drive le revalide et enregistre l'échec (drive.ts).
    // Sans destination réglée par l'administrateur, aucun envoi Drive n'est mis en file (décision 15).
    const remote = remoteRow ? (JSON.parse(remoteRow.value) as string) : null;
    const result = await runBackup({
      run: (sql, params) => run(sql, params), recipient: loadRecipient(config.configDir, config.dev),
      usbDir: config.usbDir, tmpDir: join(config.dataDir, "sauvegardes-en-attente"),
      remote, now: Date.now(),
    });
    console.log(message(lang, "cli.sauvegarde", { usb: message(lang, result.usb === "ok" ? "cli.reussi" : "cli.echec") }));
    db.close();
    return result.usb === "ok" ? 0 : 2;
  }
  if (command === "restaurer" && args.length === 2) {
    const [file, keyFile] = args;
    prepareRestore(await decryptBackup(readFileSync(file), readFileSync(keyFile, "utf8").trim()), config.dataDir);
    writeRestoreNote(config.dataDir, { accountId: null, login: "ligne de commande", name: basename(file), ip: "", at: Date.now() });
    console.log(message(lang, "cli.restauration"));
    return 0;
  }
  if (command === "waha-cle" && args.length === 0) {
    // Clé lue sur l'entrée standard : jamais dans la liste des processus.
    const cle = readFileSync(0, "utf8").trim();
    if (!/^\S{1,200}$/.test(cle)) {
      console.error(message(lang, "cli.waha_cle_invalide"));
      return 1;
    }
    const db = openDatabase(join(config.dataDir, "lama.db"));
    try {
      runMigrations(db);
      initDB({ STORAGE: sqliteStorage(db) });
      setMasterKey(loadMasterKey(config.configDir, config.dev));
      const now = Date.now();
      await setSetting("waha.cle", cle, null, now);
      await logAudit({ accountId: null, action: "reglage", target: "waha.cle", now });
      // L'adresse du conteneur installé n'est écrite que si l'administrateur n'en a pas choisi une autre.
      if (!db.prepare("SELECT 1 FROM settings WHERE key = 'waha.adresse'").get()) {
        await setSetting("waha.adresse", "http://127.0.0.1:3000", null, now);
        await logAudit({ accountId: null, action: "reglage", target: "waha.adresse", now });
      }
    } finally {
      db.close();
    }
    console.log(message(lang, "cli.waha_cle"));
    return 0;
  }
  if (command === "formation-comptes" && args.length === 0) {
    // Base de formation seulement (D-16) : jamais de comptes semés ainsi dans la vraie base.
    if (!config.formation) {
      console.error(message(lang, "cli.formation_seulement"));
      return 1;
    }
    // Même garde qu'au démarrage du serveur : jamais les dossiers de la vraie base, quoi que dise l'environnement.
    garderContreVraieBase(config.dataDir, config.configDir, lang);
    // Quatre lignes lues sur l'entrée standard : jamais dans la liste des processus ni dans l'historique du terminal.
    const lignes = readFileSync(0, "utf8").split("\n").map((l) => l.replace(/\r$/, ""));
    const motsDePasse = lignes.slice(0, 4);
    if (motsDePasse.length < 4 || motsDePasse.some((m) => m === "")) throw new MessageError("formation.mots_de_passe");
    mkdirSync(config.dataDir, { recursive: true });
    const db = openDatabase(join(config.dataDir, "lama.db"));
    try {
      runMigrations(db);
      const storage = sqliteStorage(db);
      initDB({ STORAGE: storage });
      setMasterKey(loadMasterKey(config.configDir, config.dev));
      // Fiches de la démonstration d'abord (la praticienne est reliée à la fiche n° 1), puis l'historique, qui attend une gérante.
      await ensureSeeded(storage, Date.now());
      const logins = await ecrireComptesFormation(motsDePasse, lang, Date.now());
      await ensureSeeded(storage, Date.now());
      console.log(message(lang, "cli.formation_comptes", { comptes: logins.join(", ") }));
    } finally {
      db.close();
    }
    return 0;
  }
  console.log(message(lang, "cli.usage"));
  return 1;
}

main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
  console.error(error instanceof Error ? decode(lang, error.message) : error);
  process.exit(1);
});
