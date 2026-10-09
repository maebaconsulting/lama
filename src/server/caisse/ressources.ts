/**
 * Ressources du ticket PDF (sous-projet 5 § 5.1) : polices de la charte
 * (EB Garamond, Jost), sans logo depuis le renommage lama ; et logos de la
 * démonstration au signe de lama (distribution D-02), pour qu'une base de
 * formation tirée du paquet livré les trouve aussi. Le paquet livré à l'institut ne contient
 * ni `node_modules` ni `src` : `pnpm run build` les copie dans
 * `dist-server/ticket/`, à côté du serveur assemblé, et c'est là qu'elles sont
 * lues en production. En développement et dans les tests (serveur lancé
 * depuis la racine du dépôt), elles sont lues à leur place d'origine.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Nom de chaque ressource dans `dist-server/ticket/` et sa place dans le dépôt.
 * WOFF plutôt que WOFF2 : fontkit lit les deux, mais les glyphes de Jost en
 * WOFF2 sortent vides dans le PDF (constaté en préparant la vague 2).
 */
export const TICKET_RESOURCES = {
  "garamond-400.woff": "node_modules/@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff",
  "garamond-600.woff": "node_modules/@fontsource/eb-garamond/files/eb-garamond-latin-600-normal.woff",
  "jost-400.woff": "node_modules/@fontsource/jost/files/jost-latin-400-normal.woff",
  "jost-500.woff": "node_modules/@fontsource/jost/files/jost-latin-500-normal.woff",
  "logo-demo-clair.png": "src/server/demo/logo-clair.png",
  "logo-demo-sombre.png": "src/server/demo/logo-sombre.png",
} as const;

export type TicketResource = keyof typeof TICKET_RESOURCES;

/** Dossier `ticket/` à côté du module en cours : celui du serveur assemblé (`dist-server/ticket`). */
function bundledDir(): string | null {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), "ticket");
  } catch {
    return null; // module chargé depuis une adresse qui n'est pas un fichier
  }
}

/** Chemin d'une ressource : copie du serveur assemblé si elle existe, sinon place d'origine depuis la racine du dépôt. */
export function resourcePath(name: TicketResource, root: string = process.cwd()): string {
  const dir = bundledDir();
  if (dir && existsSync(join(dir, name))) return join(dir, name);
  return join(root, TICKET_RESOURCES[name]);
}

const cache = new Map<TicketResource, Buffer>();

/** Contenu d'une ressource, lu une fois par démarrage du serveur. */
export function readResource(name: TicketResource): Buffer {
  let data = cache.get(name);
  if (!data) {
    data = readFileSync(resourcePath(name));
    cache.set(name, data);
  }
  return data;
}

/** Copie toutes les ressources dans `dest` (étape de `pnpm run build`) ; rend les noms copiés. */
export function copyResources(dest: string, root: string = process.cwd()): string[] {
  mkdirSync(dest, { recursive: true });
  const names = Object.keys(TICKET_RESOURCES) as TicketResource[];
  for (const name of names) copyFileSync(join(root, TICKET_RESOURCES[name]), join(dest, name));
  return names;
}
