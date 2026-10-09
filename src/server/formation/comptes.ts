/**
 * Comptes de la base de formation (distribution D-16) : un par rôle, créés par
 * le technicien (`sudo lama-formation --comptes`, qui passe par `cli
 * formation-comptes`), jamais par l'écran. Relancer la commande change les
 * mots de passe, débloque les comptes et les rétablit tels que définis ici,
 * sans rien créer en double.
 */
import { get } from "@clawnify/db";
import { AccountError, createAccount, unlockAccount, updateAccount, type Role } from "../auth/accounts.ts";
import { passwordProblem } from "../auth/crypto.ts";
import { deleteSessionsOf } from "../auth/sessions.ts";
import { message, MessageError, type Lang, type MessageKey } from "../messages.ts";
import { ADMIN_DEMO, COMPTES_DEMO } from "./demo.ts";
import { estDemoPublique } from "./mode.ts";

export const COMPTES_FORMATION: readonly { login: string; role: Role; nom: MessageKey; staff_id: number | null }[] = [
  { login: "formation.admin", role: "admin", nom: "formation.compte.admin", staff_id: null },
  { login: "formation.gerante", role: "manager", nom: "formation.compte.gerante", staff_id: null },
  { login: "formation.reception", role: "reception", nom: "formation.compte.reception", staff_id: null },
  // Fiche n° 1 de la démonstration (Solange Ekambi), recréée à chaque remise à zéro.
  { login: "formation.praticienne", role: "practitioner", nom: "formation.compte.praticienne", staff_id: 1 },
];

/**
 * Rétablit un compte de formation existant tel que défini par `COMPTES_FORMATION` :
 * nom affiché, rôle, fiche liée, langue, actif et débloqué ; le mot de passe aussi
 * si `motDePasse` est donné (sinon il est conservé, comme le code PIN). L'identifiant
 * est la clé de recherche, et aucun écran ne permet de le changer.
 */
async function retablirCompte(id: number, compte: (typeof COMPTES_FORMATION)[number], lang: Lang, motDePasse?: string): Promise<void> {
  await updateAccount(id, { display_name: message(lang, compte.nom), role: compte.role, staff_id: compte.staff_id, active: 1, language: lang, ...(motDePasse === undefined ? {} : { password: motDePasse }) });
  await unlockAccount(id);
}

/**
 * Remise à zéro de la base (tâche 3) : rétablit ceux des quatre comptes qui existent
 * (rôle, fiche, nom affiché, langue, actif, débloqué), mots de passe et PIN gardés.
 * Chaque compte garde sa langue (et le nom affiché dans cette langue) : la langue du service
 * systemd n'est pas celle des comptes. Rend les identifiants rétablis, dans l'ordre de
 * `COMPTES_FORMATION` ; vide si aucun compte n'existe.
 */
export async function retablirComptesFormation(): Promise<string[]> {
  const retablis: string[] = [];
  for (const compte of COMPTES_FORMATION) {
    const existant = await get<{ id: number; language: string }>("SELECT id, language FROM accounts WHERE login = ?", [compte.login]);
    if (!existant) continue;
    await retablirCompte(existant.id, compte, existant.language === "en" ? "en" : "fr");
    retablis.push(compte.login);
  }
  return retablis;
}

/**
 * Crée les quatre comptes, ou, s'ils existent, change leur mot de passe et les
 * rétablit (voir `retablirCompte`) ; `motsDePasse` dans l'ordre de `COMPTES_FORMATION`.
 * Nombre et longueur des mots de passe sont vérifiés avant la première écriture.
 * Rend les quatre identifiants.
 */
export async function ecrireComptesFormation(motsDePasse: string[], lang: Lang, now: number): Promise<string[]> {
  if (motsDePasse.length !== COMPTES_FORMATION.length) throw new AccountError("formation.mots_de_passe");
  for (const motDePasse of motsDePasse) {
    const probleme = passwordProblem(motDePasse);
    if (probleme) throw new AccountError(probleme);
  }
  for (const [i, compte] of COMPTES_FORMATION.entries()) {
    const existant = await get<{ id: number }>("SELECT id FROM accounts WHERE login = ?", [compte.login]);
    if (existant) await retablirCompte(existant.id, compte, lang, motsDePasse[i]);
    else await createAccount({ display_name: message(lang, compte.nom), login: compte.login, role: compte.role, password: motsDePasse[i], staff_id: compte.staff_id, language: lang }, now);
  }
  return COMPTES_FORMATION.map((c) => c.login);
}

/** Administration de la démonstration publique : prête, absente (`LAMA_DEMO_MDP_ADMIN` vide) ou trop courte (moins de 10 caractères, traitée comme absente). */
export type EtatAdminDemo = "pret" | "absent" | "trop_court";

/** Crée le compte `login`, ou le rétablit (fiche, mot de passe, actif, débloqué) s'il existe ; rend son numéro. */
async function ecrireCompte(login: string, fiche: { display_name: string; role: Role; staff_id: number | null; password: string; pin?: string | null; language: Lang }, now: number, avantReecriture?: (id: number) => Promise<void>): Promise<number> {
  const existant = await get<{ id: number }>("SELECT id FROM accounts WHERE login = ?", [login]);
  if (existant && avantReecriture) await avantReecriture(existant.id);
  if (!existant) return (await createAccount({ ...fiche, login }, now)).id;
  await updateAccount(existant.id, { ...fiche, active: 1 });
  await unlockAccount(existant.id);
  return existant.id;
}

/**
 * Démonstration publique (démo publique DP-02), à chaque démarrage, sans commande
 * du technicien : les trois comptes publics créés ou rétablis tels que définis
 * dans `COMPTES_DEMO` (nom, rôle, fiche, mot de passe et code PIN publics, langue
 * de l'institut, actifs et débloqués) ; l'administration avec `motDePasseAdmin`
 * (`LAMA_DEMO_MDP_ADMIN`), ses sessions fermées (un compte du même identifiant créé
 * pendant la séance ne garde jamais une session devenue celle de l'administration).
 * Sans mot de passe valable, l'administration n'est pas créée, et une administration
 * existante est désactivée et déconnectée.
 */
export async function ecrireComptesDemo(lang: Lang, now: number, motDePasseAdmin: string | undefined): Promise<{ comptes: string[]; admin: EtatAdminDemo }> {
  // Les mots de passe publics n'existent que dans la démonstration publique : jamais dans la vraie base ni la formation de l'institut.
  if (!estDemoPublique()) throw new MessageError("demo.reservee");
  // Un échec sur un compte public ne doit jamais sauter l'administration (une administration à retirer l'est quand même) : l'erreur est relevée après.
  let echecPublic: unknown;
  try {
    for (const compte of COMPTES_DEMO) {
      await ecrireCompte(compte.login, { display_name: message(lang, compte.nom), role: compte.role, staff_id: compte.staff_id, password: compte.motDePasse, pin: compte.pin, language: lang }, now);
    }
  } catch (erreur) {
    echecPublic = erreur;
  }
  const admin: EtatAdminDemo = !motDePasseAdmin ? "absent" : passwordProblem(motDePasseAdmin) ? "trop_court" : "pret";
  if (admin === "pret") {
    // Sessions fermées avant la réécriture : une erreur en route ne les laisse jamais ouvertes sur un compte devenu l'administration.
    const id = await ecrireCompte(ADMIN_DEMO.login, { display_name: message(lang, ADMIN_DEMO.nom), role: "admin", staff_id: null, password: motDePasseAdmin!, pin: null, language: lang }, now, deleteSessionsOf);
    await deleteSessionsOf(id);
  } else {
    const existant = await get<{ id: number }>("SELECT id FROM accounts WHERE login = ?", [ADMIN_DEMO.login]);
    if (existant) {
      await updateAccount(existant.id, { active: 0 });
      await deleteSessionsOf(existant.id);
    }
  }
  if (echecPublic !== undefined) throw echecPublic;
  return { comptes: COMPTES_DEMO.map((c) => c.login), admin };
}
