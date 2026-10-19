import { chiffrer, dechiffrer, nouvelleCle } from "../noyau/coffre.ts";
import { type EtatSalon, IdSalon } from "../noyau/salon.ts";
import type { Base } from "./base.ts";
import { Depot } from "./depot.ts";

/** Intervalle minimal entre deux écritures de `dernier_appel_le` d'un salon (budget d'écritures de D1). */
export const APPEL_NOTE_MS = 60_000;

/** Salon servi par le relais, tel que la gestion et les routes le voient (jamais sa clé). */
export type Salon = { id: string; nom: string; etat: EtatSalon; origines: string[]; cree_le: number; dernier_appel_le: number | null };

type Ligne = { id: string; nom: string; cle: string; etat: EtatSalon; origines: string; cree_le: number; dernier_appel_le: number | null };

const versSalon = (l: Ligne): Salon => ({
  id: l.id, nom: l.nom, etat: l.etat, origines: JSON.parse(l.origines) as string[], cree_le: l.cree_le, dernier_appel_le: l.dernier_appel_le,
});

/** Salons du relais ; les clés partagées sont gardées chiffrées par la clé générale. */
export class Salons {
  private readonly base: Base;
  private readonly maitre: string;

  constructor(base: Base, maitre: string) {
    this.base = base;
    this.maitre = maitre;
  }

  async lister(): Promise<Salon[]> {
    return (await this.base.tous<Ligne>("SELECT * FROM salons ORDER BY id")).map(versSalon);
  }

  async lire(id: string): Promise<Salon | null> {
    const l = await this.base.premier<Ligne>("SELECT * FROM salons WHERE id = ?", [id]);
    return l ? versSalon(l) : null;
  }

  /**
   * Crée le salon et rend sa clé partagée en clair, à montrer une seule fois ; `"existe"` si l'identifiant est pris.
   * Lève une erreur si l'identifiant est invalide ou réservé. Les restes d'un salon supprimé à moitié sont purgés d'abord.
   */
  async creer(id: string, nom: string, maintenant: number): Promise<{ salon: Salon; cle: string } | "existe"> {
    const verdict = IdSalon.safeParse(id);
    if (!verdict.success) throw new Error(`identifiant de salon refusé\u00a0: ${verdict.error.issues[0]?.message ?? id}`);
    if (await this.lire(id)) return "existe";
    await new Depot(this.base, id).effacerTout();
    const cle = nouvelleCle();
    const r = await this.base.executer(
      "INSERT INTO salons (id, nom, cle, etat, origines, cree_le) VALUES (?, ?, ?, 'actif', '[]', ?) ON CONFLICT(id) DO NOTHING",
      [id, nom, await chiffrer(this.maitre, id, cle), maintenant],
    );
    if (r.changements === 0) return "existe";
    return { salon: (await this.lire(id))!, cle };
  }

  /** Clé partagée en clair (vérification des signatures), ou `null` si le salon est inconnu ou la clé illisible. */
  async cle(id: string): Promise<string | null> {
    const l = await this.base.premier<{ cle: string }>("SELECT cle FROM salons WHERE id = ?", [id]);
    return l ? dechiffrer(this.maitre, id, l.cle) : null;
  }

  async remplacerCle(id: string): Promise<string | null> {
    const cle = nouvelleCle();
    const r = await this.base.executer("UPDATE salons SET cle = ? WHERE id = ?", [await chiffrer(this.maitre, id, cle), id]);
    return r.changements > 0 ? cle : null;
  }

  async modifier(id: string, m: { nom?: string; etat?: EtatSalon; origines?: string[] }): Promise<Salon | null> {
    const actuel = await this.lire(id);
    if (!actuel) return null;
    await this.base.executer(
      "UPDATE salons SET nom = ?, etat = ?, origines = ? WHERE id = ?",
      [m.nom ?? actuel.nom, m.etat ?? actuel.etat, JSON.stringify(m.origines ?? actuel.origines), id],
    );
    return this.lire(id);
  }

  /**
   * Note l'appel de lama pour l'état de la liaison, au plus une fois par minute (`APPEL_NOTE_MS`) : lama appelle
   * plusieurs fois par minute, et chaque ligne écrite compte dans le budget quotidien de D1. Moins d'une minute après
   * la dernière note, aucune ligne n'est écrite ; une note située dans le futur (horloge reculée) est réécrite.
   */
  async noterAppel(id: string, maintenant: number): Promise<void> {
    await this.base.executer(
      "UPDATE salons SET dernier_appel_le = ? WHERE id = ? AND (dernier_appel_le IS NULL OR dernier_appel_le <= ? OR dernier_appel_le > ?)",
      [maintenant, id, maintenant - APPEL_NOTE_MS, maintenant],
    );
  }

  /**
   * Supprime le salon et toutes ses données (offre, plages, demandes, compteurs). Les données partent d'abord, la ligne
   * du salon ensuite : après une panne au milieu, relancer la suppression achève le travail.
   */
  async supprimer(id: string): Promise<boolean> {
    await new Depot(this.base, id).effacerTout();
    const r = await this.base.executer("DELETE FROM salons WHERE id = ?", [id]);
    return r.changements > 0;
  }
}
