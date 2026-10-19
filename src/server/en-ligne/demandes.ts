import { z } from "zod";
import type { Database } from "../storage.ts";
import { fold } from "../fold.ts";
import { addMinutes } from "../rendez-vous-commun.ts";
import { toMinutes } from "../scheduling.ts";
import { busyOn } from "../transferts.ts";
import { dateValide, type Semaine } from "../../shared/horaires.ts";
import { normalizePhone } from "../whatsapp/numeros.ts";
import type { MessageSettings } from "../whatsapp/rendez-vous.ts";
import { firstName } from "../whatsapp/textes.ts";
import { deIdentifiant, semaineDe } from "./offre.ts";
import { inscrireMessage } from "./messages-en-ligne.ts";
import { FORME_PRENOM_LAMA, nettoyerNom } from "./identite.ts";
import { plagesLibres } from "./plages.ts";

/**
 * Demandes en ligne reçues du relais (spec du 16/10/2026 § 4.4) : contrôle d'une demande relevée,
 * recherche de la fiche, praticienne retenue (« Sans préférence » : la libre la moins chargée), état
 * d'arrivée (`a_confirmer`, `en_conflit`, `a_rappeler`). Fonctions synchrones sur la base ouverte dans
 * une transaction : l'enregistrement et le curseur du relevé sont écrits ensemble.
 */

/** Demande telle que `GET /demandes` la rend (contrat v1) ; lama ne fait jamais confiance à l'application. */
export const DemandeRelais = z.object({
  id: z.string().min(1).max(64),
  curseur: z.string(),
  type: z.enum(["creneau", "rappel"]),
  recue_le: z.number().int(),
  prestation: z.string().min(1).max(64),
  praticienne: z.string().min(1).max(64).nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  heure: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  souhait: z.object({ jours: z.array(z.string().max(3)).max(7), moments: z.array(z.string().max(12)).max(3), precision: z.string().max(500) }).nullable(),
  cliente: z.object({
    // Jamais refusé : nettoyé (voir `nettoyerNom`), le numéro nomme la fiche s'il ne reste rien de lisible (voir plus bas).
    nom: z.string().transform(nettoyerNom),
    // Prénom saisi à part (relais récent) ; illisible, il est ignoré : jamais une raison de perdre la demande.
    // Même forme que le relais (`FORME_PRENOM`) : une seule ligne, lettres, au plus 3 mots, pour que le texte libre
    // ne passe jamais dans un message de l'institut.
    prenom: z.string().trim().min(1).max(60).regex(FORME_PRENOM_LAMA).optional().catch(undefined),
    telephone: z.string().regex(/^\+[1-9]\d{6,14}$/),
    langue: z.enum(["fr", "en"]),
  }).transform((c) => ({ ...c, nom: c.nom || c.telephone })),
  note: z.string().max(1000),
});
export type DemandeRelais = z.infer<typeof DemandeRelais>;

export type EtatDemande = "a_confirmer" | "en_conflit" | "a_rappeler" | "confirmee" | "autre_horaire" | "refusee" | "traitee";
export type Fiche = "connue" | "nouvelle" | "a_verifier";

/** Une ligne de `demandes_en_ligne` (migration 021). */
export type LigneDemande = {
  id: number; contrat_id: string; type: "creneau" | "rappel"; service_id: number | null; prestation_ref: string;
  prestation_nom: string; prestation_nom_en: string; staff_demande_id: number | null; sans_preference: number; staff_id: number | null;
  date: string | null; start_time: string | null; end_time: string | null;
  cliente_prenom: string | null; cliente_nom: string; cliente_telephone: string; cliente_langue: "fr" | "en"; note: string; souhait: string | null;
  client_id: number | null; fiche: Fiche; etat: EtatDemande; tentatives: number; appointment_id: number | null;
  autre_date: string | null; autre_heure: string | null; autre_staff_id: number | null; motif: string;
  recue_le: number; enregistree_le: number; accusee_le: number | null; decidee_le: number | null; decidee_par: number | null;
  decision: string | null; decision_envoyee_le: number | null;
};

export function lireDemande(db: Database, id: number): LigneDemande | null {
  const l = db.prepare("SELECT * FROM demandes_en_ligne WHERE id = ?").get(id) as LigneDemande | undefined;
  return l ? { ...l } : null;
}

const mots = (nom: string) => fold(nom).replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);

/** Deux noms proches : sans accents ni majuscules, les mots du plus court sont tous dans le plus long. */
export function nomsProches(a: string, b: string): boolean {
  const x = mots(a);
  const y = mots(b);
  if (!x.length || !y.length) return false;
  const [court, long] = x.length <= y.length ? [x, y] : [y, x];
  return court.every((m) => long.includes(m));
}

/**
 * Nom complet gardé (recherche de fiche, fiche créée) : le nom transmis, précédé du prénom quand le relais en donne
 * un que le nom ne porte pas déjà (à n'importe quelle place) (un site tiers peut n'envoyer que le nom de famille).
 */
export function nomComplet(prenom: string | null, nom: string): string {
  const n = nom.trim().replace(/\s+/g, " ");
  const p = (prenom ?? "").trim().replace(/\s+/g, " ");
  if (!p) return n;
  const dans = new Set(mots(n));
  return mots(p).every((m) => dans.has(m)) ? n : `${p} ${n}`;
}

/**
 * Fiche de la cliente (spec § 4.4, « reconnaissance par téléphone ») : même numéro (normalisé avec
 * l'indicatif de l'institut) et nom proche : connue ; même numéro, autre nom : à vérifier (la première
 * fiche de ce numéro est montrée, jamais choisie d'office) ; sinon nouvelle.
 */
export function rechercherFiche(db: Database, nom: string, telephone: string, indicatif: string): { fiche: Fiche; client_id: number | null } {
  const cible = telephone.replace(/^\+/, "");
  const fiches = (db.prepare("SELECT id, name, phone FROM clients WHERE phone IS NOT NULL AND TRIM(phone) <> '' ORDER BY id").all() as { id: number; name: string; phone: string }[])
    .filter((c) => normalizePhone(c.phone, indicatif) === cible);
  if (!fiches.length) return { fiche: "nouvelle", client_id: null };
  const proche = fiches.find((c) => nomsProches(c.name, nom));
  return proche ? { fiche: "connue", client_id: proche.id } : { fiche: "a_verifier", client_id: fiches[0].id };
}

/** Praticienne active, cochée en ligne, qui pratique la prestation. */
export function praticienneOuverte(db: Database, staffId: number, serviceId: number): boolean {
  return Boolean(db.prepare(
    "SELECT 1 AS un FROM staff s JOIN staff_services ss ON ss.staff_id = s.id AND ss.service_id = ? WHERE s.id = ? AND s.active = 1 AND s.en_ligne = 1",
  ).get(serviceId, staffId));
}

/** Libre sur tout `[debut, fin)` ce jour-là : dans ses heures de travail, sans rendez-vous, blocage ni autre demande à confirmer. */
export function libreSur(db: Database, staffId: number, date: string, debut: string, fin: string, institut: Semaine, exclureDemande?: number): boolean {
  const fiche = db.prepare("SELECT horaires FROM staff WHERE id = ?").get(staffId) as { horaires: string | null } | undefined;
  const a = toMinutes(debut);
  const b = toMinutes(fin);
  if (!fiche || a === null || b === null || b <= a) return false;
  return plagesLibres(semaineDe(fiche.horaires), institut, busyOn(db, staffId, date, undefined, exclureDemande), date).some((i) => i.start <= a && b <= i.end);
}

/** Rendez-vous non annulés et demandes à confirmer de la praticienne ce jour-là. */
function charge(db: Database, staffId: number, date: string): number {
  return (db.prepare(
    `SELECT (SELECT COUNT(*) FROM appointments WHERE staff_id = ? AND scheduled_date = ? AND status != 'cancelled')
          + (SELECT COUNT(*) FROM demandes_en_ligne WHERE staff_id = ? AND date = ? AND etat = 'a_confirmer') AS n`,
  ).get(staffId, date, staffId, date) as { n: number }).n;
}

/** « Sans préférence » : la praticienne ouverte en ligne, libre, la moins chargée ce jour-là ; à égalité la première par nom. */
export function proposerPraticienne(db: Database, serviceId: number, date: string, debut: string, fin: string, institut: Semaine): number | null {
  const candidates = db.prepare(
    "SELECT s.id FROM staff s JOIN staff_services ss ON ss.staff_id = s.id AND ss.service_id = ? WHERE s.active = 1 AND s.en_ligne = 1 ORDER BY s.name, s.id",
  ).all(serviceId) as { id: number }[];
  const libres = candidates.filter((s) => libreSur(db, s.id, date, debut, fin, institut));
  // Tri stable : à charge égale, l'ordre par nom est gardé.
  return [...libres].sort((x, y) => charge(db, x.id, date) - charge(db, y.id, date))[0]?.id ?? null;
}

export type ContexteArrivee = { institut: Semaine; indicatif: string; messages: MessageSettings; maintenant: number };

/**
 * Enregistre une demande relevée, une seule fois (`contrat_id` unique) : déjà connue, elle est rendue telle
 * quelle. Un créneau est `a_confirmer` avec sa praticienne retenue, ou `en_conflit` si aucune n'est libre
 * (ou si la prestation, la praticienne ou l'horaire ont été retirés entre-temps) ; une demande de rappel est
 * `a_rappeler`. Ni une demande en conflit ni un rappel n'occupent l'agenda.
 */
export function enregistrerDemande(db: Database, d: DemandeRelais, ctx: ContexteArrivee): { id: number; nouvelle: boolean } {
  const deja = db.prepare("SELECT id FROM demandes_en_ligne WHERE contrat_id = ?").get(d.id) as { id: number } | undefined;
  if (deja) return { id: deja.id, nouvelle: false };
  const serviceId = deIdentifiant(d.prestation, "s");
  const service = serviceId === null ? undefined : db.prepare("SELECT id, name, name_en, duration, active, en_ligne FROM services WHERE id = ?").get(serviceId) as
    { id: number; name: string; name_en: string; duration: number; active: number; en_ligne: number } | undefined;
  const demandee = d.praticienne === null ? null : deIdentifiant(d.praticienne, "p");
  const demandeeConnue = demandee !== null && Boolean(db.prepare("SELECT 1 AS un FROM staff WHERE id = ?").get(demandee));
  const prenom = d.cliente.prenom ?? null;
  const nom = nomComplet(prenom, d.cliente.nom);
  const fiche = rechercherFiche(db, nom, d.cliente.telephone, ctx.indicatif);
  let etat: EtatDemande = "a_rappeler";
  let retenue: number | null = null;
  let debut: string | null = null;
  let fin: string | null = null;
  if (d.type === "creneau") {
    debut = d.heure;
    fin = service && d.heure ? addMinutes(d.heure, service.duration) : null;
    const ouverte = service !== undefined && service.active === 1 && service.en_ligne === 1 && d.date !== null && dateValide(d.date)
      && debut !== null && fin !== null && (toMinutes(fin) ?? 0) > (toMinutes(debut) ?? 0);
    if (ouverte) {
      if (d.praticienne === null) retenue = proposerPraticienne(db, service.id, d.date!, debut!, fin!, ctx.institut);
      else if (demandee !== null && praticienneOuverte(db, demandee, service.id) && libreSur(db, demandee, d.date!, debut!, fin!, ctx.institut)) retenue = demandee;
    }
    etat = retenue === null ? "en_conflit" : "a_confirmer";
  }
  const r = db.prepare(
    `INSERT INTO demandes_en_ligne (contrat_id, type, service_id, prestation_ref, prestation_nom, prestation_nom_en, staff_demande_id, sans_preference, staff_id,
       date, start_time, end_time, cliente_prenom, cliente_nom, cliente_telephone, cliente_langue, note, souhait, client_id, fiche, etat, recue_le, enregistree_le)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    d.id, d.type, service?.id ?? null, d.prestation, service?.name ?? "", service?.name_en ?? "", demandeeConnue ? demandee : null, d.praticienne === null ? 1 : 0, retenue,
    d.type === "creneau" ? d.date : null, debut, fin, prenom, nom, d.cliente.telephone, d.cliente.langue, d.note,
    d.souhait ? JSON.stringify(d.souhait) : null, fiche.client_id, fiche.fiche, etat, d.recue_le, ctx.maintenant,
  );
  const id = Number(r.lastInsertRowid);
  // Demande de rappel : accusé de réception, dans la même transaction (spec § 4.5, quatrième texte). Le formulaire est public :
  // l'accusé ne part que vers une fiche connue (même numéro, nom proche), avec le prénom de la fiche et jamais le nom saisi.
  if (d.type === "rappel" && fiche.fiche === "connue" && fiche.client_id !== null) {
    const connue = db.prepare("SELECT name FROM clients WHERE id = ?").get(fiche.client_id) as { name: string };
    inscrireMessage(db, ctx.messages, "en_ligne_rappel", { id, cliente_prenom: firstName(connue.name) || null, cliente_nom: connue.name, cliente_telephone: d.cliente.telephone, cliente_langue: d.cliente.langue, client_id: fiche.client_id },
      { date: null, heure: null, praticienne: "", prestation: { fr: service?.name ?? "", en: service?.name_en || service?.name || "" } }, ctx.maintenant);
  }
  return { id, nouvelle: true };
}
