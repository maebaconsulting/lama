import { MOTIF_SALON, SALONS_RESERVES } from "../noyau/motifs.ts";
import type { CleTexte, Lang } from "./textes.ts";

/** Logique pure du parcours de la cliente (spec § 3) : formats, téléphone, langue, enchaînement des étapes. */

export type Texte = { fr: string; en: string };
export type Devise = { code: string; decimales: number; symbole: string; position: "avant" | "apres" };
export type Prestation = { id: string; nom: Texte; categorie: Texte; description: Texte; duree: number; prix: number };
export type Praticienne = { id: string; prenom: string; photo: string | null; prestations: string[] };
export type Institut = { nom: string; telephone: string; logo: string | null; devise: Devise; langues: Lang[]; texte_donnees: Texte };
export type Vitrine = {
  etat: "ferme" | "rappel" | "ouvert"; institut: Institut | null; prestations: Prestation[]; praticiennes: Praticienne[];
  aujourdhui: string | null; du: string | null; au: string | null; turnstile: string | null;
};
export type Creneau = { heure: string; praticiennes: string[] };
export type Resume = { jours: string[]; prochains: { date: string; heure: string }[] };
export type EtatSuivi = "en_attente" | "confirmee" | "autre_horaire" | "refusee" | "traitee";
/** Issue d'un rappel clos, donnée par lama (ajout du 18/10/2026) ; absente d'un relais ou d'un lama plus ancien. */
export type IssueSuivi = "rdv_pris" | "injoignable" | "sans_suite";
export type Suivi = {
  type: "creneau" | "rappel"; prestation: Texte; date: string | null; heure: string | null;
  souhait: { jours: string[]; moments: string[]; precision: string } | null; etat: EtatSuivi;
  horaire: { date: string; heure: string; praticienne: string } | null; message: Texte | null; issue?: IssueSuivi | null;
};
export type Etape = "prestation" | "horaire" | "coordonnees" | "recu" | "rappel" | "rappel_recu" | "sans_salon";

/** Prestations groupées par catégorie, dans l'ordre de l'offre. */
export function parCategorie(prestations: Prestation[], lang: Lang): { categorie: string; prestations: Prestation[] }[] {
  const groupes = new Map<string, Prestation[]>();
  for (const p of prestations) {
    const c = p.categorie[lang] || p.categorie.fr;
    groupes.set(c, [...(groupes.get(c) ?? []), p]);
  }
  return [...groupes].map(([categorie, liste]) => ({ categorie, prestations: liste }));
}

/** Montant en unités mineures, dans la devise publiée avec l'offre. */
export function formatPrix(montant: number, devise: Devise, lang: Lang): string {
  const valeur = new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", { minimumFractionDigits: devise.decimales, maximumFractionDigits: devise.decimales })
    .format(montant / 10 ** devise.decimales);
  return devise.position === "avant" ? `${devise.symbole}${valeur}` : `${valeur}\u00a0${devise.symbole}`;
}

export function formatDuree(minutes: number, _lang: Lang): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}\u00a0min`;
  return m ? `${h}\u00a0h\u00a0${String(m).padStart(2, "0")}` : `${h}\u00a0h`;
}

const locale = (lang: Lang) => (lang === "fr" ? "fr-FR" : "en-US");
/** Midi UTC : le libellé ne dépend pas du fuseau de l'appareil. */
const midi = (date: string) => new Date(`${date}T12:00:00Z`);

export function libelleDate(date: string, lang: Lang): { jour: string; numero: string; mois: string } {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(lang), { ...o, timeZone: "UTC" }).format(midi(date));
  return { jour: f({ weekday: "short" }), numero: f({ day: "numeric" }), mois: f({ month: "short" }) };
}

export function libelleDateLong(date: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(midi(date));
}

/** Premier jour du bandeau : aujourd'hui dans le fuseau de l'institut, ou le début des plages s'il est plus tard. */
export function premierJour(v: Pick<Vitrine, "aujourdhui" | "du">): string | null {
  if (!v.aujourdhui) return v.du;
  return v.du && v.du > v.aujourdhui ? v.du : v.aujourdhui;
}

/** Dates du bandeau, de `debut` à `fin` comprises, 62 au plus. */
export function joursAffiches(debut: string, fin: string): string[] {
  const out: string[] = [];
  const d = midi(debut);
  for (let jour = debut; jour <= fin && out.length < 62; jour = d.toISOString().slice(0, 10)) {
    out.push(jour);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Indicatifs reconnus, du plus long au plus court pour que +237 passe avant +23 ou +2. */
const INDICATIFS = ["+237", "+225", "+221", "+241", "+242", "+243", "+229", "+228", "+226", "+223", "+227", "+235", "+236", "+240", "+234", "+233", "+212", "+216", "+213", "+33", "+32", "+41", "+44", "+49", "+39", "+34", "+1"];

/** Indicatif du pays de l'institut, d'après son téléphone publié. */
export function indicatifDe(telephone: string): string | null {
  const brut = telephone.replace(/[^\d+]/g, "");
  return INDICATIFS.find((i) => brut.startsWith(i)) ?? null;
}

/** Longueur du numéro national (sans 0 de tête) pour les indicatifs dont elle est sûre ; les autres suivent la règle générale de 7 à 15 chiffres. */
const LONGUEURS: Record<string, number> = { "+237": 9, "+33": 9, "+221": 9, "+225": 10 };

/**
 * Numéro saisi par la cliente (espaces, points, tirets, 00 ou 0 en tête, indicatif tapé sans « + », « (0) » après l'indicatif) au format E.164, ou `null`.
 * Un indicatif d'institut absent de `INDICATIFS` n'est pas reconnu par `indicatifDe` : les numéros locaux sont alors refusés (la cliente ajoute « + » et l'indicatif).
 */
export function versE164(saisie: string, indicatif: string | null): string | null {
  const brut = saisie.replace(/[\s.\-()]/g, "");
  let n: string;
  if (/^\+\d+$/.test(brut)) n = brut;
  else if (/^00\d+$/.test(brut)) n = `+${brut.slice(2)}`;
  else if (/^\d+$/.test(brut) && indicatif) {
    // Indicatif tapé sans « + » : plus long qu'un numéro national (avec son 0), il est déjà international.
    const nationalMax = (LONGUEURS[indicatif] ?? 9) + 1;
    n = brut.startsWith(indicatif.slice(1)) && brut.length > nationalMax ? `+${brut}` : `${indicatif}${brut.replace(/^0/, "")}`;
  } else return null;
  const code = INDICATIFS.find((i) => n.startsWith(i));
  if (code) {
    n = `${code}${n.slice(code.length).replace(/^0/, "")}`;
    const longueur = LONGUEURS[code];
    if (longueur !== undefined && n.length - code.length !== longueur) return null;
  }
  return /^\+[1-9]\d{6,14}$/.test(n) ? n : null;
}

/** Langue de départ : `?lang=` de l'adresse, puis langue du navigateur, puis français (si l'institut le propose). */
export function langueInitiale(langues: Lang[], navigateur: string, parametre: string | null): Lang {
  if (parametre === "fr" || parametre === "en") {
    if (langues.includes(parametre)) return parametre;
  }
  const nav = navigateur.slice(0, 2).toLowerCase();
  if ((nav === "fr" || nav === "en") && langues.includes(nav)) return nav;
  return langues.includes("fr") ? "fr" : langues[0] ?? "fr";
}

/**
 * Prestation choisie d'avance par l'adresse de la page (`?prestation=s12`, posé par integrer.js depuis le bouton
 * « Réserver » d'un site), si l'offre la propose encore ; sinon `null`, et la cliente choisit dans la liste.
 */
export function prestationDepuisAdresse(recherche: string, prestations: Prestation[]): Prestation | null {
  const id = new URLSearchParams(recherche).get("prestation");
  return id ? prestations.find((p) => p.id === id) ?? null : null;
}

/**
 * Après le choix de l'heure, toujours les coordonnées : le filtre « Avec » a fixé la praticienne, ou la cliente
 * l'a laissé sur « Sans préférence » (lama retient la praticienne). Jamais de seconde question.
 */
export function apresHeure(filtre: string | null): { etape: "coordonnees"; praticienne: string | null } {
  return { etape: "coordonnees", praticienne: filtre };
}

/** Où ramener la cliente quand le serveur refuse l'envoi, et quoi lui dire. */
export function apresRefus(code: string): { etape: Etape; message: CleTexte } {
  switch (code) {
    case "indisponible": return { etape: "horaire", message: "refus.indisponible" };
    case "rappel_seulement": return { etape: "rappel", message: "refus.rappel_seulement" };
    case "ferme": return { etape: "prestation", message: "refus.ferme" };
    case "inconnue": return { etape: "prestation", message: "refus.inconnue" };
    case "introuvable": return { etape: "sans_salon", message: "page.sans_salon" };
    case "trop_de_demandes": return { etape: "coordonnees", message: "refus.trop_ip" };
    case "trop_de_demandes_telephone": return { etape: "coordonnees", message: "refus.trop" };
    case "verification": return { etape: "coordonnees", message: "refus.verification" };
    default: return { etape: "coordonnees", message: "refus.autre" };
  }
}

/** Le recours « Être rappelée » remplace le calendrier : plages trop anciennes, ou aucun jour libre. */
export function modeRappel(etat: Vitrine["etat"], jours: string[]): boolean {
  return etat === "rappel" || jours.length === 0;
}

/** Lien de la page de suivi : le jeton est dans l'ancre, jamais envoyé au serveur dans l'adresse. */
export function lienSuivi(page: string, jeton: string): string {
  return `${page.split("#")[0]}#suivi=${jeton}`;
}

export function jetonDepuisAncre(ancre: string): string | null {
  const m = /^#suivi=([A-Za-z0-9_-]+)$/.exec(ancre);
  return m ? m[1] : null;
}

/** Salon de la page, premier segment de l'adresse (`/eclat/` donne `eclat`), ou `null`. */
export function salonDepuisChemin(chemin: string): string | null {
  const segment = chemin.split("/")[1] ?? "";
  return MOTIF_SALON.test(segment) && !SALONS_RESERVES.includes(segment) ? segment : null;
}

/** Message de « Demande reçue » : « dès l'ouverture » quand l'institut est fermé à l'instant du dépôt (horaires publiés, spec § 9.2). */
export function texteRecu(rappel: boolean, horsHoraires: boolean): CleTexte {
  if (rappel) return horsHoraires ? "recu.rappel_ouverture" : "recu.rappel";
  return horsHoraires ? "recu.ouverture" : "recu.creneau";
}

/** Texte de l'état sur la page de suivi : un rappel clos « Sans suite » dit « close » ; tout autre état garde son texte. */
export function cleEtatSuivi(s: { etat: EtatSuivi; issue?: IssueSuivi | null }): CleTexte {
  if (s.etat === "traitee" && s.issue === "sans_suite") return "suivi.close";
  return `suivi.${s.etat}`;
}
