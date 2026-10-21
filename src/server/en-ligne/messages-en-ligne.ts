import type { Database } from "../storage.ts";
import type { Lang } from "../messages.ts";
import { enqueueSync } from "../outbox/outbox.ts";
import { WHATSAPP_KIND, type WhatsappMessage } from "../whatsapp/envoi.ts";
import { normalizePhone, silenceEnd } from "../whatsapp/numeros.ts";
import type { MessageSettings } from "../whatsapp/rendez-vous.ts";
import { FORME_NOM_LAMA } from "./identite.ts";
import { firstName, formatDay, renderTemplate, type TemplateKind, type ValeursModele } from "../whatsapp/textes.ts";

/**
 * Messages à la cliente d'une demande en ligne (spec du 16/10/2026 § 4.5) : ils passent par la file
 * existante (WhatsApp, SMS à défaut, ou « à envoyer à la main »), dans la langue de la cliente, jamais
 * pendant la fenêtre de silence (premier essai à sa fin). Écrits dans la transaction de la décision.
 */
export type GenreMessage = Extract<TemplateKind, "en_ligne_confirmation" | "en_ligne_autre_horaire" | "en_ligne_refus" | "en_ligne_rappel">;
/** Ce que dit le message : horaire (confirmé, proposé ou refusé), praticienne et prestation dans les deux langues. */
export type Sujet = { date: string | null; heure: string | null; praticienne: string; prestation: { fr: string; en: string } };
export type Destinataire = { id: number; cliente_prenom: string | null; cliente_nom: string; cliente_telephone: string; cliente_langue: "fr" | "en"; client_id: number | null };
/** À qui parle le message : le prénom donné par la cliente (relais récent), ou aucun ; jamais deviné dans le nom. */
export type Personne = { prenom: string | null; nom: string };
/** Le nom vient d'un formulaire public : hors de la forme d'un nom, `{nom}` reste vide dans le message. */
export const personneDe = (d: Pick<Destinataire, "cliente_prenom" | "cliente_nom">): Personne => ({ prenom: d.cliente_prenom, nom: FORME_NOM_LAMA.test(d.cliente_nom) ? d.cliente_nom : "" });

/**
 * Sans prénom, `{prenom}` disparaît avec l'espace qui le précède : « Bonjour, votre rendez-vous… », jamais « Bonjour , ».
 * En tête, la ponctuation et les espaces restants partent aussi, et la première lettre passe en majuscule.
 */
export function sansPrenom(modele: string): string {
  const texte = modele.replace(/[ \t]*\{prenom\}/g, "").replace(/^[\s\u00a0,;:!?.-]+/, "");
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

/** Accusé d'une demande de rappel dont la prestation est inconnue ou retirée : « pour votre demande », jamais « pour . ». */
const REPLI_PRESTATION: Record<Lang, string> = { fr: "votre demande", en: "your request" };

/** Valeurs nommées du message (W-2) : prénom donné par la cliente ou vide (Meta le remplace), prestation, horaire, praticienne. */
export function valeursMessage(s: MessageSettings, genre: GenreMessage, lang: Lang, qui: Personne, sujet: Sujet): ValeursModele {
  return {
    prenom: (qui.prenom ?? "").trim(), nom: qui.nom.trim(), institut: s.institut, telephone: s.telephone,
    prestation: sujet.prestation[lang] || sujet.prestation.fr || (genre === "en_ligne_rappel" ? REPLI_PRESTATION[lang] : ""),
    date: sujet.date ? formatDay(sujet.date, lang) : "", heure: sujet.heure ?? "", praticienne: firstName(sujet.praticienne),
  };
}

export function texteMessage(s: MessageSettings, genre: GenreMessage, lang: Lang, qui: Personne, sujet: Sujet): string {
  const valeurs = valeursMessage(s, genre, lang, qui, sujet);
  const modele = s.texts[genre][lang];
  return renderTemplate(valeurs.prenom ? modele : sansPrenom(modele), valeurs);
}

const avecAjout = (texte: string, ajout: string) => (ajout.trim() ? `${texte} ${ajout.trim()}` : texte);

/** Le même message dans les deux langues : champ `message` de la décision, montré par la page de suivi. */
export function messageBilingue(s: MessageSettings, genre: GenreMessage, qui: Personne, sujet: Sujet, ajout = ""): { fr: string; en: string } {
  return { fr: avecAjout(texteMessage(s, genre, "fr", qui, sujet), ajout), en: avecAjout(texteMessage(s, genre, "en", qui, sujet), ajout) };
}

/** Inscrit le message dans la file ; vrai s'il a été inscrit (faux : fiche liée en canal « Aucun », ou déjà inscrit) (une clé par demande, par nature et par instant). */
export function inscrireMessage(db: Database, s: MessageSettings, genre: GenreMessage, d: Destinataire, sujet: Sujet, maintenant: number, ajout = ""): boolean {
  // Fiche liée dont le canal est « Aucun » : rien n'est écrit, comme pour un message de rendez-vous.
  if (d.client_id !== null && (db.prepare("SELECT channel FROM clients WHERE id = ?").get(d.client_id) as { channel: string } | undefined)?.channel === "none") return false;
  const lang = d.cliente_langue;
  const qui = personneDe(d);
  const message: WhatsappMessage = {
    to: normalizePhone(d.cliente_telephone, s.indicatif) ?? "",
    lang,
    text: avecAjout(texteMessage(s, genre, lang, qui, sujet), ajout),
    // Le message ajouté par la réception reste dans le texte (WAHA, SMS) et sur la page de suivi ; le modèle de Meta n'en a pas.
    modele: genre,
    valeurs: valeursMessage(s, genre, lang, qui, sujet),
    origin: { type: "en_ligne", demandeId: d.id, ...(d.client_id !== null ? { clientId: d.client_id } : {}) },
  };
  const silence = silenceEnd(maintenant, s.silenceStart, s.silenceEnd);
  return enqueueSync(db, { kind: WHATSAPP_KIND, payload: message, dedupeKey: `wa:en_ligne:${genre}:${d.id}:${maintenant}`, now: maintenant, notBefore: silence ?? undefined }).created;
}
