/**
 * Règles de l'écran « Demandes en ligne » (spec du 16/10/2026 § 4.5), sans dépendance au navigateur :
 * actions permises selon l'état, libellés, délai depuis l'arrivée, saisie des fenêtres et corps envoyés.
 */
import { translate, translatePlural, type Key, type Lang } from "../i18n/translate.ts";
import type { DemandeEnLigne, EtatDemande } from "../types.ts";
import { groupPhone } from "./whatsapp.ts";

export type Action = "confirmer" | "autre_horaire" | "refuser" | "appeler" | "clore" | "rendez_vous";
export type ActionDialogue = Exclude<Action, "appeler">;
export type ModeFiche = "trouvee" | "autre" | "nouvelle";
export const MOTIFS = ["complet", "prestation_indisponible", "autre"] as const;
export type Motif = (typeof MOTIFS)[number];
export const ISSUES_RAPPEL = ["injoignable", "rdv_pris", "sans_suite"] as const;
export type IssueRappel = (typeof ISSUES_RAPPEL)[number];
export type Saisie = { service: string; staff: string; date: string; heure: string; fiche: ModeFiche | null; autreClient: string; motif: Motif; message: string; issue: IssueRappel };

/** Fin de l'adresse de chaque action : `POST /api/demandes-en-ligne/{id}/{chemin}`. */
export const CHEMINS: Record<ActionDialogue, string> = {
  confirmer: "confirmer", autre_horaire: "autre-horaire", refuser: "refuser", clore: "clore", rendez_vous: "rendez-vous",
};

export function actionsDe(etat: EtatDemande): Action[] {
  switch (etat) {
    case "a_confirmer": return ["confirmer", "autre_horaire", "refuser"];
    case "en_conflit": return ["autre_horaire", "refuser"];
    case "a_rappeler": return ["appeler", "clore"];
    case "autre_horaire": return ["rendez_vous"];
    default: return [];
  }
}

/** « il y a 5 min », « il y a 3 h », « il y a 2 jours » ; « à l'instant » sous une minute (ou si l'appareil retarde). */
export function delaiDepuis(recueLe: number, maintenant: number, lang: Lang): string {
  const minutes = Math.floor((maintenant - recueLe) / 60_000);
  if (minutes < 1) return translate(lang, "demandes.delai.instant");
  if (minutes < 60) return translatePlural(lang, "demandes.delai.minutes", minutes);
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return translatePlural(lang, "demandes.delai.heures", heures);
  return translatePlural(lang, "demandes.delai.jours", Math.floor(heures / 24));
}

const ETATS: Record<EtatDemande, Key> = {
  a_confirmer: "demandes.etat.a_confirmer", en_conflit: "demandes.etat.en_conflit", a_rappeler: "demandes.etat.a_rappeler",
  confirmee: "demandes.etat.confirmee", autre_horaire: "demandes.etat.autre_horaire", refusee: "demandes.etat.refusee", traitee: "demandes.etat.traitee",
};

export function libelleEtat(etat: EtatDemande, lang: Lang): string {
  return translate(lang, ETATS[etat]);
}

/** Issue d'une demande de rappel close (« Injoignable », « Rendez-vous pris », « Sans suite ») ; `null` pour toute autre demande. */
export function issueDe(d: Pick<DemandeEnLigne, "type" | "etat" | "motif">, lang: Lang): string | null {
  if (d.type !== "rappel" || d.etat !== "traitee" || !(ISSUES_RAPPEL as readonly string[]).includes(d.motif)) return null;
  return translate(lang, `demandes.issue.${d.motif as IssueRappel}`);
}

/** Téléphone de la cliente (E.164) groupé comme ailleurs dans lama : « +237 677 11 22 33 ». */
export function telephoneLisible(telephone: string): string {
  return groupPhone(telephone.replace(/^\+/, ""));
}

/** Résultat de la recherche de fiche (« Cliente connue : … », « Nouvelle cliente », « Même numéro, nom différent : à vérifier »). */
export function libelleFiche(d: Pick<DemandeEnLigne, "fiche" | "client_nom">, lang: Lang): string {
  if (d.fiche === "connue") return translate(lang, "demandes.fiche.connue", { nom: d.client_nom ?? "" });
  if (d.fiche === "a_verifier") return translate(lang, "demandes.fiche.a_verifier", { nom: d.client_nom ?? "" });
  return translate(lang, "demandes.fiche.nouvelle");
}

/** Nom de la prestation dans la langue de l'écran ; une prestation supprimée depuis reste nommée par son identifiant. */
export function prestationDe(d: Pick<DemandeEnLigne, "prestation_nom" | "prestation_nom_en" | "prestation_ref">, lang: Lang): string {
  return (lang === "en" && d.prestation_nom_en) || d.prestation_nom || translate(lang, "demandes.prestation_retiree", { ref: d.prestation_ref });
}

export function praticienneDemandee(d: Pick<DemandeEnLigne, "sans_preference" | "staff_demande_nom">, lang: Lang): string {
  if (d.sans_preference) return translate(lang, "demandes.sans_preference");
  return d.staff_demande_nom ?? translate(lang, "demandes.praticienne_inconnue");
}

/** Souhait d'une demande de rappel : jours, moments, précision. */
export function libelleSouhait(s: { jours: string[]; moments: string[]; precision: string }, lang: Lang): string {
  const jour = (j: string) => {
    const nom = translate(lang, `jour.${j}` as Key);
    return lang === "fr" ? nom.toLocaleLowerCase("fr-FR") : nom;
  };
  const tous = translate(lang, "demandes.souhait_tous");
  const jours = s.jours.length ? s.jours.map(jour).join(", ") : tous;
  const moments = s.moments.length ? s.moments.map((m) => translate(lang, `demandes.moment.${m}` as Key)).join(", ") : tous;
  const base = translate(lang, "demandes.souhait", { jours, moments });
  return s.precision.trim() ? `${base} ${translate(lang, "demandes.souhait_precision", { precision: s.precision.trim() })}` : base;
}

/** Fiche proposée à l'ouverture d'une fenêtre : la fiche connue, ou une nouvelle ; « à vérifier » : aucune, la réception choisit. */
export function ficheParDefaut(d: Pick<DemandeEnLigne, "fiche" | "client_id">): ModeFiche | null {
  if (d.fiche === "connue" && d.client_id !== null) return "trouvee";
  if (d.fiche === "nouvelle") return "nouvelle";
  return null;
}

export const avecHoraire = (action: ActionDialogue, issue: IssueRappel) => action === "autre_horaire" || action === "rendez_vous" || (action === "clore" && issue === "rdv_pris");
/** La prestation se choisit quand un rendez-vous est créé ; elle reprend celle de la demande (vide si elle a été supprimée depuis). */
export const avecService = (action: ActionDialogue, issue: IssueRappel) => action === "rendez_vous" || (action === "clore" && issue === "rdv_pris");
export const avecFiche = (action: ActionDialogue, issue: IssueRappel) => action === "confirmer" || action === "rendez_vous" || (action === "clore" && issue === "rdv_pris");

/** Saisie préremplie : praticienne retenue (ou demandée), horaire de la demande (ou l'horaire proposé quand la cliente l'accepte). */
export function saisieInitiale(d: DemandeEnLigne, action: ActionDialogue): Saisie {
  const accepte = action === "rendez_vous";
  const staff = (accepte ? d.autre_staff_id : d.staff_id) ?? d.staff_demande_id;
  return {
    service: d.service_id === null ? "" : String(d.service_id),
    staff: staff === null ? "" : String(staff),
    date: (accepte ? d.autre_date : d.date) ?? "",
    heure: (accepte ? d.autre_heure : d.start_time) ?? "",
    fiche: ficheParDefaut(d), autreClient: "", motif: "complet", message: "", issue: "injoignable",
  };
}

export function saisiePrete(action: ActionDialogue, s: Saisie): boolean {
  const ficheOk = !avecFiche(action, s.issue) || (s.fiche !== null && (s.fiche !== "autre" || s.autreClient !== ""));
  const horaireOk = !avecHoraire(action, s.issue) || (s.date !== "" && s.heure !== "" && s.staff !== "");
  const serviceOk = !avecService(action, s.issue) || s.service !== "";
  return ficheOk && horaireOk && serviceOk && (action !== "confirmer" || s.staff !== "");
}

/**
 * Praticiennes de la liste d'une fenêtre : celles qui pratiquent la prestation (`staff_services`), plus
 * celle déjà choisie ; toute l'équipe quand la réception le demande (« Toute l'équipe ») ou quand la prestation est
 * inconnue (supprimée depuis, ou pas encore choisie). `masquees` : combien la liste en laisse de côté.
 */
export function praticiennesProposees<T extends { id: number; service_ids: number[] }>(staff: T[], serviceId: string | number | null, choisie: string, toute: boolean): { liste: T[]; masquees: number } {
  const id = serviceId === null || serviceId === "" ? null : Number(serviceId);
  if (toute || id === null) return { liste: staff, masquees: 0 };
  const liste = staff.filter((s) => s.service_ids.includes(id) || String(s.id) === choisie);
  return { liste, masquees: staff.length - liste.length };
}

const fiche = (s: Saisie) => (s.fiche === "autre" ? { mode: "autre", client_id: Number(s.autreClient) } : { mode: s.fiche });

/** Corps de la requête de l'action ; `forcer` : passer outre un chevauchement (confirmation et rendez-vous seulement). */
export function corpsAction(action: ActionDialogue, s: Saisie, forcer: boolean): Record<string, unknown> {
  const passer = forcer ? { allow_conflict: true } : {};
  const horaire = { date: s.date, heure: s.heure, staff_id: Number(s.staff) };
  const rendezVous = { ...horaire, ...(s.service ? { service_id: Number(s.service) } : {}), fiche: fiche(s), ...passer };
  switch (action) {
    case "confirmer": return { staff_id: Number(s.staff), fiche: fiche(s), ...passer };
    case "autre_horaire": return horaire;
    case "rendez_vous": return rendezVous;
    case "refuser": return { motif: s.motif, ...(s.message.trim() ? { message: s.message.trim() } : {}) };
    case "clore": return s.issue === "rdv_pris" ? { issue: s.issue, rendez_vous: rendezVous } : { issue: s.issue };
  }
}
