import { FORME_NOM, FORME_PRENOM } from "../noyau/prenom.ts";
import { ecrireCoordonnees, lireCoordonnees, type Stockage } from "./memoire.ts";
import { indicatifDe, versE164, type Institut } from "./parcours.ts";
import type { CleTexte, Lang } from "./textes.ts";

/**
 * Saisie de la cliente dans les deux formulaires (créneau et rappel), sans dépendance au navigateur :
 * prénom et nom à part, contrôle avant l'envoi, cliente envoyée, mémoire du téléphone.
 */
export type Saisie = { prenom: string; nom: string; telephone: string; langue: Lang; note: string; accord: boolean; memoriser: boolean; piege: string };

/** Longueurs maximales : « Prénom Nom » tient dans les 120 caractères de `cliente.nom` du contrat. */
export const PRENOM_MAX = 60;
export const NOM_MAX = 59;

const net = (v: string) => v.trim().replace(/\s+/g, " ");
/** Espaces multiples réduits, sauts de ligne gardés : ils font refuser la forme. */
const ligne = (v: string) => v.trim().replace(/ {2,}/g, " ");

export function saisieInitiale(lang: Lang, stockage?: Stockage | null): Saisie {
  const m = lireCoordonnees(stockage);
  return { prenom: m?.prenom ?? "", nom: m?.nom ?? "", telephone: m?.telephone ?? "", langue: m?.langue ?? lang, note: "", accord: false, memoriser: m !== null, piege: "" };
}

/** Contrôle avant l'envoi : le message à montrer, ou le téléphone au format international. */
export function controler(s: Saisie, institut: Pick<Institut, "telephone">): { erreur: CleTexte } | { telephone: string } {
  if (!FORME_PRENOM.test(ligne(s.prenom))) return { erreur: "erreur.prenom" };
  if (!FORME_NOM.test(ligne(s.nom)) || !FORME_NOM.test(`${ligne(s.prenom)} ${ligne(s.nom)}`)) return { erreur: "erreur.nom" };
  const telephone = versE164(s.telephone, indicatifDe(institut.telephone));
  if (!telephone) return { erreur: "erreur.telephone" };
  if (!s.accord) return { erreur: "erreur.accord" };
  return { telephone };
}

/** Cliente envoyée au relais : le prénom à part, et dans `nom` le nom complet « Prénom Nom » (un lama ancien en tire encore le prénom). */
export function clienteEnvoyee(s: Saisie, telephone: string): { prenom: string; nom: string; telephone: string; langue: Lang } {
  const prenom = net(s.prenom);
  return { prenom, nom: `${prenom} ${net(s.nom)}`, telephone, langue: s.langue };
}

/** Garde ou oublie les coordonnées sur ce téléphone, selon la case de la cliente. */
export function memoriser(s: Saisie, stockage?: Stockage | null): void {
  ecrireCoordonnees(s.memoriser ? { prenom: net(s.prenom), nom: net(s.nom), telephone: s.telephone, langue: s.langue } : null, stockage);
}
