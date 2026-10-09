/**
 * Manifeste d'application web de lama (PWA, P-01), servi par le serveur à
 * `/manifest.webmanifest`, public et sans session : le nom de l'institut et sa
 * langue viennent des réglages, relus à chaque demande. La base de formation
 * (distribution D-14) a son propre nom d'application, « lama formation ».
 */
import { message, type Lang } from "../messages.ts";

/** Cuir de la charte : fond de l'écran de lancement et barre d'état, comme `theme-color` dans `index.html`. */
export const COULEUR_CUIR = "#161514";

/** Icônes de l'écran d'accueil (P-02) : fichiers statiques de `public/icones/`, copiés tels quels dans `dist/icones/`. */
export const ICONES = [
  { src: "/icones/lama-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icones/lama-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icones/lama-masquable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
] as const;

export interface Manifeste {
  id: string;
  name: string;
  short_name: string;
  description: string;
  lang: Lang;
  start_url: string;
  scope: string;
  display: "standalone";
  orientation: "any";
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
}

/**
 * Manifeste pour un institut : « lama, {nom} », ou « lama » seul si le nom est vide ;
 * base de formation : « lama formation » (« lama training »), nom court compris, pour
 * la distinguer sur l'écran d'accueil d'un appareil qui a installé les deux ;
 * démonstration publique (DP-04) : « lama démo » (« lama demo »).
 */
export function manifesteWeb(institut: { nom: string; langue: string }, formation = false, demo = false): Manifeste {
  const nom = institut.nom.trim();
  const lang: Lang = institut.langue === "en" ? "en" : "fr";
  const application = demo ? message(lang, "manifeste.demo") : formation ? message(lang, "manifeste.formation") : null;
  return {
    id: "/",
    name: application ?? (nom ? `lama, ${nom}` : "lama"),
    short_name: application ?? "lama",
    description: message(lang, "manifeste.description"),
    lang,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: COULEUR_CUIR,
    theme_color: COULEUR_CUIR,
    icons: ICONES.map((icone) => ({ ...icone })),
  };
}

/** Lit le nom et la langue de l'institut ; base illisible (maintenance, restauration) : manifeste neutre plutôt qu'une erreur. */
export async function lireManifeste(lire: (cle: string) => Promise<unknown>, formation = false, demo = false): Promise<Manifeste> {
  try {
    const [nom, langue] = await Promise.all([lire("institut.nom"), lire("institut.langue")]);
    return manifesteWeb({ nom: typeof nom === "string" ? nom : "", langue: typeof langue === "string" ? langue : "fr" }, formation, demo);
  } catch {
    return manifesteWeb({ nom: "", langue: "fr" }, formation, demo);
  }
}

/** Réponse HTTP du manifeste : type `application/manifest+json`, jamais gardée sans revalidation (le nom peut changer). */
export function reponseManifeste(manifeste: Manifeste): Response {
  return new Response(JSON.stringify(manifeste), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
