/**
 * Devise de la base de formation (spec du 15/10/2026, § 4) : celle de la vraie
 * base, lue par `cli lire-devise` sous le compte de lama (la formation n'a aucun
 * droit sur `/var/lib/lama`), puis passée en options à `cli formation-comptes`
 * par `sudo lama-formation --comptes`, qui l'écrit avant tout semis.
 */
import type { DatabaseSync } from "node:sqlite";
import { CODES_DEVISES, estCodeDevise, type CodeDevise, type PositionSymbole } from "../../shared/devises.ts";
import { chargerDevise, deviseFigeePar } from "../devise.ts";
import { MessageError } from "../messages.ts";
import { convertirFichesDemo } from "../seed.ts";
import { getSetting, setSetting } from "../settings.ts";
import type { StorageBinding } from "../storage.ts";

/** Réglages de devise demandés pour la formation ; une clé absente n'est pas touchée. */
export interface ReglagesDevise {
  devise?: CodeDevise;
  position?: PositionSymbole;
  symboleEcran?: boolean;
}

/**
 * Lit les options `--devise CODE`, `--position avant|apres` et `--symbole-ecran oui|non`.
 * Toute autre option, une option sans valeur ou une valeur refusée lève une erreur au
 * message des dictionnaires, avant toute écriture.
 */
export function optionsDevise(args: readonly string[]): ReglagesDevise {
  const reglages: ReglagesDevise = {};
  for (let i = 0; i < args.length; i += 2) {
    const [option, valeur] = [args[i], args[i + 1]];
    if (valeur === undefined || !["--devise", "--position", "--symbole-ecran"].includes(option)) throw new MessageError("cli.option_inconnue", { option });
    if (option === "--devise") {
      if (!estCodeDevise(valeur)) throw new MessageError("cli.devise_inconnue", { code: valeur, codes: CODES_DEVISES.join(", ") });
      reglages.devise = valeur;
    } else if (option === "--position") {
      if (valeur !== "avant" && valeur !== "apres") throw new MessageError("cli.option_valeur", { option, valeur, attendu: "avant, apres" });
      reglages.position = valeur;
    } else {
      if (valeur !== "oui" && valeur !== "non") throw new MessageError("cli.option_valeur", { option, valeur, attendu: "oui, non" });
      reglages.symboleEcran = valeur === "oui";
    }
  }
  return reglages;
}

/**
 * Réglages de devise d'une base, en options de `cli formation-comptes`, une par ligne
 * (option puis valeur) ; seuls les réglages écrits et valables sont rendus. Lecture seule.
 */
export function lireOptionsDevise(db: DatabaseSync): string[] {
  const lire = (key: string): unknown => {
    const ligne = db.prepare("SELECT value FROM settings WHERE key = ? AND secret = 0").get(key) as { value: string } | undefined;
    if (!ligne) return undefined;
    try {
      return JSON.parse(ligne.value) as unknown;
    } catch {
      return undefined;
    }
  };
  const options: string[] = [];
  const devise = lire("institut.devise");
  if (estCodeDevise(devise)) options.push("--devise", devise);
  const position = lire("affichage.symbole_position");
  if (position === "avant" || position === "apres") options.push("--position", position);
  const symboleEcran = lire("affichage.symbole_ecran");
  if (typeof symboleEcran === "boolean") options.push("--symbole-ecran", symboleEcran ? "oui" : "non");
  return options;
}

/**
 * Écrit les réglages demandés dans la base de formation, juste après les migrations
 * et avant tout semis, puis charge la devise : les fiches de démonstration sont semées
 * (ou, déjà semées en XAF sans facture, converties) dans cette devise, et l'historique
 * suit. Une devise déjà figée par des ventes de la formation n'est pas changée : rend
 * alors la devise gardée, pour le dire au technicien ; sinon `null`.
 */
export async function ecrireDeviseFormation(storage: StorageBinding, reglages: ReglagesDevise, now: number): Promise<CodeDevise | null> {
  let gardee: CodeDevise | null = null;
  if (reglages.devise !== undefined) {
    const actuelle = await getSetting<string>("institut.devise");
    const figee = storage.transaction!((db) => deviseFigeePar(db) !== null);
    if (actuelle === reglages.devise) {
      // Déjà la bonne devise : rien à écrire.
    } else if (figee) {
      gardee = estCodeDevise(actuelle) ? actuelle : null;
    } else {
      await setSetting("institut.devise", reglages.devise, null, now);
    }
  }
  if (reglages.position !== undefined) await setSetting("affichage.symbole_position", reglages.position, null, now);
  if (reglages.symboleEcran !== undefined) await setSetting("affichage.symbole_ecran", reglages.symboleEcran, null, now);
  await chargerDevise();
  if (reglages.devise !== undefined && gardee === null) await convertirFichesDemo(reglages.devise);
  return gardee;
}
