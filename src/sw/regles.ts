/**
 * Règles du service worker de lama (PWA, P-03), en fonctions pures : ce qui
 * est mis en cache, ce qui ne l'est jamais, quelle stratégie pour chaque
 * requête. Partagées par `sw.ts` (assemblé par esbuild dans `dist/sw.js`) et
 * par les essais sous Node ; aucune dépendance au navigateur.
 */

/** Préfixe des caches d'enveloppe : seuls ces caches sont supprimés quand une nouvelle version s'active. */
export const PREFIXE_CACHE = "lama-enveloppe-";

/** Message de l'écran au service worker en attente : « active-toi » (bandeau « Recharger », P-05). */
export const DEMANDE_ACTIVATION = { type: "lama-activer" } as const;

/**
 * `reseau` : le service worker laisse passer la requête sans y toucher ;
 * `navigation` : réseau d'abord, `index.html` du cache sans réseau ;
 * `cache-d-abord` : fichier de l'enveloppe, le cache puis le réseau.
 */
export type Strategie = "reseau" | "navigation" | "cache-d-abord";

/** Nom du cache d'une version : version de lama et empreinte de la fabrication. */
export function nomCache(version: string, empreinte: string): string {
  return `${PREFIXE_CACHE}${version}-${empreinte}`;
}

/**
 * Chemins jamais mis en cache ni servis par le cache : l'API (données,
 * photos de produits, logos de l'institut, PDF), la page du certificat et ses
 * fichiers, le manifeste (nom de l'institut à jour), le service worker
 * lui-même, et tout PDF.
 */
export function jamaisEnCache(chemin: string): boolean {
  return chemin === "/api" || chemin.startsWith("/api/")
    || chemin === "/certificat" || chemin.startsWith("/certificat/")
    || chemin === "/manifest.webmanifest"
    || chemin === "/sw.js"
    || /\.pdf$/i.test(chemin) || /\/pdf$/i.test(chemin);
}

/**
 * Stratégie pour une requête vue par le service worker. `origine` : celle de
 * lama ; `enveloppe` : chemins mis en cache à l'installation. Toute requête
 * autre que GET, d'une autre origine ou d'un chemin interdit passe au réseau.
 */
export function strategie(requete: { method: string; url: string; mode: string }, origine: string, enveloppe: ReadonlySet<string>): Strategie {
  if (requete.method !== "GET") return "reseau";
  let url: URL;
  try {
    url = new URL(requete.url);
  } catch {
    return "reseau";
  }
  if (url.origin !== origine || jamaisEnCache(url.pathname)) return "reseau";
  if (requete.mode === "navigate") return "navigation";
  if (url.search === "" && (enveloppe.has(url.pathname) || url.pathname.startsWith("/assets/"))) return "cache-d-abord";
  return "reseau";
}

/** Caches d'enveloppe d'anciennes versions, à supprimer à l'activation ; les autres caches ne sont jamais touchés. */
export function cachesPerimes(noms: readonly string[], actuel: string): string[] {
  return noms.filter((nom) => nom.startsWith(PREFIXE_CACHE) && nom !== actuel);
}

/** Vrai pour le message `DEMANDE_ACTIVATION` envoyé par l'écran, et lui seul. */
export function estDemandeActivation(donnee: unknown): boolean {
  return typeof donnee === "object" && donnee !== null && (donnee as { type?: unknown }).type === DEMANDE_ACTIVATION.type;
}

/** Entrée du manifeste de fabrication de Vite (`dist/.vite/manifest.json`). */
export interface EntreeVite {
  file: string;
  css?: string[];
  assets?: string[];
}

/**
 * Fichiers de l'enveloppe, tirés du manifeste de fabrication de Vite :
 * `index.html`, scripts, styles, polices `woff2` (les `woff`, que seuls de très
 * vieux navigateurs demandent, restent au réseau), images, plus les fichiers
 * statiques donnés (icônes). Chemins absolus, triés, sans doublon.
 */
export function fichiersEnveloppe(manifeste: Record<string, EntreeVite>, statiques: readonly string[]): string[] {
  const fichiers = new Set<string>(["/index.html", ...statiques]);
  for (const entree of Object.values(manifeste)) {
    for (const fichier of [entree.file, ...(entree.css ?? []), ...(entree.assets ?? [])]) {
      if (!/\.woff$/i.test(fichier)) fichiers.add(`/${fichier}`);
    }
  }
  return [...fichiers].sort();
}
