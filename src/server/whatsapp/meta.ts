/**
 * Fournisseur WhatsApp Business (API officielle de Meta, spec du 21/10/2026, W-1, W-5, W-16, W-17), sans
 * session liée. Message avec modèle : nom réglé (sinon par défaut), langue de la cliente ou l'autre langue
 * approuvée, valeurs dans l'ordre de la langue, fichier d'en-tête déposé chez Meta d'abord ; modèle connu
 * comme refusé ou absent, nom vide ou corps trop long : erreur définitive sans appel. Message sans modèle
 * (geste de l'équipe, message mis en file avant la mise à jour) : texte, document ou photo libres, que Meta
 * refuse hors de la fenêtre de 24 h ouverte par la cliente. La lecture (numéro, modèles) passe par
 * `lireNumero` et `lireModeles`, séparées de l'envoi (W-8).
 */
import { createHash } from "node:crypto";
import { estFormation } from "../formation/mode.ts";
import { coded } from "../messages.ts";
import { PermanentError, TemporaryError } from "../outbox/outbox.ts";
import { getSetting } from "../settings.ts";
import type { ProviderStatus, SendReceipt, WhatsappProvider } from "./fournisseur.ts";
import { deposerMedia, envoyerMessage, lireModeles, lireNumero, metaBase, type GraphOptions, type NumeroMeta } from "./meta-api.ts";
import { choisirLangue, corpsRendu, LIMITE_CORPS, nomModele, parametres, type EtatsModeles, type ModeleLu, type NomsModeles } from "./modeles-meta.ts";

export interface MetaOptions {
  numero: string;
  compte: string;
  jeton: string;
  noms: NomsModeles | null;
  etats: EtatsModeles | null;
  base?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export type MetaProvider = Required<WhatsappProvider> & {
  readonly compte: string;
  /** Identifiant du numéro et jeton présents. */
  readonly complet: boolean;
  lireNumero(): Promise<NumeroMeta>;
  lireModeles(): Promise<ModeleLu[]>;
};

/** État « connecté » gardé cinq minutes : les écrans demandent l'état chaque minute, Meta limite les lectures. */
const ETAT_MS = 5 * 60_000;
const etatsGardes = new Map<string, { jusqua: number; etat: ProviderStatus }>();

/** Oublie les états gardés (« Tester la connexion », essais). */
export function oublierEtatsMeta(): void {
  etatsGardes.clear();
}

export function createMeta(opts: MetaOptions): MetaProvider {
  const graph: GraphOptions = { jeton: opts.jeton, base: opts.base, fetch: opts.fetch, timeoutMs: opts.timeoutMs };
  const complet = Boolean(opts.numero && opts.jeton);
  // Clé de l'état gardé : jamais le jeton lui-même, seulement son empreinte.
  const cle = `${opts.base ?? ""}|${opts.numero}|${createHash("sha256").update(opts.jeton).digest("hex").slice(0, 16)}`;
  const pret = (compte = false) => {
    if (!complet || (compte && !opts.compte)) throw new PermanentError(coded("whatsapp.meta_incomplet"));
  };

  async function libre(to: string, message: Record<string, unknown>): Promise<SendReceipt> {
    pret();
    return { id: await envoyerMessage(graph, opts.numero, { to, ...message }) };
  }

  return {
    compte: opts.compte,
    complet,

    async status() {
      if (!complet) return { state: "erreur" };
      const garde = etatsGardes.get(cle);
      if (garde && garde.jusqua > Date.now()) return garde.etat;
      try {
        const lu = await lireNumero(graph, opts.numero);
        const etat: ProviderStatus = { state: "connecte", phone: lu.numero.replace(/\D/g, "") };
        etatsGardes.set(cle, { jusqua: Date.now() + ETAT_MS, etat });
        return etat;
      } catch (error) {
        return { state: error instanceof TemporaryError && error.message === coded("whatsapp.meta_injoignable") ? "injoignable" : "erreur" };
      }
    },

    async lireNumero() {
      pret();
      return lireNumero(graph, opts.numero);
    },

    async lireModeles() {
      pret(true);
      return lireModeles(graph, opts.compte);
    },

    sendText(to, text) {
      return libre(to, { type: "text", text: { body: text, preview_url: false } });
    },

    async sendDocument(to, file, caption) {
      pret();
      const media = await deposerMedia(graph, opts.numero, file);
      return libre(to, { type: "document", document: { id: media, filename: file.name, ...(caption ? { caption } : {}) } });
    },

    async sendImage(to, file, caption) {
      pret();
      const media = await deposerMedia(graph, opts.numero, file);
      return libre(to, { type: "image", image: { id: media, ...(caption ? { caption } : {}) } });
    },

    async sendTemplate(to, message) {
      pret();
      const nom = nomModele(message.modele, opts.noms);
      if (!nom) throw new PermanentError(coded("whatsapp.meta_sans_nom"));
      const langue = choisirLangue(opts.etats, message.modele, nom, message.lang);
      if (!langue) throw new PermanentError(coded("whatsapp.meta_modele", { nom }));
      const valeurs = parametres(message.modele, langue.lang, message.valeurs);
      if (corpsRendu(message.modele, langue.lang, valeurs).length > LIMITE_CORPS) throw new PermanentError(coded("whatsapp.meta_trop_long"));
      const components: Record<string, unknown>[] = [];
      if (message.entete) {
        const media = await deposerMedia(graph, opts.numero, message.entete.file);
        const parametre = message.entete.type === "document"
          ? { type: "document", document: { id: media, filename: message.entete.file.name } }
          : { type: "image", image: { id: media } };
        components.push({ type: "header", parameters: [parametre] });
      }
      components.push({ type: "body", parameters: valeurs.map((text) => ({ type: "text", text })) });
      const id = await envoyerMessage(graph, opts.numero, { to, type: "template", template: { name: nom, language: { code: langue.code }, components } }, { modele: nom });
      return { id };
    },
  };
}

/** Fournisseur WhatsApp Business d'après les réglages, quel que soit le fournisseur choisi (test avant le choix) ; `null` en formation. */
export async function metaFromSettings(fetchImpl: typeof fetch = fetch): Promise<MetaProvider | null> {
  if (estFormation()) return null;
  return createMeta({
    numero: await getSetting<string>("whatsapp.meta.numero"),
    compte: await getSetting<string>("whatsapp.meta.compte"),
    jeton: (await getSetting<string | null>("whatsapp.jeton_acces")) ?? "",
    noms: await getSetting<NomsModeles | null>("whatsapp.meta.noms"),
    etats: await getSetting<EtatsModeles | null>("whatsapp.meta.etats"),
    base: metaBase(),
    fetch: fetchImpl,
  });
}
