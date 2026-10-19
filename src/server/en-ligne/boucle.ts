import { coded, decode, MessageError } from "../messages.ts";
import { isOnline } from "../outbox/connectivity.ts";
import { subscribe } from "../realtime.ts";
import type { StorageBinding } from "../storage.ts";
import { readMessageSettings } from "../whatsapp/rendez-vous.ts";
import { clientRelais, ErreurDelai, type Fetch, type ReponseRelais } from "./client-relais.ts";
import { liaisonReglee, lireConfig, type ConfigEnLigne } from "./config.ts";
import { DemandeRelais, enregistrerDemande } from "./demandes.ts";
import { construirePlages } from "./disponibilites.ts";
import { ecrireEtat, lireEtat, referenceCurseur, type EtatLiaison } from "./etat-liaison.ts";
import { construireOffre, empreinte, logoPourOffre, offreVide } from "./offre.ts";

/**
 * Boucle d'échange avec le relais (spec du 16/10/2026 § 4.3), sur le modèle de `outbox/worker.ts` : à chaque
 * tour, si la liaison est réglée et internet joignable, `GET /etat`, accusé des demandes enregistrées mais pas
 * encore accusées, offre publiée si elle a changé (offre vide si l'interrupteur est coupé), plages publiées si
 * elles ont changé et au moins toutes les 15 minutes, relevé des demandes (enregistrées avec le curseur dans
 * une transaction, puis accusées), décisions en attente. Une erreur n'interrompt rien : elle est notée dans
 * l'état de la liaison et le tour suivant réessaie. Le curseur ne vaut que pour le relais et le salon qui l'ont
 * donné : il est oublié quand l'adresse ou le salon change.
 */
export const INTERVALLE_MS = 60_000;
export const REGROUPEMENT_MS = 3_000;
export const FRAICHEUR_MS = 15 * 60_000;
export const TAILLE_PAGE = 50;
const PAGES_MAX = 20;
/** Changements qui republient l'offre ou les plages au plus vite. */
export const RESSOURCES_ECOUTEES = new Set(["appointments", "blocked_slots", "staff", "services", "settings", "demandes_en_ligne"]);

type Relais = ReturnType<typeof clientRelais>;
export type DependancesTour = { storage: StorageBinding; maintenant?: () => number; fetch?: Fetch; enLigne?: () => boolean; signaler?: (resource: string) => void };
export type ResultatTour = { statut: "non_reglee" | "hors_ligne" | "ok" | "erreur"; nouvelles: number };

/** Refus du relais, sous forme codée. */
class ErreurLiaison extends Error {}

/** Forme codée du refus d'une réponse, ou `null` si elle a le statut attendu. */
export function refusDe(r: ReponseRelais, attendu = 200): string | null {
  if (r.statut === attendu) return null;
  if (r.statut === 401) return coded("en_ligne.refus_signature");
  if (r.statut === 403) return coded("en_ligne.suspendu");
  if (r.statut === 409) return coded("en_ligne.version");
  if (r.statut === 413) return coded("en_ligne.trop_gros");
  if (r.statut === 422) return coded("en_ligne.refus_donnees", { detail: String(r.json?.erreur?.message ?? "").slice(0, 300) });
  return coded("en_ligne.statut", { statut: r.statut });
}

function exiger(r: ReponseRelais): void {
  const refus = refusDe(r);
  if (refus) throw new ErreurLiaison(refus);
}

/** Erreur d'un tour, sous forme codée (`MessageError` : nom de l'institut manquant). */
export function codeErreur(e: unknown): string {
  if (e instanceof ErreurLiaison || e instanceof MessageError) return e.message;
  if (e instanceof ErreurDelai) return coded("en_ligne.delai");
  return coded("en_ligne.injoignable", { detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
}

async function accuser(relais: Relais, storage: StorageBinding, contratId: string, t: number): Promise<void> {
  const r = await relais.appeler("POST", `/demandes/${encodeURIComponent(contratId)}/accuse`);
  // Demande retirée du relais (purgée) : plus rien à accuser, ce n'est pas une erreur.
  if (r.statut !== 404) exiger(r);
  storage.transaction!((db) => db.prepare("UPDATE demandes_en_ligne SET accusee_le = ? WHERE contrat_id = ? AND accusee_le IS NULL").run(t, contratId));
}

/**
 * Erreurs d'un tour, la première de chaque sorte : un envoi en échec n'interrompt jamais les suivants.
 * `transitoire` : à réessayer au prochain tour (le tour est alors en erreur) ; `definitive` : refus qu'un nouvel envoi
 * ne changerait pas (noté dans l'état de la liaison, le tour reste réussi).
 */
type Suivi = { transitoire: string | null; definitive: string | null };

/** Demandes enregistrées mais pas accusées (plantage entre les deux) : accusées avant tout le reste. Rend le nombre d'accusés. */
async function accuserEnRetard(relais: Relais, storage: StorageBinding, maintenant: () => number, suivi: Suivi): Promise<number> {
  const ids = storage.transaction!((db) => (db.prepare("SELECT contrat_id FROM demandes_en_ligne WHERE accusee_le IS NULL ORDER BY id").all() as { contrat_id: string }[]).map((l) => l.contrat_id));
  let accusees = 0;
  for (const id of ids) {
    try {
      await accuser(relais, storage, id, maintenant());
      accusees++;
    } catch (e) {
      suivi.transitoire ??= codeErreur(e);
    }
  }
  return accusees;
}

async function publierOffre(relais: Relais, storage: StorageBinding, cfg: ConfigEnLigne, etat: EtatLiaison, enPlace: ReponseRelais, t: number): Promise<void> {
  const logo = await logoPourOffre(cfg.theme);
  const corps = storage.transaction!((db) => (cfg.active ? construireOffre(db, cfg, logo) : offreVide(cfg, logo)));
  const e = empreinte(corps);
  // À jour : même contenu, et le relais a bien cette version (un relais vidé ou restauré est republié).
  if (e === etat.offre_empreinte && enPlace.json?.version_offre === etat.offre_version) return;
  const version = Math.max(t, etat.offre_version + 1, (Number(enPlace.json?.version_offre) || 0) + 1);
  exiger(await relais.appeler("PUT", "/offre", { version, ...corps }));
  storage.transaction!((db) => ecrireEtat(db, { offre_empreinte: e, offre_version: version, offre_publiee_le: t }));
}

async function publierPlages(relais: Relais, storage: StorageBinding, cfg: ConfigEnLigne, etat: EtatLiaison, enPlace: ReponseRelais, t: number): Promise<void> {
  const corps = storage.transaction!((db) => construirePlages(db, cfg, t));
  const e = empreinte(corps);
  const aJour = e === etat.plages_empreinte && enPlace.json?.version_disponibilites === etat.plages_version && t - (etat.plages_publiees_le ?? 0) < FRAICHEUR_MS;
  if (aJour) return;
  const version = Math.max(t, etat.plages_version + 1, (Number(enPlace.json?.version_disponibilites) || 0) + 1);
  exiger(await relais.appeler("PUT", "/disponibilites", { version, genere_le: t, ...corps }));
  storage.transaction!((db) => ecrireEtat(db, { plages_empreinte: e, plages_version: version, plages_publiees_le: t }));
}

/**
 * Relevé depuis le curseur gardé : chaque page est enregistrée avec le curseur dans une transaction, puis accusée.
 * Chaque demande a son point de sauvegarde : une demande dont l'enregistrement échoue est notée au journal et passée
 * (ni enregistrée ni accusée, elle reste sur le relais), sans empêcher les autres ni le curseur d'avancer.
 * Filet : si le relais annonce des demandes en attente (`attente`) et que le relevé avec curseur ne rend rien (relais
 * remplacé sous la même adresse), la page est relue une fois sans curseur ; les accusés et `contrat_id` évitent les doublons.
 */
async function relever(relais: Relais, storage: StorageBinding, cfg: ConfigEnLigne, maintenant: () => number, suivi: Suivi, attente: number): Promise<{ nouvelles: number; accusees: number }> {
  const messages = await readMessageSettings();
  let nouvelles = 0;
  let accusees = 0;
  let relue = false;
  let sansCurseur = false;
  for (let page = 0; page < PAGES_MAX; page++) {
    const curseur = sansCurseur ? null : storage.transaction!((db) => lireEtat(db).curseur);
    sansCurseur = false;
    const r = await relais.appeler("GET", `/demandes?limite=${TAILLE_PAGE}${curseur ? `&apres=${encodeURIComponent(curseur)}` : ""}`);
    exiger(r);
    const brutes: unknown[] = Array.isArray(r.json?.demandes) ? r.json.demandes : [];
    if (page === 0 && curseur && brutes.length === 0 && attente > 0 && !relue) {
      relue = true;
      sansCurseur = true;
      continue;
    }
    const lues: DemandeRelais[] = [];
    for (const brute of brutes) {
      const l = DemandeRelais.safeParse(brute);
      if (l.success) lues.push(l.data);
      else console.error("Réservation en ligne, demande illisible ignorée\u00a0:", String((brute as { id?: unknown } | null)?.id ?? "?").slice(0, 64));
    }
    const t = maintenant();
    const ids = storage.transaction!((db) => {
      const enregistrees: string[] = [];
      for (const d of lues) {
        db.exec("SAVEPOINT demande");
        try {
          const { nouvelle } = enregistrerDemande(db, d, { institut: cfg.institut.horaires, indicatif: cfg.institut.indicatif, messages, maintenant: t });
          db.exec("RELEASE demande");
          if (nouvelle) nouvelles++;
          enregistrees.push(d.id);
        } catch (e) {
          // Transaction close par SQLite (RAISE ROLLBACK) : plus de point de sauvegarde, la page entière échoue.
          if (!db.isTransaction) throw e;
          db.exec("ROLLBACK TO demande");
          db.exec("RELEASE demande");
          console.error("Réservation en ligne, demande non enregistrée\u00a0:", d.id.slice(0, 64), (e instanceof Error ? e.message : String(e)).slice(0, 200));
        }
      }
      if (typeof r.json?.curseur === "string" && r.json.curseur !== "") ecrireEtat(db, { curseur: r.json.curseur });
      return enregistrees;
    });
    for (const id of ids) {
      try {
        await accuser(relais, storage, id, maintenant());
        accusees++;
      } catch (e) {
        suivi.transitoire ??= codeErreur(e);
      }
    }
    if (brutes.length < TAILLE_PAGE) break;
    // Page pleine sans curseur qui avance : relire la même page ne servirait à rien, le relevé reprend au prochain tour.
    if (typeof r.json?.curseur !== "string" || r.json.curseur === "" || r.json.curseur === curseur) break;
  }
  return { nouvelles, accusees };
}

/**
 * Décisions en attente, dans l'ordre où elles ont été prises. `404` (demande retirée du relais) et `422`
 * (décision refusée : la renvoyer ne changerait rien) la marquent envoyée, comme le `413` (trop volumineuse) ; ce refus
 * est noté pour l'état de la liaison. Une décision remplacée entre-temps reste en attente ; une ligne illisible est
 * signalée au journal et passée.
 */
async function envoyerDecisions(relais: Relais, storage: StorageBinding, maintenant: () => number, suivi: Suivi): Promise<void> {
  const file = storage.transaction!((db) => db.prepare(
    "SELECT id, contrat_id, decision FROM demandes_en_ligne WHERE decision IS NOT NULL AND decision_envoyee_le IS NULL AND accusee_le IS NOT NULL ORDER BY decidee_le, id",
  ).all() as { id: number; contrat_id: string; decision: string }[]);
  for (const l of file) {
    try {
      let corps: unknown;
      try {
        corps = JSON.parse(l.decision);
      } catch {
        console.error("Réservation en ligne, décision illisible ignorée\u00a0:", l.contrat_id.slice(0, 64));
        continue;
      }
      const r = await relais.appeler("POST", `/demandes/${encodeURIComponent(l.contrat_id)}/decision`, corps);
      const definitif = r.statut === 422 || r.statut === 413;
      if (r.statut !== 200 && r.statut !== 404 && !definitif) exiger(r);
      if (definitif) suivi.definitive ??= refusDe(r);
      storage.transaction!((db) => db.prepare("UPDATE demandes_en_ligne SET decision_envoyee_le = ? WHERE id = ? AND decision = ?").run(maintenant(), l.id, l.decision));
    } catch (e) {
      suivi.transitoire ??= codeErreur(e);
    }
  }
}

export async function tour(d: DependancesTour): Promise<ResultatTour> {
  const maintenant = d.maintenant ?? Date.now;
  const cfg = await lireConfig();
  if (!liaisonReglee(cfg)) return { statut: "non_reglee", nouvelles: 0 };
  if (!(d.enLigne ?? isOnline)()) {
    d.storage.transaction!((db) => ecrireEtat(db, { derniere_erreur: coded("en_ligne.pas_internet"), derniere_erreur_le: maintenant() }));
    return { statut: "hors_ligne", nouvelles: 0 };
  }
  const relais = clientRelais({ adresse: cfg.adresse, institut: cfg.salon, cle: cfg.cle!, fetch: d.fetch, maintenant });
  try {
    // Curseur donné par un autre relais ou un autre salon : oublié, le relevé repart du début.
    const ref = referenceCurseur(cfg);
    const etat = d.storage.transaction!((db) => {
      if (lireEtat(db).curseur_ref !== ref) ecrireEtat(db, { curseur: null, curseur_ref: ref });
      return lireEtat(db);
    });
    const enPlace = await relais.appeler("GET", "/etat");
    exiger(enPlace);
    const suivi: Suivi = { transitoire: null, definitive: null };
    const enRetard = await accuserEnRetard(relais, d.storage, maintenant, suivi);
    // Une publication en échec (nom de l'institut vide, refus du relais) n'empêche ni le relevé ni les décisions.
    try {
      await publierOffre(relais, d.storage, cfg, etat, enPlace, maintenant());
    } catch (e) {
      suivi.transitoire ??= codeErreur(e);
    }
    if (cfg.active) {
      try {
        await publierPlages(relais, d.storage, cfg, etat, enPlace, maintenant());
      } catch (e) {
        suivi.transitoire ??= codeErreur(e);
      }
    }
    const annoncees = typeof enPlace.json?.demandes_en_attente === "number" ? enPlace.json.demandes_en_attente : 0;
    const { nouvelles, accusees } = await relever(relais, d.storage, cfg, maintenant, suivi, annoncees);
    await envoyerDecisions(relais, d.storage, maintenant, suivi);
    const attente = typeof enPlace.json?.demandes_en_attente === "number" ? Math.max(0, enPlace.json.demandes_en_attente - accusees - enRetard) : null;
    if (nouvelles > 0) d.signaler?.("demandes_en_ligne");
    if (suivi.transitoire) {
      d.storage.transaction!((db) => ecrireEtat(db, { derniere_erreur: suivi.transitoire, derniere_erreur_le: maintenant(), attente_relais: attente }));
      return { statut: "erreur", nouvelles };
    }
    const refusee = suivi.definitive;
    d.storage.transaction!((db) => ecrireEtat(db, { dernier_succes_le: maintenant(), derniere_erreur: refusee, derniere_erreur_le: refusee ? maintenant() : null, attente_relais: attente }));
    return { statut: "ok", nouvelles };
  } catch (e) {
    d.storage.transaction!((db) => ecrireEtat(db, { derniere_erreur: codeErreur(e), derniere_erreur_le: maintenant() }));
    return { statut: "erreur", nouvelles: 0 };
  }
}

let reveil: (() => void) | null = null;

/** Demande un tour dans quelques secondes (après une décision, « Tester la liaison ») ; sans boucle démarrée, rien. */
export function relancerEnLigne(): void {
  reveil?.();
}

/** Démarre la boucle (lancée par `boot.ts`) : un tour chaque minute, et quelques secondes après un changement d'agenda, regroupés. */
export function startEnLigne(o: DependancesTour & { intervalMs?: number; regroupementMs?: number }): () => void {
  let occupe = false;
  let encore = false;
  let arrete = false;
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  const lancer = async () => {
    if (arrete) return;
    if (occupe) {
      encore = true;
      return;
    }
    occupe = true;
    try {
      do {
        encore = false;
        await tour(o);
      } while (encore && !arrete);
    } catch (e) {
      // Base fermée pendant l'arrêt, ou panne inattendue : jamais un rejet non capturé.
      if (!arrete) console.error("Réservation en ligne\u00a0:", e instanceof Error ? decode("fr", e.message) : e);
    } finally {
      occupe = false;
    }
  };
  const bientot = () => {
    if (arrete || minuterie) return;
    minuterie = setTimeout(() => {
      minuterie = null;
      void lancer();
    }, o.regroupementMs ?? REGROUPEMENT_MS);
    minuterie.unref?.();
  };
  const horloge = setInterval(() => void lancer(), o.intervalMs ?? INTERVALLE_MS);
  horloge.unref?.();
  const desabonner = subscribe((change) => {
    if (RESSOURCES_ECOUTEES.has(change.resource)) bientot();
  });
  reveil = bientot;
  void lancer();
  return () => {
    arrete = true;
    clearInterval(horloge);
    if (minuterie) clearTimeout(minuterie);
    desabonner();
    if (reveil === bientot) reveil = null;
  };
}
