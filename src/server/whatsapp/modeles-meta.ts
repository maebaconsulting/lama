/**
 * Modèles de messages de l'API officielle de Meta (WhatsApp Business, spec du 21/10/2026, W-3, W-4, W-13,
 * W-16) : un modèle par type de message de lama (nom par défaut modifiable, catégorie, en-tête, corps dans
 * les deux langues), numérotation `{{1}}`, `{{2}}`… calculée par langue dans l'ordre de première apparition,
 * valeurs mises en forme pour Meta, états lus chez Meta et choix de la langue d'envoi. Les corps reprennent
 * les textes par défaut de lama, sauf le produit et la campagne, adaptés aux règles de Meta (jamais de
 * variable au début ni à la fin, pas de variables côte à côte).
 */
import type { Lang } from "../messages.ts";
import { DEFAULT_TEXTS, TEMPLATE_KINDS, type TemplateKind, type ValeursModele, type VariableModele } from "./textes.ts";

export type CategorieMeta = "utilitaire" | "marketing";
export type EnteteMeta = "aucun" | "document" | "image";
export interface ModeleMeta { kind: TemplateKind; nom: string; categorie: CategorieMeta; entete: EnteteMeta; corps: Record<Lang, string> }

/** Copie des corps : une gérante qui change ses textes ne change jamais un modèle déposé chez Meta. */
const modele = (kind: TemplateKind, categorie: CategorieMeta, entete: EnteteMeta = "aucun", corps: Record<Lang, string> = DEFAULT_TEXTS[kind]): ModeleMeta =>
  ({ kind, nom: `lama_${kind}`, categorie, entete, corps: { fr: corps.fr, en: corps.en } });

export const MODELES_META: Record<TemplateKind, ModeleMeta> = {
  confirmation: modele("confirmation", "utilitaire"),
  rappel: modele("rappel", "utilitaire"),
  transfert: modele("transfert", "utilitaire"),
  ticket: modele("ticket", "utilitaire", "document"),
  en_ligne_confirmation: modele("en_ligne_confirmation", "utilitaire"),
  en_ligne_autre_horaire: modele("en_ligne_autre_horaire", "utilitaire"),
  en_ligne_refus: modele("en_ligne_refus", "utilitaire"),
  en_ligne_rappel: modele("en_ligne_rappel", "utilitaire"),
  // Le texte de lama commence par le prénom, ce que Meta refuse.
  produit: modele("produit", "marketing", "image", {
    fr: "Bonjour {prenom}, voici {produit} ({prix}), que nous vous recommandons chez {institut}.",
    en: "Hello {prenom}, here is {produit} ({prix}), which we recommend at {institut}.",
  }),
  anniversaire: modele("anniversaire", "marketing"),
  absence: modele("absence", "marketing"),
  // Le texte de la campagne, déjà rendu pour la cliente, prend place au milieu du corps.
  campagne: modele("campagne", "marketing", "aucun", {
    fr: "Message de {institut}\u00a0: {texte} À bientôt chez {institut}.",
    en: "Message from {institut}: {texte} See you soon at {institut}.",
  }),
};

/** Nom d'un modèle chez Meta : minuscules, chiffres et `_`. */
export const NOM_META = /^[a-z0-9_]{1,512}$/;
/** Longueur maximale du corps rendu d'un modèle chez Meta. */
export const LIMITE_CORPS = 1024;

export type NomsModeles = Partial<Record<TemplateKind, string>>;

/** Nom réglé par l'administrateur (`whatsapp.meta.noms`), sinon le nom par défaut ; un nom vide reste vide (W-16). */
export function nomModele(kind: TemplateKind, noms: NomsModeles | null): string {
  const nom = noms?.[kind];
  return typeof nom === "string" ? nom : MODELES_META[kind].nom;
}

/** Réglage `whatsapp.meta.noms` acceptable : types connus, nom valide pour Meta ou vide. */
export function nomsValides(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.entries(v as Record<string, unknown>).every(([kind, nom]) =>
    (TEMPLATE_KINDS as string[]).includes(kind) && typeof nom === "string" && (nom === "" || NOM_META.test(nom)));
}

/** Corps numéroté pour Meta et ordre des variables : première apparition, une variable répétée garde son numéro (W-3). */
export function numeroter(corps: string): { texte: string; ordre: VariableModele[] } {
  const ordre: VariableModele[] = [];
  const texte = corps.replace(/\{(\w+)\}/g, (_tout, nom: string) => {
    let rang = ordre.indexOf(nom as VariableModele);
    if (rang < 0) rang = ordre.push(nom as VariableModele) - 1;
    return `{{${rang + 1}}}`;
  });
  return { texte, ordre };
}

/** Règle de Meta pour une valeur : ni saut de ligne, ni tabulation, ni plus de quatre espaces de suite ; chacun devient une espace. */
export function nettoyerValeur(valeur: string): string {
  return valeur.replace(/[\r\n\t]/g, " ").replace(/ {5,}/g, " ").trim();
}

/** Meta refuse une valeur vide : prénom absent, rendez-vous sans prestation ni praticienne… La phrase reste lisible. */
const REPLIS: Record<Lang, Partial<Record<VariableModele, string>>> = {
  fr: { prenom: "chère cliente", praticienne: "notre équipe", prestation: "beauté" },
  en: { prenom: "dear client", praticienne: "our team", prestation: "beauty" },
};
const REPLI_AUTRE = "\u2013";

/** Valeurs envoyées à Meta, dans l'ordre du corps de cette langue, nettoyées, jamais vides. */
export function parametres(kind: TemplateKind, lang: Lang, valeurs: ValeursModele): string[] {
  return numeroter(MODELES_META[kind].corps[lang]).ordre.map((nom) => nettoyerValeur(valeurs[nom] ?? "") || (REPLIS[lang][nom] ?? REPLI_AUTRE));
}

/** Corps tel que la cliente le lira, pour la limite de longueur de Meta. */
export function corpsRendu(kind: TemplateKind, lang: Lang, params: string[]): string {
  return numeroter(MODELES_META[kind].corps[lang]).texte.replace(/\{\{(\d+)\}\}/g, (_tout, n: string) => params[Number(n) - 1] ?? "");
}

export type StatutModele = "approuve" | "en_attente" | "refuse" | "absent" | "non_verifie";
export interface LangueModele { statut: StatutModele; code: string }
export interface EtatModele { nom: string; langues: Partial<Record<Lang, LangueModele>> }
/** Réglage `whatsapp.meta.etats` : écrit par « Vérifier les modèles » (W-13). */
export interface EtatsModeles { verifieLe: number; modeles: Partial<Record<TemplateKind, EtatModele>> }
/** Modèle tel que Meta le décrit (`GET /{compte}/message_templates`). */
export interface ModeleLu { name: string; language: string; status: string; category?: string }

/** Statuts de Meta ; un statut inconnu compte comme refusé (rien n'est envoyé sur un modèle dont on ignore l'état). */
const STATUTS_META: Record<string, StatutModele> = {
  APPROVED: "approuve", PENDING: "en_attente", IN_APPEAL: "en_attente",
  REJECTED: "refuse", PAUSED: "refuse", DISABLED: "refuse", LIMIT_EXCEEDED: "refuse", ARCHIVED: "refuse", DELETED: "refuse", PENDING_DELETION: "refuse",
};
const RANG: Record<StatutModele, number> = { approuve: 3, en_attente: 2, refuse: 1, absent: 0, non_verifie: 0 };

/** États lus chez Meta pour les noms réglés : langue `fr` ou `en` (variantes `en_US` comprises), meilleur statut, code exact préféré. */
export function etatsDepuisMeta(lus: ModeleLu[], noms: NomsModeles | null, maintenant: number): EtatsModeles {
  const modeles: EtatsModeles["modeles"] = {};
  for (const kind of TEMPLATE_KINDS) {
    const nom = nomModele(kind, noms);
    const langues: EtatModele["langues"] = {};
    for (const lang of ["fr", "en"] as const) {
      let meilleur: LangueModele = { statut: "absent", code: lang };
      for (const lu of lus) {
        if (!nom || lu.name !== nom || lu.language.toLowerCase().split("_")[0] !== lang) continue;
        const statut = Object.hasOwn(STATUTS_META, lu.status) ? STATUTS_META[lu.status] : "refuse";
        const plusExact = RANG[statut] === RANG[meilleur.statut] && lu.language === lang;
        if (RANG[statut] > RANG[meilleur.statut] || plusExact) meilleur = { statut, code: lu.language };
      }
      langues[lang] = meilleur;
    }
    modeles[kind] = { nom, langues };
  }
  return { verifieLe: maintenant, modeles };
}

/** État d'un modèle dans une langue ; « non vérifié » sans vérification, ou si le nom a changé depuis (Review Focus 3). */
export function statutDe(etats: EtatsModeles | null, kind: TemplateKind, nom: string, lang: Lang): LangueModele {
  const etat = etats?.modeles[kind];
  if (!etat || etat.nom !== nom) return { statut: "non_verifie", code: lang };
  return etat.langues[lang] ?? { statut: "non_verifie", code: lang };
}

/**
 * Langue d'envoi (W-4, W-16) : celle de la cliente si son modèle est approuvé, sinon l'autre langue
 * approuvée, faute de mieux ; un modèle en attente ou non vérifié est tenté ; `null` : refusé ou absent.
 */
export function choisirLangue(etats: EtatsModeles | null, kind: TemplateKind, nom: string, lang: Lang): { lang: Lang; code: string } | null {
  const autre: Lang = lang === "fr" ? "en" : "fr";
  const propre = statutDe(etats, kind, nom, lang);
  const second = statutDe(etats, kind, nom, autre);
  if (propre.statut === "approuve") return { lang, code: propre.code };
  if (second.statut === "approuve") return { lang: autre, code: second.code };
  if (propre.statut === "en_attente" || propre.statut === "non_verifie") return { lang, code: propre.code };
  if (second.statut === "en_attente") return { lang: autre, code: second.code };
  return null;
}

/** Exemples demandés par Meta au dépôt d'un modèle, et valeurs du message d'essai (W-12, W-13). */
const EXEMPLES: Record<Lang, Record<VariableModele, string>> = {
  fr: {
    prenom: "Aïcha", nom: "Aïcha Mbarga", date: "vendredi 2 octobre", heure: "10:00", prestation: "Tresses", institut: "Institut",
    telephone: "699 00 00 00", document: "ticket F-2026-000012", produit: "Huile de coco", prix: "4\u202f500\u00a0FCFA", praticienne: "Brenda",
    texte: "Découvrez nos nouveaux soins du visage ce mois-ci.",
  },
  en: {
    prenom: "Aïcha", nom: "Aïcha Mbarga", date: "Friday 2 October", heure: "10:00", prestation: "Braids", institut: "Institut",
    telephone: "699 00 00 00", document: "receipt F-2026-000012", produit: "Coconut oil", prix: "4,500 FCFA", praticienne: "Brenda",
    texte: "Discover our new facials this month.",
  },
};

/** Exemples d'une langue, avec le nom et le téléphone de l'institut quand ils sont réglés. */
export function exemples(lang: Lang, institut: { nom: string; telephone: string }): Record<VariableModele, string> {
  return {
    ...EXEMPLES[lang],
    ...(institut.nom.trim() ? { institut: institut.nom.trim() } : {}),
    ...(institut.telephone.trim() ? { telephone: institut.telephone.trim() } : {}),
  };
}

export interface Depot { nom: string; categorie: CategorieMeta; entete: EnteteMeta; langue: Lang; corps: string; exemples: string[] }

/** « Voir le texte à déposer » (W-13) : ce que l'administrateur recopie dans l'espace Meta de l'institut. */
export function texteADeposer(kind: TemplateKind, lang: Lang, noms: NomsModeles | null, institut: { nom: string; telephone: string }): Depot {
  const m = MODELES_META[kind];
  const { texte, ordre } = numeroter(m.corps[lang]);
  const ex = exemples(lang, institut);
  return { nom: nomModele(kind, noms), categorie: m.categorie, entete: m.entete, langue: lang, corps: texte, exemples: ordre.map((v) => ex[v]) };
}
