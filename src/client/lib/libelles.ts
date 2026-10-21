/**
 * Libellés des Réglages et du journal (spec 2B, rejoints aux dictionnaires,
 * spec § 4.1) : chaque fonction reçoit la langue de l'écran. Le serveur ne
 * stocke que des codes (actions du journal, états) ; l'écran les traduit.
 */
import type { OutboxItem } from "./api-types.ts";
import type { Account } from "./auth-types.ts";
import { translate, translatePlural, type Key, type Lang } from "../i18n/translate.ts";
import { formatInstant, formatInstantTime } from "./format.ts";

/** Date et heure à l'institut (fuseau Africa/Douala), ou « jamais ». */
export function dateHeure(ms: number | null, lang: Lang): string {
  return ms ? formatInstant(ms, lang) : translate(lang, "commun.jamais");
}

/** Dernière copie réussie d'une sauvegarde, ou constat qu'aucune n'a encore réussi. */
export function derniereCopie(ms: number | null, lang: Lang): string {
  return ms ? translate(lang, "sauvegarde.derniere_copie", { date: dateHeure(ms, lang) }) : translate(lang, "sauvegarde.aucune_copie");
}

/** Bandeau affiché quand le serveur n'a plus internet (spec 2 § 5). */
export function offlineText(pending: number, lang: Lang): string {
  return pending === 0 ? translate(lang, "file.hors_ligne_vide") : translatePlural(lang, "file.hors_ligne", pending);
}

const OUTBOX_STATUS_KEYS: Record<OutboxItem["status"], Key> = {
  pending: "file.statut.pending",
  sending: "file.statut.sending",
  sent: "file.statut.sent",
  failed: "file.statut.failed",
};

/** État d'un envoi ; un sort donné à la main (WhatsApp) prime : « Envoyé à la main » ou « Ignoré ». */
export function outboxStatus(status: OutboxItem["status"], lang: Lang, manual: OutboxItem["manual"] = ""): string {
  if (manual) return translate(lang, manual === "sent" ? "file.manuel.sent" : "file.manuel.ignored");
  return translate(lang, OUTBOX_STATUS_KEYS[status]);
}

const OUTBOX_TYPE_KEYS: Record<string, Key> = {
  "sauvegarde.drive": "file.type.sauvegarde_drive",
  whatsapp: "file.type.whatsapp",
};

/** Type d'un envoi ; un type inconnu est rendu tel quel. */
export function outboxType(kind: string, lang: Lang): string {
  const key = OUTBOX_TYPE_KEYS[kind];
  return key ? translate(lang, key) : kind;
}

const AUDIT_ACTIONS = [
  "installation", "connexion", "connexion.poste", "connexion.echec", "connexion.blocage", "deconnexion", "confirmation",
  "compte.creation", "compte.modification", "compte.deblocage", "compte.secret", "poste.declaration", "poste.revocation",
  "reglage", "reglage.devise", "envoi.relance", "sauvegarde", "restauration", "facture.emise", "facture.remise_plafond", "avoir.emis", "caisse.cloture", "acompte.encaisse", "acompte.rembourse", "acompte.garde",
  "whatsapp.session", "whatsapp.manuel", "whatsapp.libre", "whatsapp.document", "whatsapp.produit", "campagne.envoyee", "impression.duplicata", "tiroir.ouverture",
  "sms.essai", "cliente.canal_sms", "logo.depot", "logo.retrait",
  "produit.photo_depot", "produit.photo_retrait", "fidelite.correction", "rdv.transfert",
  "rdv.suppression", "rdv.note_suppression", "cliente.suppression", "membre.suppression", "prestation.suppression", "prestation.prix", "catalogue.import", "import.clientes", "import.produits", "import.rendez_vous",
  "creneau.suppression", "produit.suppression", "produit.prix", "produit.stock", "heure.reglee", "heure.refus",
  "en_ligne.confirmation", "en_ligne.autre_horaire", "en_ligne.refus", "en_ligne.cloture", "en_ligne.rendez_vous",
  "supplement.libre",
  "mise_a_jour.demandee", "mise_a_jour.reussie", "mise_a_jour.echec", "mise_a_jour.mode",
];

/** Action du journal (code stocké par le serveur) ; un code inconnu est rendu tel quel. */
export function auditAction(action: string, lang: Lang): string {
  return AUDIT_ACTIONS.includes(action) ? translate(lang, `journal.action.${action}` as Key) : action;
}

/** Cibles que le serveur écrit en français dans le journal (spec 2A) ; toute autre cible est une donnée, gardée. */
const AUDIT_TARGET_KEYS: Record<string, Key> = {
  "(identifiant inconnu)": "journal.cible.inconnu",
  "ligne de commande": "journal.cible.cli",
  // Session WhatsApp (action « whatsapp.session ») : le serveur écrit la commande.
  demarrage: "journal.cible.whatsapp_demarrage",
  deconnexion: "journal.cible.whatsapp_deconnexion",
  // Réglages modifiés (action « reglage ») : le serveur écrit la clé du réglage.
  "institut.nom": "journal.cible.institut_nom",
  "institut.adresse": "journal.cible.institut_adresse",
  "institut.telephone": "journal.cible.institut_telephone",
  "institut.langue": "journal.cible.institut_langue",
  "institut.horaires": "journal.cible.institut_horaires",
  "institut.devise": "journal.cible.institut_devise",
  "affichage.symbole_position": "journal.cible.symbole_position",
  "affichage.symbole_ecran": "journal.cible.symbole_ecran",
  "marque.ecran": "journal.cible.marque_ecran",
  "marque.documents": "journal.cible.marque_documents",
  "caisse.imprimer_logo": "journal.cible.imprimer_logo",
  "postes.verrouillage_minutes": "journal.cible.verrouillage",
  "technique.drive_remote": "journal.cible.drive_remote",
  "technique.test_internet_url": "journal.cible.test_internet",
  "whatsapp.jeton_acces": "journal.cible.jeton_whatsapp",
  "institut.niu": "journal.cible.institut_niu",
  "institut.rccm": "journal.cible.institut_rccm",
  "caisse.tva_active": "journal.cible.tva_active",
  "caisse.tva_taux": "journal.cible.tva_taux",
  "caisse.remises": "journal.cible.remises",
  "caisse.remise_plafond": "journal.cible.remise_plafond",
  "caisse.pourboires": "journal.cible.pourboires",
  "caisse.prefixe": "journal.cible.prefixe",
  "caisse.acomptes": "journal.cible.acomptes",
  "caisse.avoirs_reception": "journal.cible.avoirs_reception",
  "caisse.encaissement_praticienne": "journal.cible.encaissement_praticienne",
  "caisse.moyens": "journal.cible.moyens",
  "caisse.imprimante": "journal.cible.imprimante",
  "caisse.mentions_fr": "journal.cible.mentions_fr",
  "caisse.mentions_en": "journal.cible.mentions_en",
  "crm.active": "journal.cible.crm_active",
  "fidelite.active": "journal.cible.fidelite_active",
  "fidelite.tranche": "journal.cible.fidelite_tranche",
  "fidelite.points": "journal.cible.fidelite_points",
  "fidelite.paliers": "journal.cible.fidelite_paliers",
  "whatsapp.fournisseur": "journal.cible.whatsapp_fournisseur",
  "sms.fournisseur": "journal.cible.sms_fournisseur",
  "sms.adresse": "journal.cible.sms_adresse",
  "sms.identifiant": "journal.cible.sms_identifiant",
  "sms.mot_de_passe": "journal.cible.sms_mot_de_passe",
  "sms.delai_rendez_vous_minutes": "journal.cible.sms_delai_rendez_vous_minutes",
  "sms.delai_libre_minutes": "journal.cible.sms_delai_libre_minutes",
  "relances.anniversaire": "journal.cible.relances_anniversaire",
  "relances.absence": "journal.cible.relances_absence",
  "relances.absence_jours": "journal.cible.relances_absence_jours",
  "relances.heure": "journal.cible.relances_heure",
  "en_ligne.active": "journal.cible.en_ligne_active",
  "en_ligne.horizon_jours": "journal.cible.en_ligne_horizon",
  "en_ligne.delai_minimal_heures": "journal.cible.en_ligne_delai",
  "en_ligne.texte_donnees.fr": "journal.cible.en_ligne_texte_fr",
  "en_ligne.texte_donnees.en": "journal.cible.en_ligne_texte_en",
  "en_ligne.adresse": "journal.cible.en_ligne_adresse",
  "en_ligne.theme": "journal.cible.en_ligne_theme",
  "en_ligne.entete": "journal.cible.en_ligne_entete",
  "en_ligne.largeur": "journal.cible.en_ligne_largeur",
  "en_ligne.salon": "journal.cible.en_ligne_salon",
  "en_ligne.cle": "journal.cible.en_ligne_cle",
  // Mode de mise à jour : nom du réglage (règle de reglages-cadre.test.ts), puis le mode écrit par l'action « mise_a_jour.mode ».
  "mise_a_jour.mode": "journal.cible.mise_a_jour_mode",
  manuel: "journal.cible.mise_a_jour_manuel",
  automatique: "journal.cible.mise_a_jour_automatique",
  "waha.adresse": "journal.cible.waha_adresse",
  "waha.cle": "journal.cible.waha_cle",
  "waha.session": "journal.cible.waha_session",
  "whatsapp.indicatif": "journal.cible.whatsapp_indicatif",
  "whatsapp.rappel_heures": "journal.cible.whatsapp_rappel_heures",
  "whatsapp.silence_debut": "journal.cible.whatsapp_silence_debut",
  "whatsapp.silence_fin": "journal.cible.whatsapp_silence_fin",
  "whatsapp.texte.confirmation.fr": "journal.cible.whatsapp_texte_confirmation_fr",
  "whatsapp.texte.confirmation.en": "journal.cible.whatsapp_texte_confirmation_en",
  "whatsapp.texte.rappel.fr": "journal.cible.whatsapp_texte_rappel_fr",
  "whatsapp.texte.rappel.en": "journal.cible.whatsapp_texte_rappel_en",
  "whatsapp.texte.produit.fr": "journal.cible.whatsapp_texte_produit_fr",
  "whatsapp.texte.produit.en": "journal.cible.whatsapp_texte_produit_en",
  "whatsapp.texte.anniversaire.fr": "journal.cible.whatsapp_texte_anniversaire_fr",
  "whatsapp.texte.anniversaire.en": "journal.cible.whatsapp_texte_anniversaire_en",
  "whatsapp.texte.absence.fr": "journal.cible.whatsapp_texte_absence_fr",
  "whatsapp.texte.absence.en": "journal.cible.whatsapp_texte_absence_en",
  "whatsapp.texte.campagne.fr": "journal.cible.whatsapp_texte_campagne_fr",
  "whatsapp.texte.campagne.en": "journal.cible.whatsapp_texte_campagne_en",
  "whatsapp.texte.transfert.fr": "journal.cible.whatsapp_texte_transfert_fr",
  "whatsapp.texte.transfert.en": "journal.cible.whatsapp_texte_transfert_en",
  "whatsapp.texte.en_ligne_confirmation.fr": "journal.cible.whatsapp_texte_en_ligne_confirmation_fr",
  "whatsapp.texte.en_ligne_confirmation.en": "journal.cible.whatsapp_texte_en_ligne_confirmation_en",
  "whatsapp.texte.en_ligne_autre_horaire.fr": "journal.cible.whatsapp_texte_en_ligne_autre_horaire_fr",
  "whatsapp.texte.en_ligne_autre_horaire.en": "journal.cible.whatsapp_texte_en_ligne_autre_horaire_en",
  "whatsapp.texte.en_ligne_refus.fr": "journal.cible.whatsapp_texte_en_ligne_refus_fr",
  "whatsapp.texte.en_ligne_refus.en": "journal.cible.whatsapp_texte_en_ligne_refus_en",
  "whatsapp.texte.en_ligne_rappel.fr": "journal.cible.whatsapp_texte_en_ligne_rappel_fr",
  "whatsapp.texte.en_ligne_rappel.en": "journal.cible.whatsapp_texte_en_ligne_rappel_en",
};

export function auditTarget(target: string, lang: Lang): string {
  const key = AUDIT_TARGET_KEYS[target];
  return key ? translate(lang, key) : target;
}

/** État d'un compte, et s'il faut l'écrire à l'encre rouge (désactivé ou bloqué). */
export function etatCompte(a: Account, now: number, lang: Lang): { text: string; alert: boolean } {
  if (!a.active) return { text: translate(lang, "compte.etat.desactive"), alert: true };
  if (a.locked_until && a.locked_until > now) {
    return { text: translate(lang, "compte.etat.bloque", { heure: formatInstantTime(a.locked_until, lang) }), alert: true };
  }
  return { text: translate(lang, "compte.etat.actif"), alert: false };
}

const DESTINATION_KEYS: Record<"usb" | "drive", Key> = { usb: "sauvegarde.destination.usb", drive: "sauvegarde.destination.drive" };

export function destinationLabel(destination: "usb" | "drive", lang: Lang): string {
  return translate(lang, DESTINATION_KEYS[destination]);
}

const BACKUP_STATUS_KEYS: Record<"ok" | "failed" | "pending", Key> = {
  ok: "sauvegarde.statut.ok",
  failed: "sauvegarde.statut.failed",
  pending: "sauvegarde.statut.pending",
};

export function backupStatus(status: "ok" | "failed" | "pending", lang: Lang): string {
  return translate(lang, BACKUP_STATUS_KEYS[status]);
}

/**
 * Texte du résultat de « Sauvegarder maintenant » : dit la vérité sur Drive
 * (non réglé : pas d'envoi) et, sans Drive et sans USB, qu'aucune copie n'est gardée.
 */
export function backupRunText(r: { usb: "ok" | "failed"; drive: "pending" | "none" }, lang: Lang): string {
  const ok = r.usb === "ok";
  if (r.drive === "none") return translate(lang, ok ? "sauvegarde.resultat.ok_sans_drive" : "sauvegarde.resultat.echec_sans_drive");
  return translate(lang, ok ? "sauvegarde.resultat.ok" : "sauvegarde.resultat.echec");
}
