/**
 * Automate de confirmation avant une action destructive (sous-projet 4 § 3.4,
 * `BoutonDestructif`). Module pur, sans DOM ni JSX, pour rester testable en
 * exécution : le premier appui demande confirmation sans agir, la
 * confirmation déclenche l'action une seule fois puis revient au repos,
 * l'annulation revient au repos sans jamais déclencher l'action.
 */
export type EtatConfirmation = "repos" | "confirmation";

export interface ResultatConfirmation {
  etat: EtatConfirmation;
  declenche: boolean;
}

/** Premier appui sur le bouton destructif : passe en demande de confirmation, n'agit jamais. */
export function appuyer(etat: EtatConfirmation): ResultatConfirmation {
  return { etat: "confirmation", declenche: false };
}

/** Confirmation : ne déclenche l'action que si une demande était bien en cours, puis revient au repos. */
export function confirmer(etat: EtatConfirmation): ResultatConfirmation {
  return etat === "confirmation" ? { etat: "repos", declenche: true } : { etat: "repos", declenche: false };
}

/** Annulation : revient au repos sans jamais déclencher l'action. */
export function annuler(_etat: EtatConfirmation): ResultatConfirmation {
  return { etat: "repos", declenche: false };
}

/**
 * Relecture (tour 1) : à l'entrée en confirmation, le bouton destructif
 * disparaît sans que le focus suive ; à l'annulation (ou à Échap), il ne
 * revient pas non plus. `cibleFocus` calcule où le poser après une
 * transition, à partir de l'état avant/après et de `declenche` (déjà rendu
 * par `appuyer`/`confirmer`/`annuler` ci-dessus) : « annuler » (choix sûr, pas
 * l'action destructive elle-même) à l'entrée en confirmation, « declencheur »
 * (le bouton d'origine, ex. « Supprimer ») après une annulation ; rien après
 * une confirmation qui a agi, l'élément ayant pu disparaître de l'écran.
 */
export type CibleFocus = "annuler" | "declencheur" | null;

export function cibleFocus(avant: EtatConfirmation, apres: EtatConfirmation, declenche: boolean): CibleFocus {
  if (avant === "repos" && apres === "confirmation") return "annuler";
  if (avant === "confirmation" && apres === "repos" && !declenche) return "declencheur";
  return null;
}
