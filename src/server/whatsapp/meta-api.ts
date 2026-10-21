/**
 * Client de l'API Graph de Meta pour WhatsApp Business (Cloud API, spec du 21/10/2026, W-1, W-6, W-8).
 * Version de l'API dans une seule constante. Jeton en en-tête `Authorization` seulement : jamais dans une
 * adresse, un motif d'échec ou le journal. L'envoi (`envoyerMessage`, `deposerMedia`) et la lecture
 * (`lireNumero`, `lireModeles`) sont séparés : une route de réception (signature de Meta, accusés,
 * réponses) s'ajoutera dans son propre module sans toucher à l'envoi (W-8).
 */
import { coded } from "../messages.ts";
import { PermanentError, TemporaryError } from "../outbox/outbox.ts";
import type { DocumentFile } from "./fournisseur.ts";
import type { ModeleLu } from "./modeles-meta.ts";

/** Version de l'API Graph : v26.0, stable courante au changelog de Meta (29/07/2026, relevé par la revue). */
export const GRAPH_VERSION = "v26.0";
export const GRAPH_BASE = "https://graph.facebook.com";

/** Adresse de l'API : Meta, ou le faux Meta local pour la vérification au navigateur (`LAMA_META_BASE`, 127.0.0.1 seulement). */
export function metaBase(env: Record<string, string | undefined> = process.env): string {
  const local = env.LAMA_META_BASE ?? "";
  return /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(local) ? local : GRAPH_BASE;
}

export interface GraphOptions { jeton: string; base?: string; fetch?: typeof fetch; timeoutMs?: number }

/** Délai de l'envoi lui-même, comme WAHA : viser « au moins une fois » plutôt que doubler un message sur une connexion lente. */
const ENVOI_TIMEOUT_MS = 45_000;
const LECTURE_TIMEOUT_MS = 15_000;
/** Liste des modèles : au plus 20 pages de 100. */
const PAGES_MAX = 20;

export type MotifMeta = "jeton" | "numero_absent" | "fenetre" | "modele" | "parametres" | "limite" | "erreur";

/**
 * Codes d'erreur de la Cloud API vers les classes de la file (W-6), relevés sur la page « Error codes » de
 * Meta et vérifiés à l'implémentation. Un code absent : le statut HTTP décide (401 et 403 jeton refusé, 429 limite, 5xx temporaire), définitif sinon.
 */
export const CODES_META: Record<number, { temporaire: boolean; motif: MotifMeta }> = {
  0: { temporaire: false, motif: "jeton" }, // jeton expiré ou invalidé
  190: { temporaire: false, motif: "jeton" }, // jeton refusé ou expiré
  10: { temporaire: false, motif: "jeton" }, // droit manquant
  200: { temporaire: false, motif: "jeton" }, // droit manquant
  131026: { temporaire: false, motif: "numero_absent" }, // non remis : numéro sans WhatsApp
  131047: { temporaire: false, motif: "fenetre" }, // plus de 24 h depuis le dernier message de la cliente
  132001: { temporaire: false, motif: "modele" }, // modèle absent dans cette langue
  132015: { temporaire: false, motif: "modele" }, // modèle en pause
  132016: { temporaire: false, motif: "modele" }, // modèle désactivé
  132000: { temporaire: false, motif: "parametres" }, // nombre de valeurs différent du modèle
  132005: { temporaire: false, motif: "parametres" }, // texte rendu trop long
  132007: { temporaire: false, motif: "parametres" }, // règle de mise en forme
  132012: { temporaire: false, motif: "parametres" }, // forme d'une valeur
  100: { temporaire: false, motif: "parametres" }, // paramètre invalide
  131008: { temporaire: false, motif: "parametres" }, // paramètre obligatoire absent
  131009: { temporaire: false, motif: "parametres" }, // valeur de paramètre invalide
  4: { temporaire: true, motif: "limite" }, // trop d'appels de l'application
  80007: { temporaire: true, motif: "limite" }, // limite du compte WhatsApp Business
  130429: { temporaire: true, motif: "limite" }, // débit de la Cloud API
  131048: { temporaire: true, motif: "limite" }, // limite anti-spam
  131056: { temporaire: true, motif: "limite" }, // limite par destinataire
  131000: { temporaire: true, motif: "erreur" }, // erreur inconnue de Meta
  131016: { temporaire: true, motif: "erreur" }, // service surchargé
  1: { temporaire: true, motif: "erreur" }, // erreur inconnue de l'API
  2: { temporaire: true, motif: "erreur" }, // service indisponible
  133004: { temporaire: true, motif: "erreur" }, // serveur temporairement indisponible
};

/** Motif codé d'un refus de Meta. */
function motif(m: MotifMeta, modele: string | undefined, code: number): string {
  switch (m) {
    case "jeton": return coded("whatsapp.meta_jeton");
    case "numero_absent": return coded("whatsapp.numero_absent");
    case "fenetre": return coded("whatsapp.meta_fenetre");
    case "modele": return coded("whatsapp.meta_modele", { nom: modele ?? "" });
    case "parametres": return coded("whatsapp.meta_parametres");
    case "limite": return coded("whatsapp.meta_limite");
    case "erreur": return coded("whatsapp.meta_erreur", { code });
  }
}

/**
 * Erreur classée d'une réponse refusée (W-6). `modele` : nom du modèle envoyé, cité dans le motif ;
 * `lecture` : lecture du numéro ou des modèles, où un code 100 dit un identifiant inconnu.
 */
export function classerErreur(r: { status: number; code: number | null }, contexte: { modele?: string; lecture?: boolean } = {}): TemporaryError | PermanentError {
  if (contexte.lecture && r.code === 100) return new PermanentError(coded("whatsapp.meta_identifiant"));
  const parStatut = r.status === 401 || r.status === 403 ? CODES_META[190] : r.status === 429 ? CODES_META[130429] : undefined;
  const connu = r.code !== null && Object.hasOwn(CODES_META, r.code) ? CODES_META[r.code] : parStatut;
  const code = r.code ?? r.status;
  if (!connu) return r.status >= 500 ? new TemporaryError(coded("whatsapp.meta_erreur", { code })) : new PermanentError(coded("whatsapp.meta_refus", { code }));
  const texte = motif(connu.motif, contexte.modele, code);
  return connu.temporaire ? new TemporaryError(texte) : new PermanentError(texte);
}

/** Appel à l'API ; réseau coupé ou délai dépassé : Meta injoignable (temporaire) ; réponse refusée : classée. */
export async function appel(opts: GraphOptions, method: "GET" | "POST", chemin: string, corps: FormData | Record<string, unknown> | undefined, timeoutMs: number, contexte: { modele?: string; lecture?: boolean }): Promise<Record<string, unknown>> {
  const base = (opts.base ?? GRAPH_BASE).replace(/\/+$/, "");
  // Le jeton ne part que vers l'adresse de l'API : toute autre adresse absolue est refusée sans requête.
  if (/^[a-z][a-z0-9+.-]*:/i.test(chemin) && !chemin.startsWith(`${base}/`)) throw new PermanentError(coded("whatsapp.meta_reponse"));
  const adresse = chemin.startsWith(`${base}/`) ? chemin : `${base}/${GRAPH_VERSION}${chemin}`;
  const json = corps !== undefined && !(corps instanceof FormData);
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(adresse, {
      method,
      headers: { authorization: `Bearer ${opts.jeton}`, accept: "application/json", ...(json ? { "content-type": "application/json" } : {}) },
      body: corps === undefined ? undefined : corps instanceof FormData ? corps : JSON.stringify(corps),
      redirect: "error",
      signal: AbortSignal.timeout(opts.timeoutMs ?? timeoutMs),
    });
  } catch {
    throw new TemporaryError(coded("whatsapp.meta_injoignable"));
  }
  const lu = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const erreur = lu?.error as { code?: unknown } | undefined;
    throw classerErreur({ status: res.status, code: typeof erreur?.code === "number" ? erreur.code : null }, contexte);
  }
  return lu && typeof lu === "object" ? lu : {};
}

/** Envoi d'un message (texte, document, image ou modèle) ; rend l'identifiant `wamid`, vide si Meta n'en rend pas. */
export async function envoyerMessage(opts: GraphOptions, numero: string, message: Record<string, unknown>, contexte: { modele?: string } = {}): Promise<string> {
  const lu = await appel(opts, "POST", `/${encodeURIComponent(numero)}/messages`, { messaging_product: "whatsapp", recipient_type: "individual", ...message }, ENVOI_TIMEOUT_MS, contexte);
  const premier = Array.isArray(lu.messages) ? (lu.messages[0] as { id?: unknown } | undefined) : undefined;
  return typeof premier?.id === "string" ? premier.id : "";
}

/** Dépôt d'un fichier chez Meta (`/media`, multipart) avant son envoi ; rend l'identifiant du fichier. */
export async function deposerMedia(opts: GraphOptions, numero: string, file: DocumentFile): Promise<string> {
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", file.mime);
  form.set("file", new Blob([new Uint8Array(file.data)], { type: file.mime }), file.name);
  const lu = await appel(opts, "POST", `/${encodeURIComponent(numero)}/media`, form, ENVOI_TIMEOUT_MS, {});
  if (typeof lu.id !== "string" || !lu.id) throw new TemporaryError(coded("whatsapp.meta_reponse"));
  return lu.id;
}

export interface NumeroMeta { numero: string; nom: string; qualite: string }

/** Numéro de l'institut chez Meta (W-11) : numéro affiché, nom vérifié de l'entreprise, note de qualité. */
export async function lireNumero(opts: GraphOptions, numero: string): Promise<NumeroMeta> {
  const lu = await appel(opts, "GET", `/${encodeURIComponent(numero)}?fields=display_phone_number,verified_name,quality_rating`, undefined, LECTURE_TIMEOUT_MS, { lecture: true });
  if (typeof lu.display_phone_number !== "string") throw new TemporaryError(coded("whatsapp.meta_reponse"));
  return {
    numero: lu.display_phone_number,
    nom: typeof lu.verified_name === "string" ? lu.verified_name : "",
    qualite: typeof lu.quality_rating === "string" ? lu.quality_rating : "UNKNOWN",
  };
}

/** Modèles du compte WhatsApp Business (W-13), toutes pages ; une page suivante n'est suivie que sur l'adresse de l'API. */
export async function lireModeles(opts: GraphOptions, compte: string): Promise<ModeleLu[]> {
  const base = (opts.base ?? GRAPH_BASE).replace(/\/+$/, "");
  const lus: ModeleLu[] = [];
  let adresse: string | null = `/${encodeURIComponent(compte)}/message_templates?fields=name,language,status,category&limit=100`;
  for (let page = 0; adresse && page < PAGES_MAX; page++) {
    const lu = await appel(opts, "GET", adresse, undefined, LECTURE_TIMEOUT_MS, { lecture: true });
    if (!Array.isArray(lu.data)) throw new TemporaryError(coded("whatsapp.meta_reponse"));
    for (const m of lu.data as Record<string, unknown>[]) {
      if (typeof m?.name !== "string" || typeof m.language !== "string" || typeof m.status !== "string") continue;
      lus.push({ name: m.name, language: m.language, status: m.status, ...(typeof m.category === "string" ? { category: m.category } : {}) });
    }
    const suivante = (lu.paging as { next?: unknown } | undefined)?.next;
    adresse = typeof suivante === "string" && suivante.startsWith(`${base}/`) ? suivante : null;
  }
  return lus;
}
