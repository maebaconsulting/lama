/**
 * Import des rendez-vous à venir (spec du 18/10/2026 § 2.5). Mêmes règles que la prise de rendez-vous :
 * heure de 07:00 à 23:00 par pas de 5 minutes, fin au plus tard à 23:00, praticienne libre sur tout le
 * créneau (rendez-vous, créneaux bloqués, demandes en ligne à confirmer, lignes précédentes du fichier).
 * Date passée à l'heure de Douala, prestation ou praticienne introuvable, prestation « supplément seulement »
 * (elle ne se réserve que sous une autre, spec § 3.1) : ligne refusée. Durée et prix
 * viennent de la prestation ; une cliente inconnue est créée ; un nom différent de celui de la fiche
 * reconnue est signalé. Rendez-vous confirmés, sans message. Dates et heures réécrites par le tableur
 * (`JJ/MM/AAAA`, `HH:MM:SS`) acceptées.
 */
import type { Database } from "../storage.ts";
import { appointmentAt, normalizePhone } from "../whatsapp/numeros.ts";
import { validDay } from "../caisse/cloture.ts";
import { CLOSE_TIME, DAY_CLOSE, findConflicts, toMinutes, validTime, type Busy } from "../scheduling.ts";
import { busyOn } from "../transferts.ts";
import { nomsProches } from "../en-ligne/demandes.ts";
import { addMinutes, takeIdentifier } from "../rendez-vous-commun.ts";
import { analyseVide, indexerPraticiennes, indexerPrestations, nomPropre, type Analyse, type Contexte } from "./commun.ts";
import { fichesParTelephone } from "./clientes.ts";
import type { Colonnes, Refus, Tableau } from "./csv.ts";

export const COLONNES_RENDEZ_VOUS: Colonnes = {
  obligatoires: ["date", "heure", "telephone", "prestation", "praticienne"],
  facultatives: ["nom_cliente", "notes"],
};

export interface OperationRendezVous {
  date: string;
  debut: string;
  fin: string;
  staffId: number;
  serviceId: number;
  prix: number;
  duree: number;
  /** Fiche existante, ou cliente à créer (une seule fiche par numéro normalisé `cle`). */
  cliente: { id: number } | { cle: string; telephone: string; nom: string };
  notes: string;
}

/** Date du fichier en `AAAA-MM-JJ` : `AAAA-MM-JJ`, ou `JJ/MM/AAAA` et `J/M/AAAA` qu'écrit le tableur ; `null` si le jour n'existe pas. */
export function dateDeFichier(v: string): string | null {
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  const date = fr ? `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}` : v;
  return validDay(date) ? date : null;
}

/** Heure du fichier en `HH:MM` : `H:MM` complétée, `HH:MM:SS` du tableur acceptée si les secondes sont à 00 ; sinon telle quelle, pour que `validTime` la refuse. */
export function heureDeFichier(v: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(v);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : v;
}

/** Aperçu des rendez-vous, sans rien écrire : rendez-vous à créer, clientes à créer, lignes refusées. */
export function analyserRendezVous(db: Database, tableau: Tableau, ctx: Pick<Contexte, "indicatif" | "maintenant">): Analyse<OperationRendezVous> {
  const a = analyseVide<OperationRendezVous>(tableau.lignes.length + tableau.refusees.length, tableau.refusees);
  const prestation = indexerPrestations(db);
  const praticienne = indexerPraticiennes(db);
  const fiches = fichesParTelephone(db, ctx.indicatif);
  const deja = db.prepare("SELECT 1 AS un FROM appointments WHERE client_id = ? AND scheduled_date = ? AND start_time = ? AND status != 'cancelled'");
  const agenda = new Map<string, Busy[]>();
  const prises = (staffId: number, date: string): Busy[] => {
    const k = `${staffId}|${date}`;
    let l = agenda.get(k);
    if (!l) {
      l = busyOn(db, staffId, date);
      agenda.set(k, l);
    }
    return l;
  };
  const nouvelles = new Set<string>();
  const vus = new Set<string>();
  for (const { numero, champs } of tableau.lignes) {
    const refuser = (r: Omit<Refus, "ligne">) => a.refusees.push({ ligne: numero, ...r });
    const date = dateDeFichier(champs.date);
    if (date === null) { refuser({ motif: "import.date" }); continue; }
    const c: Record<string, string> = { ...champs, date, heure: heureDeFichier(champs.heure), nom_cliente: nomPropre(champs.nom_cliente) };
    const heure = validTime(c.heure);
    if (heure) { refuser({ motif: heure }); continue; }
    if (!(appointmentAt(c.date, c.heure) > ctx.maintenant)) { refuser({ motif: "import.rdv_passe" }); continue; }
    const telephone = normalizePhone(c.telephone, ctx.indicatif);
    if (!telephone) { refuser({ motif: "import.telephone" }); continue; }
    const p = prestation(c.prestation);
    if (!("trouve" in p)) { refuser(p); continue; }
    if (p.trouve.supplement_seulement === 1) { refuser({ motif: "rdv.supplement_seul", valeurs: { nom: p.trouve.name } }); continue; }
    const s = praticienne(c.praticienne);
    if (!("trouve" in s)) { refuser(s); continue; }
    const fin = addMinutes(c.heure, p.trouve.duration);
    if (toMinutes(c.heure)! + p.trouve.duration > DAY_CLOSE) { refuser({ motif: "rdv.fin_apres_fermeture", valeurs: { fin, fermeture: CLOSE_TIME } }); continue; }
    const cleLigne = `${c.date}|${c.heure}|${telephone}`;
    if (vus.has(cleLigne)) { refuser({ motif: "import.doublon_rdv", doublon: true }); continue; }
    const fiche = fiches.get(telephone);
    if (!fiche && !nouvelles.has(telephone) && !c.nom_cliente) { refuser({ motif: "import.nom_cliente" }); continue; }
    if (fiche && deja.get(fiche.id, c.date, c.heure)) { refuser({ motif: "import.rdv_deja", doublon: true }); continue; }
    const occupe = prises(s.trouve.id, c.date);
    const conflit = findConflicts(c.heure, fin, occupe)[0];
    if (conflit) { refuser({ motif: "import.rdv_occupee", valeurs: { praticienne: s.trouve.name, debut: conflit.start_time, fin: conflit.end_time } }); continue; }
    // Clé vue seulement une fois la ligne acceptée : une ligne refusée plus haut ne fait pas refuser sa jumelle valide.
    vus.add(cleLigne);
    occupe.push({ kind: "appointment", start_time: c.heure, end_time: fin, label: c.nom_cliente });
    if (!fiche && !nouvelles.has(telephone)) {
      nouvelles.add(telephone);
      a.clientesCreees++;
    }
    // Même règle que l'import des clientes : la fiche garde son nom, la ligne est signalée.
    if (fiche && c.nom_cliente && !nomsProches(fiche.name, c.nom_cliente)) a.avertissements.push({ ligne: numero, motif: "import.nom_different", valeurs: { fichier: c.nom_cliente, fiche: fiche.name } });
    a.ajouts++;
    a.operations.push({
      date: c.date, debut: c.heure, fin, staffId: s.trouve.id, serviceId: p.trouve.id, prix: p.trouve.price, duree: p.trouve.duration,
      cliente: fiche ? { id: fiche.id } : { cle: telephone, telephone: `+${telephone}`, nom: c.nom_cliente },
      notes: c.notes,
    });
  }
  return a;
}

/**
 * Écrit les rendez-vous dans la transaction de l'appelant : fiches des clientes inconnues (une par numéro,
 * au nom de sa première ligne), numéro APT tiré dans la transaction, rendez-vous confirmé et sa prestation
 * au prix et à la durée du catalogue. Aucun message n'est mis en file.
 */
export function ecrireRendezVous(db: Database, operations: OperationRendezVous[], maintenant: number): void {
  const creees = new Map<string, number>();
  const creerCliente = db.prepare("INSERT INTO clients (name, phone) VALUES (?, ?)");
  const ajouter = db.prepare(
    `INSERT INTO appointments (identifier, client_id, staff_id, status, scheduled_date, start_time, end_time, total_price, notes, booked_at)
     VALUES (?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?)`,
  );
  const ajouterPrestation = db.prepare("INSERT INTO appointment_services (appointment_id, service_id, price, duration) VALUES (?, ?, ?, ?)");
  for (const op of operations) {
    let clientId: number;
    if ("id" in op.cliente) clientId = op.cliente.id;
    else {
      clientId = creees.get(op.cliente.cle) ?? Number(creerCliente.run(op.cliente.nom, op.cliente.telephone).lastInsertRowid);
      creees.set(op.cliente.cle, clientId);
    }
    const r = ajouter.run(takeIdentifier(db), clientId, op.staffId, op.date, op.debut, op.fin, op.prix, op.notes, maintenant);
    ajouterPrestation.run(Number(r.lastInsertRowid), op.serviceId, op.prix, op.duree);
  }
}
