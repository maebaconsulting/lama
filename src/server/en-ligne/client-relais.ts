import { signerAppel } from "./signature.ts";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReponseRelais = { statut: number; json: any };
/** Écarts voulus par l'outil de vérification : horodatage, clé ou salon faux. */
export type OptionsAppel = { horodatage?: number; cle?: string; institut?: string };

/** Pas de réponse du relais dans le délai : l'appel est abandonné (jamais d'attente sans fin). */
export class ErreurDelai extends Error {}

export const DELAI_MS = 15_000;

/**
 * Dernier horodatage signé pour une adresse, un salon et une clé, partagé par tous les clients du processus
 * (boucle d'échange, « Tester la liaison », vérificateur) : le relais n'accepte une signature qu'une fois.
 */
const derniers = new Map<string, number>();

/**
 * Client du contrat v1 : lama appelle toujours, chaque appel est signé. `chemin` est relatif au préfixe
 * `/lama/v1` (`"/etat"`, `"/demandes?apres=…"`). Réponse illisible : `json` vaut `null`.
 * Le relais n'accepte une signature qu'une fois et l'horodatage est en millisecondes : sans horodatage explicite,
 * il est strictement croissant pour cette adresse, ce salon et cette clé, quel que soit le client du processus, et chaque nouvel essai est signé à nouveau.
 */
export function clientRelais(o: { adresse: string; institut: string; cle: string; fetch?: Fetch; maintenant?: () => number; delai?: number }) {
  const delai = o.delai ?? DELAI_MS;
  const base = new URL(o.adresse.endsWith("/") ? o.adresse : `${o.adresse}/`);
  const envoyer: Fetch = o.fetch ?? ((url, init) => fetch(url, init));
  const maintenant = o.maintenant ?? Date.now;
  return {
    async appeler(methode: "GET" | "PUT" | "POST", chemin: string, corps?: unknown, opt: OptionsAppel = {}): Promise<ReponseRelais> {
      const url = new URL(`lama/v1${chemin}`, base);
      const texte = corps === undefined ? "" : JSON.stringify(corps);
      // Compteur du client tel qu'il est réglé (adresse, salon, clé), même pour un appel volontairement faux : un appel
      // re-signé avec la bonne clé ne retombe jamais sur l'horodatage d'un appel déjà fait (il serait refusé comme rejeu).
      const ref = `${base.href}\n${o.institut}\n${o.cle}`;
      let h: number;
      if (opt.horodatage !== undefined) h = opt.horodatage;
      else {
        h = Math.max(maintenant(), (derniers.get(ref) ?? 0) + 1);
        derniers.set(ref, h);
      }
      const horodatage = String(h);
      // Le signal coupe un fetch réel ; la course couvre un fetch injecté qui l'ignore.
      let minuteur: ReturnType<typeof setTimeout> | undefined;
      const coupe = new Promise<never>((_, refuse) => { minuteur = setTimeout(() => refuse(new ErreurDelai()), delai); });
      let brut: string;
      let statutHttp: number;
      try {
        const r = await Promise.race([envoyer(url.toString(), {
        method: methode,
        headers: {
          "content-type": "application/json",
          "x-lama-institut": opt.institut ?? o.institut,
          "x-lama-horodatage": horodatage,
          "x-lama-signature": signerAppel(opt.cle ?? o.cle, horodatage, methode, url.pathname + url.search, texte),
        },
        body: texte === "" ? undefined : texte,
        signal: AbortSignal.timeout(delai),
      }), coupe]);
        statutHttp = r.status;
        brut = await Promise.race([r.text(), coupe]);
      } catch (e) {
        if (e instanceof ErreurDelai || (e instanceof Error && e.name === "TimeoutError")) throw new ErreurDelai();
        throw e;
      } finally {
        clearTimeout(minuteur);
      }
      let json: unknown = null;
      try {
        json = brut ? JSON.parse(brut) : null;
      } catch {
        json = null;
      }
      return { statut: statutHttp, json };
    },
  };
}
