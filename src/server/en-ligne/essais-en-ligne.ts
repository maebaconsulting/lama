/**
 * Données d'essai de la réservation en ligne, partagées par les essais de lama (comme test-support.ts) :
 * jamais importé par le code livré.
 */
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../migrations.ts";
import { registerFunctions, type Database } from "../storage.ts";
import { SEMAINE_DEFAUT } from "../../shared/horaires.ts";
import { TEXTE_DONNEES } from "../../shared/en-ligne.ts";
import type { MessageSettings } from "../whatsapp/rendez-vous.ts";
import { DEFAULT_TEXTS } from "../whatsapp/textes.ts";
import type { ConfigEnLigne } from "./config.ts";

let suite = 0;

/**
 * Insère une demande en ligne et rend son identifiant. Par défaut : créneau à confirmer, prestation 1
 * (Soin visage) avec la praticienne 1, mardi 29/09/2026 de 10:00 à 11:00, déjà accusée.
 */
export function insererDemande(db: Database, champs: Record<string, string | number | null> = {}): number {
  const valeurs: Record<string, string | number | null> = {
    contrat_id: `d_essai_${++suite}`, type: "creneau", service_id: 1, prestation_ref: "s1", prestation_nom: "Soin visage", prestation_nom_en: "Facial",
    staff_demande_id: 1, sans_preference: 0, staff_id: 1, date: "2026-09-29", start_time: "10:00", end_time: "11:00",
    cliente_nom: "Mireille Ngo", cliente_telephone: "+237699000111", cliente_langue: "fr", note: "", souhait: null,
    client_id: null, fiche: "nouvelle", etat: "a_confirmer", recue_le: 1, enregistree_le: 1, accusee_le: 1, ...champs,
  };
  const cles = Object.keys(valeurs);
  const r = db.prepare(`INSERT INTO demandes_en_ligne (${cles.join(", ")}) VALUES (${cles.map(() => "?").join(", ")})`).run(...cles.map((k) => valeurs[k]));
  return Number(r.lastInsertRowid);
}

/**
 * Base d'essai migrée : « Soin visage » (1, 60 min) et « Pose de vernis » (2, 30 min) ouvertes en ligne,
 * « Coiffure » (3) fermée ; Awa (1) et Bella (2) ouvertes en ligne, Carine (3) fermée ; Bella ne pratique pas
 * la pose de vernis. Une cliente, Aïcha (1).
 */
export function baseEssai(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  registerFunctions(db);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  db.exec(`INSERT INTO services (id, name, name_en, category, category_en, duration, price, en_ligne) VALUES
      (1, 'Soin visage', 'Facial', 'Visage', 'Face', 60, 25000, 1),
      (2, 'Pose de vernis', 'Nail polish', 'Mains', 'Hands', 30, 10000, 1),
      (3, 'Coiffure', 'Hair styling', 'Cheveux', 'Hair', 45, 15000, 0);
    INSERT INTO staff (id, name, color, en_ligne) VALUES (1, 'Awa Ndiaye', '#4A5D73', 1), (2, 'Bella Ewane', '#4F6552', 1), (3, 'Carine Mbia', '#6B4660', 0);
    DELETE FROM staff_services WHERE staff_id = 2 AND service_id = 2;
    INSERT INTO clients (id, name, phone) VALUES (1, 'Aïcha Mbarga', '699 12 34 56');`);
  return db;
}

/** Réglages d'essai : réservation en ligne activée, liaison réglée, institut de Douala ouvert du lundi au samedi de 09:00 à 19:00. */
export const CONFIG_ESSAI: ConfigEnLigne = {
  active: true, adresse: "https://relais.exemple", salon: "eclat", cle: "c".repeat(64), horizonJours: 30, delaiHeures: 2, theme: null, affichage: { entete: true, largeur: "colonne" },
  texteDonnees: TEXTE_DONNEES,
  institut: { nom: "Institut Éclat", telephone: "699 00 00 00", indicatif: "237", horaires: SEMAINE_DEFAUT },
};

/** Réglages des messages d'essai : textes par défaut, institut de Douala, silence de 21:00 à 08:00. */
export function reglagesMessages(): MessageSettings {
  return {
    lang: "fr", institut: "Institut Éclat", telephone: "699 00 00 00", indicatif: "237",
    silenceStart: "21:00", silenceEnd: "08:00", reminderHours: 24, texts: structuredClone(DEFAULT_TEXTS),
  };
}
