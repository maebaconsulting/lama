/**
 * Consultation du serveur des versions (spec du 21/10/2026, M-12) : l'API de GitHub, sans compte,
 * une fois par jour et sur « Vérifier maintenant » ; la dernière réponse est gardée en base pour
 * l'affichage. Le service root ne s'y fie jamais : il vérifie lui-même ce qu'il télécharge.
 */
import { coded } from "../messages.ts";
import type { Database, StorageBinding } from "../storage.ts";
import { ecrireBase, lireBase } from "./base.ts";
import { VERSION_PUBLIEE } from "./version.ts";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type VersionPubliee = { version: string; publiee_le: number | null; note_fr: string; note_en: string };
/** Réponse lue, ou erreur sous forme codée (`@mise_a_jour.…`), traduite à l'affichage. */
export type Consultation = { ok: true; publiee: VersionPubliee } | { ok: false; erreur: string };

export const DEPOT_DEFAUT = "maebaconsulting/lama";
/** Délai de réponse du serveur des versions. */
export const DELAI_MS = 10_000;
/** Une consultation par jour. */
export const JOUR_MS = 24 * 3_600_000;
/** Taille maximale de la réponse lue (octets). */
const CORPS_MAX = 1_000_000;
/** Longueur gardée de chaque partie de la note. */
const NOTE_MAX = 4000;

/** Lit le corps en comptant les octets ; null au-delà de la limite. */
async function lireCorps(r: Response): Promise<string | null> {
  const annonce = Number(r.headers.get("content-length"));
  if (Number.isFinite(annonce) && annonce > CORPS_MAX) return null;
  if (!r.body) return "";
  const lecteur = r.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.byteLength;
    if (total > CORPS_MAX) {
      void lecteur.cancel().catch(() => {});
      return null;
    }
    morceaux.push(value);
  }
  return Buffer.concat(morceaux).toString("utf-8");
}

export const sourceGithub = (depot: string) => `https://api.github.com/repos/${depot}/releases/latest`;

/** Note « Ce qui change » : le français, une ligne ---en---, l'anglais ; sans séparateur, le même texte dans les deux langues. */
export function separerNotes(texte: string): { fr: string; en: string } {
  const lignes = texte.replace(/\r\n/g, "\n").split("\n");
  const i = lignes.findIndex((l) => l.trim() === "---en---");
  const couper = (s: string) => [...s.trim()].slice(0, NOTE_MAX).join("");
  if (i === -1) {
    const tout = couper(lignes.join("\n"));
    return { fr: tout, en: tout };
  }
  return { fr: couper(lignes.slice(0, i).join("\n")), en: couper(lignes.slice(i + 1).join("\n")) };
}

/** Dépôt désigné par /etc/lama/mise-a-jour.conf (ligne DEPOT=propriétaire/nom, recette), même règle que le service root. */
export function depotConfigure(texte: string | null): string {
  for (const ligne of (texte ?? "").split("\n")) {
    const m = /^DEPOT=([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/.exec(ligne);
    if (m) return m[1];
  }
  return DEPOT_DEFAUT;
}

/** Adresse consultée : l'API de GitHub pour le dépôt ; LAMA_MISE_A_JOUR_SOURCE seulement en développement (faux serveur des versions). */
export function sourceDesVersions(env: Record<string, string | undefined>, dev: boolean, depot: string): string {
  const essai = env.LAMA_MISE_A_JOUR_SOURCE;
  return dev && essai && /^https?:\/\//.test(essai) ? essai : sourceGithub(depot);
}

/** Interroge le serveur des versions ; ne lève jamais (erreur codée). */
export async function consulter(o: { source: string; fetch?: Fetch; delai?: number }): Promise<Consultation> {
  const envoyer: Fetch = o.fetch ?? ((url, init) => fetch(url, init));
  const delai = o.delai ?? DELAI_MS;
  const invalide: Consultation = { ok: false, erreur: coded("mise_a_jour.reponse_invalide") };
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  // Le signal coupe un fetch réel ; la course couvre un fetch injecté qui l'ignore.
  const coupe = new Promise<never>((_, refuse) => { minuteur = setTimeout(() => refuse(new Error("délai dépassé")), delai); });
  try {
    const r = await Promise.race([envoyer(o.source, { headers: { accept: "application/vnd.github+json", "user-agent": "lama" }, signal: AbortSignal.timeout(delai) }), coupe]);
    if (r.status !== 200) return invalide;
    const texte = await Promise.race([lireCorps(r), coupe]);
    if (texte === null) return invalide;
    let json: unknown;
    try {
      json = JSON.parse(texte);
    } catch {
      return invalide;
    }
    const j = (json ?? {}) as { tag_name?: unknown; published_at?: unknown; body?: unknown; draft?: unknown; prerelease?: unknown };
    if (j.draft === true || j.prerelease === true) return invalide;
    const version = typeof j.tag_name === "string" && j.tag_name.startsWith("v") ? j.tag_name.slice(1) : "";
    if (!VERSION_PUBLIEE.test(version)) return invalide;
    const date = typeof j.published_at === "string" ? Date.parse(j.published_at) : Number.NaN;
    const notes = separerNotes(typeof j.body === "string" ? j.body : "");
    return { ok: true, publiee: { version, publiee_le: Number.isFinite(date) ? date : null, note_fr: notes.fr, note_en: notes.en } };
  } catch {
    return { ok: false, erreur: coded("mise_a_jour.injoignable") };
  } finally {
    clearTimeout(minuteur);
  }
}

/** Note la consultation : la version lue ; sur un échec, l'erreur, la dernière réponse restant gardée. */
export function noterConsultation(db: Database, maintenant: number, r: Consultation): void {
  if (r.ok) ecrireBase(db, { verifie_le: maintenant, version: r.publiee.version, publiee_le: r.publiee.publiee_le, note_fr: r.publiee.note_fr, note_en: r.publiee.note_en, erreur: null });
  else ecrireBase(db, { verifie_le: maintenant, erreur: r.erreur });
}

/** Consultation due : jamais faite, faite il y a un jour ou plus, ou heure reculée depuis (Review Focus 4). */
export function consultationDue(derniere: number | null, maintenant: number): boolean {
  return derniere === null || maintenant - derniere >= JOUR_MS || maintenant < derniere;
}

/** Consultation quotidienne : chaque heure, une consultation si elle est due. Rend l'arrêt. */
export function startConsultationQuotidienne(o: { storage: StorageBinding; source: string; fetch?: Fetch; maintenant: () => number; intervalleMs?: number }): () => void {
  let occupe = false;
  const lancer = async () => {
    if (occupe) return;
    occupe = true;
    try {
      const derniere = o.storage.transaction!((db) => lireBase(db)).verifie_le;
      if (!consultationDue(derniere, o.maintenant())) return;
      const r = await consulter({ source: o.source, fetch: o.fetch });
      o.storage.transaction!((db) => noterConsultation(db, o.maintenant(), r));
    } catch (e) {
      // Base fermée pendant l'arrêt, ou panne inattendue : jamais un rejet non capturé.
      console.error("Consultation des versions\u00a0:", e instanceof Error ? e.message : e);
    } finally {
      occupe = false;
    }
  };
  const horloge = setInterval(() => void lancer(), o.intervalleMs ?? 3_600_000);
  horloge.unref?.();
  void lancer();
  return () => clearInterval(horloge);
}
