import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { langFromEnv, message } from "../messages.ts";

/** Dossiers de la vraie base, que la formation ne doit jamais viser (distribution D-14, relecture P-1). */
const DOSSIERS_VRAIE_BASE = ["/var/lib/lama", "/etc/lama"] as const;

/**
 * Base de formation (distribution D-14) : le même programme sert la vraie base
 * et, dans un second service, une base d'entraînement. Le mode est celui du
 * processus entier, porté par `LAMA_FORMATION` : lu de la même façon par le
 * serveur, ses tâches de fond, la ligne de commande et chaque module assemblé
 * des essais (une variable du processus, et non une variable de module).
 */

/** Vrai si ce processus sert la base de formation (`LAMA_FORMATION=1`). */
export function estFormation(): boolean {
  return process.env.LAMA_FORMATION === "1";
}

/** Pose le mode du processus : au démarrage du serveur (`start`), de la ligne de commande, et dans les essais. */
export function definirFormation(actif: boolean): void {
  process.env.LAMA_FORMATION = actif ? "1" : "0";
}

/**
 * Démonstration publique (démo publique, DP-01) : une base de formation servie
 * sur internet derrière un proxy, avec ses comptes publics et sa remise à zéro
 * de chaque nuit. Mode du processus entier, porté par `LAMA_DEMO_PUBLIQUE`, lu
 * comme `LAMA_FORMATION` ; il va toujours avec la formation (`start` pose les deux).
 */
export function estDemoPublique(): boolean {
  return process.env.LAMA_DEMO_PUBLIQUE === "1";
}

/** Pose le mode démonstration publique du processus : au démarrage du serveur (`start`) et dans les essais. */
export function definirDemoPublique(actif: boolean): void {
  process.env.LAMA_DEMO_PUBLIQUE = actif ? "1" : "0";
}

/**
 * Nom nu d'un cookie de lama (distribution D-15) : `lama_formation_session` et
 * `lama_formation_poste` en formation, pour ne jamais croiser les cookies de la
 * vraie base servie à la même adresse (un navigateur ne distingue pas les ports).
 */
export function nomCookie(base: string): string {
  return estFormation() ? base.replace(/^lama_/, "lama_formation_") : base;
}

/** Chemin réel : le plus proche ancêtre existant est résolu (liens suivis), la suite inexistante est recollée. */
function reel(chemin: string): string {
  const absolu = resolve(chemin);
  let reste = "";
  let courant = absolu;
  for (;;) {
    try {
      return resolve(realpathSync(courant), reste);
    } catch {
      const parent = dirname(courant);
      if (parent === courant) return absolu;
      reste = join(basename(courant), reste);
      courant = parent;
    }
  }
}

/** Vrai si `chemin` est `dossier` ou se trouve dessous. */
const dedans = (chemin: string, dossier: string): boolean => chemin === dossier || chemin.startsWith(dossier + sep);

/**
 * Cœur de la garde, avec des dossiers de référence passés en paramètre (essais).
 * Le candidat est refusé si son chemin absolu ou son chemin réel tombe dans une
 * référence, prise elle aussi telle quelle et en chemin réel : un lien de
 * `/var/lib/lama` vers ailleurs, ou un parent du candidat qui mène à la vraie
 * base, ne contournent pas la garde.
 */
export function garderContre(references: readonly string[], dataDir: string, configDir: string, lang = langFromEnv(process.env)): void {
  for (const dossier of [dataDir, configDir]) {
    const candidats = [resolve(dossier), reel(dossier)];
    const vraies = references.flatMap((r) => [resolve(r), reel(r)]);
    const touche = vraies.find((vraie) => candidats.some((c) => dedans(c, vraie)));
    if (touche) throw new Error(message(lang, "formation.vraie_base", { chemin: resolve(dossier), vraie: touche }));
  }
}

/**
 * Garde de la base de formation : refuse (erreur au message des dictionnaires)
 * un dossier de données ou de configuration qui est la vraie base (`/var/lib/lama`,
 * `/etc/lama`) ou se trouve dessous, liens symboliques compris. Appelée au démarrage
 * du serveur, par la ligne de commande de la formation et par la remise à zéro,
 * avant tout accès.
 */
export function garderContreVraieBase(dataDir: string, configDir: string, lang = langFromEnv(process.env)): void {
  garderContre(DOSSIERS_VRAIE_BASE, dataDir, configDir, lang);
}
