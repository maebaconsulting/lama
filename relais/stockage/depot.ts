import type { Cliente, Decision, Demande, IssueRappel, Souhait, Texte } from "../noyau/contrat.ts";
import type { DemandeActive } from "../noyau/creneaux.ts";
import { enHeure } from "../noyau/temps.ts";
import type { Base } from "./base.ts";

/**
 * Requêtes des données d'un salon (spec § 5, « Données conservées », « Plusieurs salons ») : offre et plages en
 * place, demandes des clientes, compteurs des limites. Chaque requête est limitée au salon du dépôt.
 * Nom, téléphone et note sont effacés dès l'accusé de lama.
 */

/** Une demande jamais relevée, ou décidée, ou relevée sans décision après son créneau, est effacée au bout de 30 jours. */
export const CONSERVATION_MS = 30 * 24 * 60 * 60 * 1000;
const HEURE_MS = 60 * 60 * 1000;
/** Une demande qui n'a pas passé le contrôle après insertion en moins de ce délai est abandonnée (processus interrompu). */
export const VERIFICATION_MS = 60_000;

type NomDocument = "offre" | "disponibilites";

type Ligne = {
  curseur: number; salon: string; id: string; jeton: string; type: "creneau" | "rappel"; prestation: string; prestation_nom: string;
  praticienne: string | null; date: string | null; debut: number | null; fin: number | null; souhait: string | null;
  cliente: string | null; note: string | null; telephone_empreinte: string | null; recue_le: number;
  accusee_le: number | null; decision: string | null; decidee_le: number | null;
};

export type NouvelleDemande = {
  id: string; jeton: string; type: "creneau" | "rappel"; prestation: string; prestation_nom: Texte;
  praticienne: string | null; date: string | null; debut: number | null; fin: number | null; souhait: Souhait | null;
  cliente: Cliente; note: string; telephone_empreinte: string; recue_le: number;
};

export type EtatSuivi = "en_attente" | "confirmee" | "autre_horaire" | "refusee" | "traitee";

/** Ce que montre la page de suivi : jamais le nom ni le téléphone. */
export type Suivi = {
  type: "creneau" | "rappel"; prestation: Texte; date: string | null; heure: string | null; souhait: Souhait | null;
  etat: EtatSuivi; horaire: Decision["horaire"]; message: Decision["message"];
  /** Issue d'un rappel clos ; `null` pour toute autre décision, ou quand lama ne l'a pas donnée (lama plus ancien). */
  issue: IssueRappel | null;
};

/** Curseur opaque du contrat : le rang de la demande sur douze chiffres. */
export function formatCurseur(n: number): string {
  return String(n).padStart(12, "0");
}

export class Depot {
  private readonly base: Base;
  readonly salon: string;

  constructor(base: Base, salon: string) {
    this.base = base;
    this.salon = salon;
  }

  async lireDocument<T>(nom: NomDocument): Promise<T | null> {
    const l = await this.base.premier<{ contenu: string }>("SELECT contenu FROM documents WHERE salon = ? AND nom = ?", [this.salon, nom]);
    return l ? (JSON.parse(l.contenu) as T) : null;
  }

  async versionDocument(nom: NomDocument): Promise<number | null> {
    return (await this.base.premier<{ version: number }>("SELECT version FROM documents WHERE salon = ? AND nom = ?", [this.salon, nom]))?.version ?? null;
  }

  /** Remplace le document si `version` n'est pas plus ancienne que celle en place ; `false` sinon. */
  async ecrireDocument(nom: NomDocument, version: number, contenu: unknown, maintenant: number): Promise<boolean> {
    const r = await this.base.executer(
      "INSERT INTO documents (salon, nom, version, contenu, maj_le) VALUES (?, ?, ?, ?, ?) "
        + "ON CONFLICT(salon, nom) DO UPDATE SET version = excluded.version, contenu = excluded.contenu, maj_le = excluded.maj_le "
        + "WHERE excluded.version >= documents.version",
      [this.salon, nom, version, JSON.stringify(contenu), maintenant],
    );
    return r.changements > 0;
  }

  /** Enregistre la demande et rend son rang (curseur), pour la revérification contre les demandes de rang inférieur. */
  async ajouterDemande(d: NouvelleDemande): Promise<number> {
    const l = await this.base.premier<{ curseur: number }>(
      "INSERT INTO demandes (salon, id, jeton, type, prestation, prestation_nom, praticienne, date, debut, fin, souhait, cliente, note, telephone_empreinte, recue_le) "
        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING curseur",
      [this.salon, d.id, d.jeton, d.type, d.prestation, JSON.stringify(d.prestation_nom), d.praticienne, d.date, d.debut, d.fin,
        d.souhait ? JSON.stringify(d.souhait) : null, JSON.stringify(d.cliente), d.note, d.telephone_empreinte, d.recue_le],
    );
    return Number(l?.curseur);
  }

  /** La demande a passé le contrôle de créneau après insertion : lama peut la relever. `false` si elle a disparu entre-temps (purgée). */
  async confirmer(id: string): Promise<boolean> {
    return (await this.base.executer("UPDATE demandes SET verifiee = 1 WHERE salon = ? AND id = ?", [this.salon, id])).changements > 0;
  }

  /** Efface les demandes de ce salon restées non contrôlées depuis plus de `VERIFICATION_MS` (processus interrompu). */
  async purgerNonVerifiees(maintenant: number): Promise<void> {
    await this.base.executer("DELETE FROM demandes WHERE salon = ? AND verifiee = 0 AND recue_le < ?", [this.salon, maintenant - VERIFICATION_MS]);
  }

  /** Retire une demande de ce salon (annulation d'un double envoi). `false` si inconnue de ce salon. */
  async retirer(id: string): Promise<boolean> {
    return (await this.base.executer("DELETE FROM demandes WHERE salon = ? AND id = ?", [this.salon, id])).changements > 0;
  }

  /**
   * Demandes de créneau à partir de `depuis` (AAAA-MM-JJ), pour le calcul des créneaux.
   * Avec `avantCurseur`, seulement celles de rang strictement inférieur (revérification après insertion).
   */
  async demandesActives(depuis: string, avantCurseur?: number): Promise<DemandeActive[]> {
    const lignes = await this.base.tous<Ligne>(
      "SELECT id, type, prestation, praticienne, date, debut, fin, accusee_le, decision, decidee_le FROM demandes "
        + "WHERE salon = ? AND type = 'creneau' AND date >= ? AND curseur < ? ORDER BY curseur",
      [this.salon, depuis, avantCurseur ?? Number.MAX_SAFE_INTEGER],
    );
    return lignes.map((l) => ({
      id: l.id, type: l.type, prestation: l.prestation, praticienne: l.praticienne, date: l.date, debut: l.debut, fin: l.fin,
      accusee_le: l.accusee_le, decision: l.decision ? (JSON.parse(l.decision) as Decision).decision : null, decidee_le: l.decidee_le,
    }));
  }

  /**
   * Demandes contrôlées, non accusées, de rang supérieur à `apres`, dans l'ordre. Le relevé s'arrête avant la plus
   * ancienne demande récente pas encore contrôlée : le curseur de lama ne saute jamais un rang en cours de contrôle.
   */
  async nonAccusees(apres: number | null, limite: number, maintenant: number): Promise<Demande[]> {
    const lignes = await this.base.tous<Ligne>(
      "SELECT * FROM demandes WHERE salon = ? AND verifiee = 1 AND accusee_le IS NULL AND curseur > ? AND curseur < COALESCE((SELECT MIN(curseur) FROM demandes WHERE salon = ? AND verifiee = 0 AND recue_le >= ?), 9007199254740991) ORDER BY curseur LIMIT ?",
      [this.salon, apres ?? 0, this.salon, maintenant - VERIFICATION_MS, limite],
    );
    return lignes.map((l) => ({
      id: l.id, curseur: formatCurseur(l.curseur), type: l.type, recue_le: l.recue_le, prestation: l.prestation,
      praticienne: l.praticienne, date: l.date, heure: l.debut === null ? null : enHeure(l.debut),
      souhait: l.souhait ? (JSON.parse(l.souhait) as Souhait) : null, cliente: JSON.parse(l.cliente ?? "null") as Cliente,
      note: l.note ?? "", acompte: null,
    }));
  }

  async enAttente(): Promise<number> {
    return (await this.base.premier<{ n: number }>("SELECT COUNT(*) AS n FROM demandes WHERE salon = ? AND verifiee = 1 AND accusee_le IS NULL", [this.salon]))?.n ?? 0;
  }

  /** Accusé de lama : la demande n'est plus renvoyée, nom, téléphone et note sont effacés. `false` si inconnue de ce salon. */
  async accuser(id: string, maintenant: number): Promise<boolean> {
    const r = await this.base.executer(
      "UPDATE demandes SET accusee_le = COALESCE(accusee_le, ?), cliente = NULL, note = NULL WHERE salon = ? AND id = ? AND verifiee = 1",
      [maintenant, this.salon, id],
    );
    return r.changements > 0;
  }

  /** Décision de lama : la même ne change rien, une autre remplace la précédente. `false` si inconnue de ce salon. */
  async decider(id: string, decision: Decision, maintenant: number): Promise<boolean> {
    const texte = JSON.stringify(decision);
    const r = await this.base.executer(
      "UPDATE demandes SET decision = ?, decidee_le = ?, telephone_empreinte = NULL WHERE salon = ? AND id = ? AND verifiee = 1 AND (decision IS NULL OR decision <> ?)",
      [texte, maintenant, this.salon, id, texte],
    );
    if (r.changements > 0) return true;
    return (await this.base.premier("SELECT 1 AS un FROM demandes WHERE salon = ? AND id = ? AND verifiee = 1", [this.salon, id])) !== null;
  }

  /**
   * Demandes sans décision de ce numéro, pour la limite par numéro. Une demande de créneau dont la date est passée
   * (avant `aujourdhui`, date du jour dans le fuseau de l'institut) ne compte plus, même si lama ne l'a jamais décidée.
   */
  async enAttenteParTelephone(empreinte: string, aujourdhui: string): Promise<number> {
    return (await this.base.premier<{ n: number }>(
      "SELECT COUNT(*) AS n FROM demandes WHERE salon = ? AND telephone_empreinte = ? AND decision IS NULL AND (type <> 'creneau' OR date IS NULL OR date >= ?)",
      [this.salon, empreinte, aujourdhui],
    ))?.n ?? 0;
  }

  /** Compte un appel de `cle` (préfixée par le salon) dans la fenêtre qui commence à `fenetre` (ms) et rend le total de cette fenêtre. Une fenêtre plus ancienne que celle en place ne remet jamais le compteur à zéro. */
  async compterAppel(cle: string, fenetre: number): Promise<number> {
    const l = await this.base.premier<{ compte: number }>(
      "INSERT INTO limites (cle, fenetre, compte) VALUES (?, ?, 1) "
        + "ON CONFLICT(cle) DO UPDATE SET compte = CASE WHEN excluded.fenetre > limites.fenetre THEN 1 WHEN excluded.fenetre = limites.fenetre THEN limites.compte + 1 ELSE limites.compte END, "
        + "fenetre = MAX(limites.fenetre, excluded.fenetre) "
        + "RETURNING compte",
      [`${this.salon}:${cle}`, fenetre],
    );
    return l?.compte ?? 1;
  }

  /** Une demande pas encore contrôlée (ou abandonnée) est introuvable pour la page de suivi, comme pour lama et la route d'essai. */
  async suivi(jeton: string): Promise<Suivi | null> {
    const l = await this.base.premier<Ligne>("SELECT * FROM demandes WHERE salon = ? AND jeton = ? AND verifiee = 1", [this.salon, jeton]);
    if (!l) return null;
    const d = l.decision ? (JSON.parse(l.decision) as Decision) : null;
    const etat: EtatSuivi = !d ? "en_attente" : d.decision === "acceptee" ? "confirmee" : d.decision;
    return {
      type: l.type, prestation: JSON.parse(l.prestation_nom) as Texte, date: l.date, heure: l.debut === null ? null : enHeure(l.debut),
      souhait: l.souhait ? (JSON.parse(l.souhait) as Souhait) : null, etat, horaire: d?.horaire ?? null, message: d?.message ?? null, issue: d?.decision === "traitee" ? (d.issue ?? null) : null,
    };
  }

  /** État brut d'une demande, pour la route d'essai (vérification de l'effacement après l'accusé). */
  async pourEssai(id: string): Promise<{ id: string; cliente: Cliente | null; note: string | null; accusee_le: number | null; decision: Decision | null } | null> {
    const l = await this.base.premier<Ligne>("SELECT id, cliente, note, accusee_le, decision FROM demandes WHERE salon = ? AND id = ? AND verifiee = 1", [this.salon, id]);
    if (!l) return null;
    return {
      id: l.id, cliente: l.cliente ? (JSON.parse(l.cliente) as Cliente) : null, note: l.note, accusee_le: l.accusee_le,
      decision: l.decision ? (JSON.parse(l.decision) as Decision) : null,
    };
  }

  /** Efface toutes les données du salon : offre, plages, demandes, compteurs (suppression du salon). */
  async effacerTout(): Promise<void> {
    await this.base.executer("DELETE FROM documents WHERE salon = ?", [this.salon]);
    await this.base.executer("DELETE FROM demandes WHERE salon = ?", [this.salon]);
    await this.base.executer("DELETE FROM limites WHERE substr(cle, 1, length(?)) = ?", [`${this.salon}:`, `${this.salon}:`]);
  }
}

/**
 * Tâche quotidienne, tous salons : demandes jamais relevées ou décidées depuis 30 jours, demandes relevées mais jamais
 * décidées dont le créneau (ou, pour un rappel, la réception) date de plus de 30 jours, vieux compteurs.
 * Rend le nombre de demandes effacées.
 */
export async function purgerTout(base: Base, maintenant: number): Promise<number> {
  const avant = maintenant - CONSERVATION_MS;
  // Date du créneau comparée en UTC : à 30 jours, un jour d'écart de fuseau ne change rien.
  const avantDate = new Date(avant).toISOString().slice(0, 10);
  await base.executer("DELETE FROM demandes WHERE verifiee = 0 AND recue_le < ?", [maintenant - VERIFICATION_MS]);
  const a = await base.executer("DELETE FROM demandes WHERE accusee_le IS NULL AND recue_le < ?", [avant]);
  const b = await base.executer("DELETE FROM demandes WHERE decidee_le IS NOT NULL AND decidee_le < ?", [avant]);
  const c = await base.executer(
    "DELETE FROM demandes WHERE accusee_le IS NOT NULL AND decidee_le IS NULL AND ((type = 'creneau' AND date IS NOT NULL AND date < ?) OR (type = 'rappel' AND recue_le < ?))",
    [avantDate, avant],
  );
  // Une fenêtre est l'instant (ms) où elle commence et dure une heure au plus : un compteur de plus d'un jour est périmé.
  await base.executer("DELETE FROM limites WHERE fenetre < ?", [maintenant - 24 * HEURE_MS]);
  return a.changements + b.changements + c.changements;
}
