import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { initDB, run } from "@clawnify/db";
import { loadMasterKey, loadRecipient, readConfig } from "./boot.ts";
import { logAudit } from "./audit.ts";
import { setMasterKey, setSetting } from "./settings.ts";
import { runMigrations } from "./migrations.ts";
import { decryptBackup, prepareRestore, runBackup, writeRestoreNote } from "./backup/backup.ts";
import { openDatabase, sqliteStorage } from "./storage.ts";
import { decode, langFromEnv, message, MessageError } from "./messages.ts";
import { analyserCatalogue, CatalogueRefuse, COLONNES_CATALOGUE, deviseDeLaBase, importerCatalogue, lireCatalogueTableau, type BilanImport, type ErreurLigne } from "./catalogue/import-catalogue.ts";
import { decoderFichier, lireTableau } from "./import/csv.ts";
import { retirerExemples } from "./import/modeles.ts";
import { estCodeDevise } from "../shared/devises.ts";
import { verifierRelais } from "./en-ligne/verifier-relais.ts";
import { ensureSeeded } from "./seed.ts";
import { ecrireComptesFormation } from "./formation/comptes.ts";
import { garderContreVraieBase } from "./formation/mode.ts";
import { ecrireDeviseFormation, lireOptionsDevise, optionsDevise } from "./formation/devise-formation.ts";

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
  if (command === "lire-devise" && args.length === 0) {
    // Devise de la base de ce compte, en options de formation-comptes (une par ligne) : lue par
    // lama-formation --comptes sous le compte de lama. Lecture seule, jamais de migration ni d'écriture.
    const chemin = join(config.dataDir, "lama.db");
    if (!existsSync(chemin)) return 0;
    const db = new DatabaseSync(chemin, { readOnly: true });
    try {
      const options = lireOptionsDevise(db);
      if (options.length) console.log(options.join("\n"));
    } finally {
      db.close();
    }
    return 0;
  }
  if (command === "formation-comptes") {
    // Base de formation seulement (D-16) : jamais de comptes semés ainsi dans la vraie base.
    if (!config.formation) {
      console.error(message(lang, "cli.formation_seulement"));
      return 1;
    }
    // Même garde qu'au démarrage du serveur : jamais les dossiers de la vraie base, quoi que dise l'environnement.
    garderContreVraieBase(config.dataDir, config.configDir, lang);
    // Devise de la vraie base (--devise, --position, --symbole-ecran), validée avant toute écriture ; sans option, XAF.
    const reglages = optionsDevise(args);
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
      // Devise écrite avant tout semis : fiches de démonstration et historique dans cette devise.
      const gardee = await ecrireDeviseFormation(storage, reglages, Date.now());
      if (gardee) console.log(message(lang, "cli.formation_devise_gardee", { gardee, demandee: reglages.devise ?? "" }));
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
  if (command === "verifier-relais" && args.length === 2) {
    // Sorties : 0 conforme, 1 clé absente ou invalide, 2 non conforme, 3 adresse invalide.
    const [adresse, institut] = args;
    let url: URL | null = null;
    try {
      url = new URL(adresse);
    } catch {
      url = null;
    }
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
      console.error(message(lang, "cli.verifier_adresse"));
      return 3;
    }
    // Outil du contrat de réservation en ligne : clé lue sur l'entrée standard, jamais dans la liste des processus.
    if (process.stdin.isTTY) console.error(message(lang, "cli.verifier_invite"));
    const cle = readFileSync(0, "utf8").trim();
    if (!/^[0-9a-f]{64}$/.test(cle)) {
      console.error(message(lang, "cli.verifier_cle"));
      return 1;
    }
    const resultat = await verifierRelais({
      adresse, institut, cle, lang,
      journal: (p) => console.log(p.ok
        ? message(lang, "cli.verifier_point_ok", { nom: p.nom })
        : message(lang, "cli.verifier_point_echec", { nom: p.nom, detail: p.detail ?? "" })),
    });
    console.log(resultat.ok ? message(lang, "cli.verifier_ok", { n: resultat.points.length }) : message(lang, "cli.verifier_echec"));
    return resultat.ok ? 0 : 2;
  }
  if (command === "importer-catalogue" && (args.length === 1 || (args.length === 2 && args[1] === "--desactiver-absentes"))) {
    // Sorties : 0 chargé, 1 fichier illisible ou refusé (rien n'est écrit), 2 devise de la base autre que celle du fichier.
    const [fichier, option] = args;
    if (!existsSync(fichier)) {
      console.error(message(lang, "cli.catalogue_fichier", { fichier }));
      return 1;
    }
    const texte = decoderFichier(readFileSync(fichier));
    if (texte === null) {
      console.error(message(lang, "import.encodage"));
      return 1;
    }
    // Erreur de fichier (en-tête, guillemets, vide, trop de lignes) : imprimée seule, son message porte déjà ce qu'il faut.
    const lecture = lireTableau(texte, COLONNES_CATALOGUE);
    if (!lecture.ok) {
      console.error(message(lang, lecture.erreur.motif, lecture.erreur.valeurs));
      return 1;
    }
    const catalogue = lireCatalogueTableau(retirerExemples("catalogue", lecture.tableau, ""));
    const { lignes, erreurs, devise: deviseFichier } = catalogue;
    const desactiverAbsentes = option === "--desactiver-absentes";
    const chemin = join(config.dataDir, "lama.db");
    const refuser = (refus: ErreurLigne[]) => {
      for (const e of refus) console.error(message(lang, "cli.catalogue_ligne", { ligne: e.ligne, motif: message(lang, e.motif, e.valeurs) }));
      console.error(message(lang, "cli.catalogue_refuse", { n: refus.length }));
      return 1;
    };
    // Fichier fautif sans base : refusé sans la créer. Avec une base, l'aperçu montre aussi les refus des suppléments, en une passe.
    if (erreurs.length && !existsSync(chemin)) return refuser(erreurs);
    const db = openDatabase(chemin);
    try {
      runMigrations(db);
      if (erreurs.length) return refuser(analyserCatalogue(db, catalogue, { base: deviseFichier, desactiverAbsentes }).refusees);
      const devise = deviseDeLaBase(db);
      if (!estCodeDevise(devise) || devise !== deviseFichier) {
        console.error(message(lang, "cli.catalogue_devise", { devise, fichier: deviseFichier }));
        return 2;
      }
      let bilan: BilanImport;
      try {
        bilan = importerCatalogue(db, lignes, { desactiverAbsentes, devise: deviseFichier });
      } catch (erreur) {
        // Durée (case de la base) ou suppléments possibles refusés : la transaction est annulée, rien n'est écrit.
        if (erreur instanceof CatalogueRefuse) return refuser(erreur.refus);
        throw erreur;
      }
      initDB({ STORAGE: sqliteStorage(db) });
      const cible = message("fr", "cli.catalogue_bilan", { lignes: lignes.length, ajoutees: bilan.ajoutees, mises: bilan.misesAJour, desactivees: bilan.desactivees });
      await logAudit({ accountId: null, action: "catalogue.import", target: `${basename(fichier)}\u00a0: ${cible}`, now: Date.now() });
      console.log(message(lang, "cli.catalogue_bilan", { lignes: lignes.length, ajoutees: bilan.ajoutees, mises: bilan.misesAJour, desactivees: bilan.desactivees }));
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
