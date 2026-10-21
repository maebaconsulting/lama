/**
 * WhatsApp Business à l'écran de l'administrateur (spec du 21/10/2026, W-9 à W-14) : formes rendues par
 * `/api/whatsapp/meta/*`, libellés et règle des noms de modèles. Fonctions pures, essayées sous Node.
 */
import { translate, type Key, type Lang } from "../i18n/translate.ts";
import type { WhatsappText } from "./whatsapp.ts";

export type TemplateKind = WhatsappText["kind"];
export type StatutModele = "approuve" | "en_attente" | "refuse" | "absent" | "non_verifie";
export type CategorieMeta = "utilitaire" | "marketing";
export type EnteteMeta = "aucun" | "document" | "image";
export interface DepotMeta { nom: string; categorie: CategorieMeta; entete: EnteteMeta; langue: Lang; corps: string; exemples: string[] }
export interface LigneModele {
  kind: TemplateKind; categorie: CategorieMeta; entete: EnteteMeta; nom: string; nom_defaut: string;
  statut: Record<Lang, StatutModele>; depot: Record<Lang, DepotMeta>;
}
export interface ModelesMeta { verifie_le: number | null; modeles: LigneModele[] }
export interface ConnexionMeta { numero: string; nom: string; qualite: string }

/** Guide pas à pas du technicien, section « WhatsApp Business », sur le dépôt public de lama. */
export const GUIDE_META: Record<Lang, string> = {
  fr: "https://github.com/maebaconsulting/lama/blob/main/deploy/LISEZMOI.md#whatsapp-business",
  en: "https://github.com/maebaconsulting/lama/blob/main/deploy/README.md#whatsapp-business",
};

/** Nom de modèle accepté par Meta : minuscules, chiffres, `_`. */
export const NOM_META = /^[a-z0-9_]{1,512}$/;

/** Nom refusé par Meta ; un nom vide est permis (le message part alors en échec « Modèle sans nom »). */
export function nomInvalide(nom: string): boolean {
  return nom !== "" && !NOM_META.test(nom);
}

/** Noms à enregistrer (`whatsapp.meta.noms`) : tous les noms, saisis ou actuels ; `null` sans changement ou avec un nom invalide. */
export function nomsAEnregistrer(lignes: LigneModele[], saisis: Partial<Record<TemplateKind, string>>): Partial<Record<TemplateKind, string>> | null {
  const noms: Partial<Record<TemplateKind, string>> = {};
  let change = false;
  for (const l of lignes) {
    const nom = (saisis[l.kind] ?? l.nom).trim();
    if (nomInvalide(nom)) return null;
    if (nom !== l.nom) change = true;
    noms[l.kind] = nom;
  }
  return change ? noms : null;
}

export function statutTexte(statut: StatutModele, lang: Lang): string {
  return translate(lang, `whatsapp.meta.statut.${statut}` as Key);
}

export function categorieTexte(categorie: CategorieMeta, lang: Lang): string {
  return translate(lang, `whatsapp.meta.categorie.${categorie}` as Key);
}

export function enteteTexte(entete: EnteteMeta, lang: Lang): string {
  return translate(lang, `whatsapp.meta.entete.${entete}` as Key);
}

export function typeTexte(kind: TemplateKind, lang: Lang): string {
  return translate(lang, `whatsapp.meta.type.${kind}` as Key);
}

const QUALITES: Record<string, Key> = { GREEN: "whatsapp.meta.qualite.elevee", YELLOW: "whatsapp.meta.qualite.moyenne", RED: "whatsapp.meta.qualite.faible" };

/** « Connexion établie » (W-11) : numéro affiché par Meta, nom vérifié de l'entreprise, note de qualité. */
export function connexionTexte(c: ConnexionMeta, lang: Lang): string {
  return translate(lang, "whatsapp.meta.connexion_ok", {
    numero: c.numero,
    nom: c.nom || translate(lang, "whatsapp.meta.nom_absent"),
    qualite: translate(lang, QUALITES[c.qualite] ?? "whatsapp.meta.qualite.inconnue"),
  });
}

/** Variable numérotée de Meta : `{{1}}` pour le rang 0. */
export function numeroVariable(rang: number): string {
  return `{{${rang + 1}}}`;
}
