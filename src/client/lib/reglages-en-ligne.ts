/** Règles de la rubrique « Réservation en ligne » (spec du 16/10/2026 § 4.6 et § 9.4), sans dépendance au navigateur. */
import type { Key, Lang } from "../i18n/translate.ts";
import { contraste, problemeTheme, type Police, type ProblemeTheme, type ThemeEnLigne } from "../../shared/en-ligne.ts";

/** Réglages de la gérante enregistrés par le premier formulaire. */
export const CLES_GERANTE = [
  "en_ligne.active", "en_ligne.horizon_jours", "en_ligne.delai_minimal_heures", "en_ligne.adresse", "en_ligne.texte_donnees.fr", "en_ligne.texte_donnees.en",
] as const;
const NOMBRES = new Set<string>(["en_ligne.horizon_jours", "en_ligne.delai_minimal_heures"]);

/** Valeur d'un champ du formulaire, telle que le serveur l'attend. */
export function valeurReglage(cle: string, texte: string): unknown {
  if (cle === "en_ligne.active") return texte === "true";
  return NOMBRES.has(cle) ? Number(texte) : texte.trim();
}

/** Thème proposé quand la gérante en active un : les couleurs de la charte de lama, ivoire et cuir. */
export const THEME_DEPART: ThemeEnLigne = { fond: "#F3EEE4", accent: "#161514", police: "lama" };

const PROBLEMES: Record<ProblemeTheme, Key> = {
  couleur: "en_ligne.theme.probleme_couleur", police: "en_ligne.theme.probleme_police",
  contraste_texte: "en_ligne.theme.probleme_texte", contraste_accent: "en_ligne.theme.probleme_accent",
};

/** Raison d'un refus du thème, la même que celle du serveur et du relais, avant tout envoi. */
export function problemeAffiche(t: ThemeEnLigne): Key | null {
  const p = problemeTheme(t);
  return p ? PROBLEMES[p] : null;
}

/** « Enregistrer » du thème : grisé pendant un envoi, et quand le thème choisi serait refusé (case décochée : retour à la charte, toujours possible). */
export function peutEnregistrerTheme(actif: boolean, t: ThemeEnLigne, occupe: boolean): boolean {
  return !occupe && (!actif || problemeAffiche(t) === null);
}

/** Rapport de contraste « 12,3:1 », arrondi vers le bas au dixième. */
export function rapport(a: string, b: string, lang: Lang): string {
  const r = Math.floor(contraste(a, b) * 10) / 10;
  return `${r.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}:1`;
}

/**
 * Polices de l'aperçu (titres et texte courant) : lama n'embarque pas Cinzel, l'aperçu s'en approche ; le rendu exact est
 * celui de la page du relais. Pas de champ `titre` : le détecteur de texte en dur le lirait comme un texte affiché.
 */
export const POLICES_APERCU: Record<Police, { grands: string; courant: string }> = {
  lama: { grands: '"Cormorant Garamond", Georgia, serif', courant: '"Jost", system-ui, sans-serif' },
  classique: { grands: '"EB Garamond", Georgia, serif', courant: '"Jost", system-ui, sans-serif' },
  elegante: { grands: '"Cinzel", "EB Garamond", Georgia, serif', courant: '"EB Garamond", Georgia, serif' },
  moderne: { grands: '"Jost", system-ui, sans-serif', courant: '"Jost", system-ui, sans-serif' },
};
