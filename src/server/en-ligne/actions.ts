import type { Database } from "../storage.ts";
import type { MessageKey, Values } from "../messages.ts";
import { addMinutes, takeIdentifier } from "../rendez-vous-commun.ts";
import { CLOSE_TIME, DAY_CLOSE, findConflicts, toMinutes, validTime, type Busy } from "../scheduling.ts";
import { busyOn, notStarted } from "../transferts.ts";
import { appointmentAt } from "../whatsapp/numeros.ts";
import { dateValide } from "../../shared/horaires.ts";
import type { MessageSettings } from "../whatsapp/rendez-vous.ts";
import { firstName } from "../whatsapp/textes.ts";
import { lireDemande, type EtatDemande, type LigneDemande } from "./demandes.ts";
import { inscrireMessage, messageBilingue, personneDe, type Sujet } from "./messages-en-ligne.ts";

/**
 * Actions de la réception sur une demande en ligne (spec du 16/10/2026 § 4.5), dans une transaction :
 * contrôle de l'état et de l'horaire, écriture (fiche, rendez-vous « En ligne »), décision à transmettre au
 * relais (la boucle l'envoie) et message à la cliente. Un refus n'écrit rien : tous les contrôles passent
 * avant la première écriture.
 */
export type ChoixFiche = { mode: "trouvee" } | { mode: "autre"; client_id: number } | { mode: "nouvelle" };
export type Horaire = { date: string; heure: string; staff_id: number };
/** Horaire d'un rendez-vous créé à la main : la prestation de la demande est reprise, sauf si la réception en choisit une autre. */
export type HoraireChoisi = Horaire & { service_id?: number };
export type Refus = { statut: 400 | 404 | 409; cle: MessageKey; valeurs?: Values; conflits?: Busy[] };
export type Issue<T> = { ok: true; valeur: T } | ({ ok: false } & Refus);
export type ContexteAction = { maintenant: number; compte: number; messages: MessageSettings };

export const MOTIFS = ["complet", "prestation_indisponible", "autre"] as const;
export const ISSUES = ["rdv_pris", "injoignable", "sans_suite"] as const;
/** Au troisième appel sans réponse, la demande de rappel est close d'office (spec § 4.5, action 4). */
export const TENTATIVES_MAX = 3;

const refus = (statut: Refus["statut"], cle: MessageKey, valeurs?: Values, conflits?: Busy[]): { ok: false } & Refus => ({ ok: false, statut, cle, valeurs, conflits });

function demandeEn(db: Database, id: number, etats: EtatDemande[]): Issue<LigneDemande> {
  const d = lireDemande(db, id);
  if (!d) return refus(404, "en_ligne.demande_introuvable");
  if (!etats.includes(d.etat)) return refus(409, "en_ligne.deja_traitee");
  return { ok: true, valeur: d };
}

type HoraireControle = { fin: string; praticienne: { id: number; name: string }; service: { id: number; name: string; name_en: string }; duree: number; prix: number };

/**
 * Horaire contrôlé : prestation encore là, active et vendue seule, jamais « supplément seulement » (celle de la demande, ou `choisie` quand la réception peut en choisir
 * une autre), date et heure valides et pas encore commencées, fin avant la fermeture, praticienne active, libre (sauf `forcer`).
 * `jusquALaFin` (confirmation à l'horaire d'origine) : un créneau commencé mais pas fini, à l'heure de Douala, est accepté,
 * la cliente pouvant être au comptoir.
 */
function horaireLibre(db: Database, d: LigneDemande, h: Horaire, forcer: boolean, ctx: ContexteAction, o: { choisie?: number; peutChoisir?: boolean; jusquALaFin?: boolean } = {}): Issue<HoraireControle> {
  const serviceId = o.choisie ?? d.service_id;
  const service = serviceId === null ? undefined
    : db.prepare("SELECT id, name, name_en, duration, price FROM services WHERE id = ? AND active = 1 AND supplement_seulement = 0").get(serviceId) as { id: number; name: string; name_en: string; duration: number; price: number } | undefined;
  if (!service) {
    if (o.choisie !== undefined) return refus(404, "en_ligne.prestation_inconnue");
    return o.peutChoisir ? refus(400, "en_ligne.prestation_a_choisir") : refus(409, "en_ligne.prestation_absente");
  }
  if (!dateValide(h.date)) return refus(400, "vente.date");
  const refusHeure = validTime(h.heure);
  if (refusHeure) return refus(400, refusHeure);
  const fin = addMinutes(h.heure, service.duration);
  if (toMinutes(h.heure)! + service.duration > DAY_CLOSE) return refus(400, "rdv.fin_apres_fermeture", { fin, fermeture: CLOSE_TIME });
  const aVenir = o.jusquALaFin ? appointmentAt(h.date, fin) > ctx.maintenant : notStarted(h.date, h.heure, ctx.maintenant);
  if (!aVenir) return refus(400, "en_ligne.horaire_passe");
  const praticienne = db.prepare("SELECT id, name FROM staff WHERE id = ? AND active = 1").get(h.staff_id) as { id: number; name: string } | undefined;
  if (!praticienne) return refus(404, "equipe.introuvable");
  if (!forcer) {
    const conflits = findConflicts(h.heure, fin, busyOn(db, praticienne.id, h.date, undefined, d.id));
    if (conflits.length) return refus(409, "en_ligne.pas_libre", { qui: praticienne.name }, conflits);
  }
  return { ok: true, valeur: { fin, praticienne: { id: praticienne.id, name: praticienne.name }, service: { id: service.id, name: service.name, name_en: service.name_en }, duree: service.duration, prix: service.price } };
}

/** Fiche existante contrôlée (trouvée ou autre), sans rien écrire ; une nouvelle fiche est créée plus tard, à l'écriture. */
function ficheControlee(db: Database, d: LigneDemande, choix: ChoixFiche): Issue<number | null> {
  if (choix.mode === "nouvelle") return { ok: true, valeur: null };
  // Une fiche « à vérifier » porte un client_id (même numéro, autre nom) : jamais choisie d'office par « trouvée ».
  if (choix.mode === "trouvee" && d.fiche !== "connue") return refus(400, "en_ligne.fiche_a_choisir");
  const id = choix.mode === "trouvee" ? d.client_id : choix.client_id;
  if (id === null || !db.prepare("SELECT 1 AS un FROM clients WHERE id = ?").get(id)) return refus(404, "cliente.introuvable");
  return { ok: true, valeur: id };
}

/** Fiche à utiliser : celle contrôlée, ou une nouvelle avec le nom, le téléphone (E.164) et la langue de la demande. */
function ficheEcrite(db: Database, d: LigneDemande, controlee: number | null): number {
  if (controlee !== null) return controlee;
  return Number(db.prepare("INSERT INTO clients (name, phone, language) VALUES (?, ?, ?)").run(d.cliente_nom, d.cliente_telephone, d.cliente_langue).lastInsertRowid);
}

/** Rendez-vous confirmé ordinaire, marqué « En ligne », avec la prestation de la demande au prix du jour. */
function ecrireRendezVous(db: Database, d: LigneDemande, h: Horaire, v: HoraireControle, clientId: number, maintenant: number): number {
  const id = Number(db.prepare(
    `INSERT INTO appointments (identifier, client_id, staff_id, status, scheduled_date, start_time, end_time, total_price, notes, booked_at, en_ligne)
     VALUES (?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, 1)`,
  ).run(takeIdentifier(db), clientId, h.staff_id, h.date, h.heure, v.fin, v.prix, d.note, maintenant).lastInsertRowid);
  db.prepare("INSERT INTO appointment_services (appointment_id, service_id, price, duration) VALUES (?, ?, ?, ?)").run(id, v.service.id, v.prix, v.duree);
  return id;
}

const sujet = (d: LigneDemande, date: string | null, heure: string | null, praticienne: string, service?: { name: string; name_en: string }): Sujet => ({
  date, heure, praticienne,
  prestation: service ? { fr: service.name, en: service.name_en || service.name } : { fr: d.prestation_nom, en: d.prestation_nom_en || d.prestation_nom },
});

/** Écrit l'état et la décision à transmettre ; une décision plus récente remplace celle qui attendait encore. */
function decider(db: Database, d: LigneDemande, champs: Record<string, string | number | null>, decision: object, ctx: ContexteAction): void {
  const cles = Object.keys(champs);
  db.prepare(`UPDATE demandes_en_ligne SET ${cles.map((k) => `${k} = ?, `).join("")}decidee_le = ?, decidee_par = ?, decision = ?, decision_envoyee_le = NULL WHERE id = ?`)
    .run(...cles.map((k) => champs[k]), ctx.maintenant, ctx.compte, JSON.stringify(decision), d.id);
}

/** Confirmation (depuis une demande à confirmer, ou un autre horaire accepté) : rendez-vous, décision `acceptee`, message. */
function confirmerSur(
  db: Database, d: LigneDemande, h: HoraireChoisi, fiche: ChoixFiche, forcer: boolean, ctx: ContexteAction, o: { peutChoisir?: boolean; jusquALaFin?: boolean } = {},
): Issue<{ appointment_id: number }> {
  const v = horaireLibre(db, d, h, forcer, ctx, { choisie: h.service_id, ...o });
  if (!v.ok) return v;
  const f = ficheControlee(db, d, fiche);
  if (!f.ok) return f;
  const clientId = ficheEcrite(db, d, f.valeur);
  const rdv = ecrireRendezVous(db, d, h, v.valeur, clientId, ctx.maintenant);
  const s = sujet(d, h.date, h.heure, v.valeur.praticienne.name, v.valeur.service);
  decider(db, d, { etat: "confirmee", staff_id: h.staff_id, client_id: clientId, appointment_id: rdv }, {
    decision: "acceptee", horaire: { date: h.date, heure: h.heure, praticienne: firstName(v.valeur.praticienne.name) },
    message: messageBilingue(ctx.messages, "en_ligne_confirmation", personneDe(d), s),
  }, ctx);
  inscrireMessage(db, ctx.messages, "en_ligne_confirmation", { ...d, client_id: clientId }, s, ctx.maintenant);
  return { ok: true, valeur: { appointment_id: rdv } };
}

/** Action 1 : confirmer (praticienne proposée gardée ou changée, fiche trouvée, autre ou nouvelle). */
export function confirmer(db: Database, id: number, e: { staff_id: number; fiche: ChoixFiche; allow_conflict?: boolean }, ctx: ContexteAction): Issue<{ appointment_id: number }> {
  // Une demande en conflit (prestation retirée, plus de praticienne libre) ne se confirme pas : autre horaire ou refus.
  if (lireDemande(db, id)?.etat === "en_conflit") return refus(409, "en_ligne.en_conflit");
  const lue = demandeEn(db, id, ["a_confirmer"]);
  if (!lue.ok) return lue;
  const d = lue.valeur;
  // Horaire d'origine : confirmable tant que le créneau n'est pas fini (cliente arrivée au comptoir).
  return confirmerSur(db, d, { date: d.date!, heure: d.start_time!, staff_id: e.staff_id }, e.fiche, e.allow_conflict === true, ctx, { jusquALaFin: true });
}

/** Action 2 : proposer un autre horaire libre ; la demande libère son créneau. */
export function proposerAutreHoraire(db: Database, id: number, h: Horaire, ctx: ContexteAction): Issue<Record<string, never>> {
  const lue = demandeEn(db, id, ["a_confirmer", "en_conflit"]);
  if (!lue.ok) return lue;
  const d = lue.valeur;
  const v = horaireLibre(db, d, h, false, ctx);
  if (!v.ok) return v;
  const s = sujet(d, h.date, h.heure, v.valeur.praticienne.name);
  decider(db, d, { etat: "autre_horaire", autre_date: h.date, autre_heure: h.heure, autre_staff_id: h.staff_id }, {
    decision: "autre_horaire", horaire: { date: h.date, heure: h.heure, praticienne: firstName(v.valeur.praticienne.name) },
    message: messageBilingue(ctx.messages, "en_ligne_autre_horaire", personneDe(d), s),
  }, ctx);
  inscrireMessage(db, ctx.messages, "en_ligne_autre_horaire", d, s, ctx.maintenant);
  return { ok: true, valeur: {} };
}

/** Action 2 bis : la cliente accepte l'horaire proposé ; rendez-vous créé et demande confirmée. */
export function rendezVousDepuisAutreHoraire(db: Database, id: number, e: HoraireChoisi & { fiche: ChoixFiche; allow_conflict?: boolean }, ctx: ContexteAction): Issue<{ appointment_id: number }> {
  const lue = demandeEn(db, id, ["autre_horaire"]);
  if (!lue.ok) return lue;
  return confirmerSur(db, lue.valeur, { date: e.date, heure: e.heure, staff_id: e.staff_id, service_id: e.service_id }, e.fiche, e.allow_conflict === true, ctx, { peutChoisir: true });
}

/** Action 3 : refuser, avec un motif et un message facultatif ajouté au texte réglable. */
export function refuserDemande(db: Database, id: number, e: { motif: string; message?: string }, ctx: ContexteAction): Issue<Record<string, never>> {
  const lue = demandeEn(db, id, ["a_confirmer", "en_conflit"]);
  if (!lue.ok) return lue;
  if (!(MOTIFS as readonly string[]).includes(e.motif)) return refus(400, "en_ligne.motif");
  const d = lue.valeur;
  const ajout = (e.message ?? "").trim().slice(0, 500);
  const s = sujet(d, d.date, d.start_time, "");
  decider(db, d, { etat: "refusee", motif: e.motif }, { decision: "refusee", horaire: null, message: messageBilingue(ctx.messages, "en_ligne_refus", personneDe(d), s, ajout) }, ctx);
  inscrireMessage(db, ctx.messages, "en_ligne_refus", d, s, ctx.maintenant, ajout);
  return { ok: true, valeur: {} };
}

/** Action 4 : clore une demande de rappel (« Rendez-vous pris », « Injoignable », « Sans suite »). */
export function clore(
  db: Database, id: number,
  e: { issue: string; rendez_vous?: HoraireChoisi & { fiche: ChoixFiche; allow_conflict?: boolean } },
  ctx: ContexteAction,
): Issue<{ etat: EtatDemande; appointment_id: number | null }> {
  const lue = demandeEn(db, id, ["a_rappeler"]);
  if (!lue.ok) return lue;
  const d = lue.valeur;
  // `issue` (facultative dans le contrat) : la page de suivi dit « Votre demande est close » pour `sans_suite` ; un relais ancien l'ignore.
  const traitee = (issue: (typeof ISSUES)[number]) => ({ decision: "traitee", horaire: null, message: null, issue });
  if (e.issue === "injoignable") {
    const tentatives = d.tentatives + 1;
    if (tentatives < TENTATIVES_MAX) {
      db.prepare("UPDATE demandes_en_ligne SET tentatives = ?, decidee_le = ?, decidee_par = ? WHERE id = ?").run(tentatives, ctx.maintenant, ctx.compte, d.id);
      return { ok: true, valeur: { etat: "a_rappeler", appointment_id: null } };
    }
    decider(db, d, { etat: "traitee", tentatives, motif: "injoignable" }, traitee("injoignable"), ctx);
    return { ok: true, valeur: { etat: "traitee", appointment_id: null } };
  }
  if (e.issue === "sans_suite") {
    decider(db, d, { etat: "traitee", motif: "sans_suite" }, traitee("sans_suite"), ctx);
    return { ok: true, valeur: { etat: "traitee", appointment_id: null } };
  }
  if (e.issue !== "rdv_pris" || !e.rendez_vous) return refus(400, "en_ligne.issue");
  const h = e.rendez_vous;
  const v = horaireLibre(db, d, h, h.allow_conflict === true, ctx, { choisie: h.service_id, peutChoisir: true });
  if (!v.ok) return v;
  const f = ficheControlee(db, d, h.fiche);
  if (!f.ok) return f;
  const clientId = ficheEcrite(db, d, f.valeur);
  const rdv = ecrireRendezVous(db, d, h, v.valeur, clientId, ctx.maintenant);
  decider(db, d, { etat: "traitee", motif: "rdv_pris", staff_id: h.staff_id, client_id: clientId, appointment_id: rdv }, {
    decision: "traitee", horaire: { date: h.date, heure: h.heure, praticienne: firstName(v.valeur.praticienne.name) }, message: null, issue: "rdv_pris",
  }, ctx);
  inscrireMessage(db, ctx.messages, "en_ligne_confirmation", { ...d, client_id: clientId }, sujet(d, h.date, h.heure, v.valeur.praticienne.name, v.valeur.service), ctx.maintenant);
  return { ok: true, valeur: { etat: "traitee", appointment_id: rdv } };
}
