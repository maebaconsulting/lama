/**
 * Certificat du serveur (distribution D-06, D-07) : lecture de la paire
 * `serveur.key` et `serveur.crt` du dossier `LAMA_TLS_DIR`, et rechargement à
 * chaud quand `lama-certificat` la remplace (contexte TLS changé sans
 * redémarrage : les connexions ouvertes gardent l'ancien, les suivantes
 * prennent le nouveau).
 */
import { X509Certificate } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createSecureContext } from "node:tls";

export interface PaireTls { key: Buffer; cert: Buffer }

/**
 * Ce qui change quand un fichier de la paire est remplacé (renommage compris) ;
 * `null` si l'un manque. Prise avant `lirePaire` au démarrage : un
 * renouvellement tombé entre la lecture et l'écoute est rechargé au tour suivant.
 */
export function signaturePaire(dir: string): string | null {
  try {
    return ["serveur.key", "serveur.crt"].map((f) => {
      const s = statSync(join(dir, f));
      return `${s.ino}:${s.size}:${s.mtimeMs}`;
    }).join("|");
  } catch {
    return null;
  }
}

/** Paire lisible et cohérente (la clé va avec le certificat), sinon le motif du refus. */
export function lirePaire(dir: string): { paire: PaireTls } | { motif: string } {
  let paire: PaireTls;
  try {
    paire = { key: readFileSync(join(dir, "serveur.key")), cert: readFileSync(join(dir, "serveur.crt")) };
  } catch (error) {
    return { motif: (error as NodeJS.ErrnoException).code ?? (error as Error).message };
  }
  try {
    createSecureContext(paire);
  } catch (error) {
    return { motif: (error as Error).message };
  }
  return { paire };
}

/** Échéance du certificat (`notAfter`). */
export function echeanceDe(cert: Buffer): Date {
  return new Date(new X509Certificate(cert).validTo);
}

/** Moins de jours que ceci avant l'échéance : le journal avertit (une fois par certificat). */
export const ALERTE_ECHEANCE_JOURS = 30;
const JOUR_MS = 86_400_000;
const dateDouala = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Douala" });

export interface Rechargeur {
  /** Relit la paire si un fichier a changé ; vrai si le contexte a été remplacé. */
  verifier(): boolean;
  arreter(): void;
}

/**
 * Surveille la paire du dossier toutes les `intervalleMs` (60 s en service) et
 * la pose sur le serveur https (`setSecureContext`). Une paire illisible ou
 * mêlée (clé déjà remplacée, certificat pas encore) est ignorée et retentée
 * au tour suivant ; l'ancienne reste en service. Le minuteur ne retient
 * jamais le processus (`unref`).
 *
 * `signature` : celle prise avant la lecture de la paire servie (défaut :
 * celle du moment). `servie` : la paire posée au démarrage, dont l'échéance
 * est dite au journal ; à chaque rechargement, celle du nouveau certificat.
 * À moins de `ALERTE_ECHEANCE_JOURS` jours de l'échéance, le journal avertit,
 * une fois par certificat.
 */
export function surveillerPaire(
  dir: string,
  serveur: { setSecureContext(options: PaireTls): void },
  options: {
    intervalleMs?: number;
    journal?: (texte: string) => void;
    signature?: string | null;
    servie?: PaireTls;
    maintenant?: () => number;
  } = {},
): Rechargeur {
  const journal = options.journal ?? ((texte: string) => console.log(texte));
  const maintenant = options.maintenant ?? Date.now;
  let posee = options.signature === undefined ? signaturePaire(dir) : options.signature;
  let refusee: string | null = null;
  let fin = options.servie ? echeanceDe(options.servie.cert) : null;
  let averti = false;
  const surveillerEcheance = () => {
    if (!fin || averti) return;
    const reste = fin.getTime() - maintenant();
    if (reste >= ALERTE_ECHEANCE_JOURS * JOUR_MS) return;
    averti = true;
    const quand = dateDouala.format(fin);
    const jours = Math.floor(reste / JOUR_MS);
    journal(reste > 0
      ? `Attention\u00a0: le certificat du serveur expire le ${quand} (dans ${jours} jour${jours > 1 ? "s" : ""}). Renouvelez-le avec sudo lama-certificat --renouveler.`
      : `Attention\u00a0: le certificat du serveur a expiré le ${quand}. Renouvelez-le avec sudo lama-certificat --renouveler.`);
  };
  if (fin) journal(`Certificat du serveur valable jusqu'au ${dateDouala.format(fin)}`);
  surveillerEcheance();
  const verifier = (): boolean => {
    const actuelle = signaturePaire(dir);
    if (actuelle === null || actuelle === posee || actuelle === refusee) {
      surveillerEcheance();
      return false;
    }
    const lue = lirePaire(dir);
    if ("motif" in lue) {
      refusee = actuelle;
      journal(`Nouveau certificat ignoré (${lue.motif}), l'ancien reste en service`);
      surveillerEcheance();
      return false;
    }
    serveur.setSecureContext(lue.paire);
    posee = actuelle;
    refusee = null;
    fin = echeanceDe(lue.paire.cert);
    averti = false;
    journal(`Certificat du serveur rechargé, valable jusqu'au ${dateDouala.format(fin)}`);
    surveillerEcheance();
    return true;
  };
  const minuteur = setInterval(verifier, options.intervalleMs ?? 60_000);
  minuteur.unref();
  return { verifier, arreter: () => clearInterval(minuteur) };
}
