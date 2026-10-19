import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Configuration wrangler du relais, remplie à partir du modèle versionné `relais/wrangler.modele.toml`, qui n'écrit
 * aucun identifiant. Appelé par deploy/cloudflare.sh (messages dans la langue de `LAMA_LANGUE`) :
 *   config --compte <id> --worker <nom> --base <nom> --id-base <uuid> [--domaine <hôte>] [--demandes-par-heure <n>] [--cle-site-turnstile <clé>]
 *   id-base <nom>   identifiant de la base nommée, lu dans la sortie de « wrangler d1 list --json » (entrée standard)
 *   secrets         noms des secrets déjà posés, lus dans la sortie de « wrangler secret list » (entrée standard)
 *   succes          sortie 0 si la réponse de l'API de Cloudflare lue sur l'entrée standard dit `success: true`, 2 sinon
 *   sous-domaine    `absent` si la réponse de `GET /accounts/<compte>/workers/subdomain` (entrée standard) dit que le compte n'a pas de sous-domaine workers.dev, `present` sinon (y compris réponse refusée ou illisible)
 *   zone <nom>      identifiant de la zone nommée dans une réponse de `GET /zones` (entrée standard), ou rien
 * Sortie 0 : résultat sur la sortie standard ; 2 : réglage refusé, motif sur la sortie d'erreur.
 */
export type Reglages = {
  compte: string;
  worker: string;
  base: string;
  idBase: string;
  domaine: string | null;
  demandesParHeure: number;
  cleSiteTurnstile: string | null;
};

type Texte = { fr: string; en: string };

/** Réglages refusés, motifs dans les deux langues. */
export class ReglagesRefuses extends Error {
  readonly motifs: Texte[];
  constructor(motifs: Texte[]) {
    super(motifs.map((m) => m.fr).join("\u00a0; "));
    this.motifs = motifs;
  }
}

export const MODELE = new URL("../wrangler.modele.toml", import.meta.url);

/** Secrets du Worker, posés par `wrangler secret put` (jamais dans un fichier) ; le reste de `VariablesRelais` est en variables. */
export const SECRETS = ["RELAIS_CLE_MAITRE", "RELAIS_ADMIN_MOT_DE_PASSE", "TURNSTILE_SECRET"] as const;

/** Nom de Worker ou de base D1 : minuscules, chiffres et tirets (ni en tête ni en fin), 63 caractères au plus. */
const MOTIF_NOM = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MOTIF_COMPTE = /^[0-9a-f]{32}$/;
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Nom d'hôte en minuscules, au moins un point, sans schéma, port ni chemin. */
const MOTIF_DOMAINE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MOTIF_CLE_SITE = /^[0-9A-Za-z_-]{1,100}$/;

/** Motifs de refus des réglages, vide s'ils sont bons. Rien d'autre que ces motifs n'entre dans le fichier produit. */
export function ecarts(r: Reglages): Texte[] {
  const e: Texte[] = [];
  if (!MOTIF_COMPTE.test(r.compte)) e.push({ fr: "identifiant du compte Cloudflare\u00a0: 32 caractères hexadécimaux minuscules", en: "Cloudflare account ID: 32 lowercase hexadecimal characters" });
  if (!MOTIF_NOM.test(r.worker)) e.push({ fr: "nom du Worker\u00a0: minuscules, chiffres et tirets, 63 caractères au plus", en: "Worker name: lowercase letters, digits and hyphens, 63 characters at most" });
  if (!MOTIF_NOM.test(r.base)) e.push({ fr: "nom de la base D1\u00a0: minuscules, chiffres et tirets, 63 caractères au plus", en: "D1 database name: lowercase letters, digits and hyphens, 63 characters at most" });
  if (!MOTIF_UUID.test(r.idBase)) e.push({ fr: "identifiant de la base D1 mal formé", en: "malformed D1 database ID" });
  if (r.domaine !== null && !MOTIF_DOMAINE.test(r.domaine)) e.push({ fr: "domaine\u00a0: un nom d'hôte en minuscules, sans https:// ni chemin (par exemple rdv.exemple.com)", en: "domain: a lowercase host name, without https:// or path (for example rdv.exemple.com)" });
  if (!Number.isInteger(r.demandesParHeure) || r.demandesParHeure < 1 || r.demandesParHeure > 1000) e.push({ fr: "demandes par heure\u00a0: un entier de 1 à 1000", en: "requests per hour: an integer from 1 to 1000" });
  if (r.cleSiteTurnstile !== null && !MOTIF_CLE_SITE.test(r.cleSiteTurnstile)) e.push({ fr: "clé de site Turnstile mal formée", en: "malformed Turnstile site key" });
  return e;
}

/** Fichier wrangler rempli. Lève `ReglagesRefuses` si un réglage est refusé ou si le modèle porte un repère inconnu. */
export function configWrangler(modele: string, r: Reglages): string {
  const e = ecarts(r);
  if (e.length) throw new ReglagesRefuses(e);
  const valeurs: Record<string, string> = {
    COMPTE: r.compte,
    WORKER: r.worker,
    BASE: r.base,
    ID_BASE: r.idBase,
    // Avec un domaine personnalisé, une seule adresse : celle que Turnstile et les salons connaissent.
    WORKERS_DEV: r.domaine ? "false" : "true",
    ROUTES: r.domaine ? `routes = [{ pattern = "${r.domaine}", custom_domain = true }]` : "# Sans domaine personnalisé, le relais répond sur le sous-domaine workers.dev du compte.",
    DEMANDES_PAR_HEURE: String(r.demandesParHeure),
    CLE_SITE_TURNSTILE: r.cleSiteTurnstile ?? "",
  };
  return modele.replace(/@([A-Z_]+)@/g, (repere, nom: string) => {
    if (!(nom in valeurs)) throw new ReglagesRefuses([{ fr: `repère inconnu dans le modèle\u00a0: ${repere}`, en: `unknown marker in the template: ${repere}` }]);
    return valeurs[nom];
  });
}

/** Options connues de la commande `config` : toute autre est refusée plutôt qu'ignorée (`--domain` partirait sans domaine). */
const OPTIONS = ["compte", "worker", "base", "id-base", "domaine", "demandes-par-heure", "cle-site-turnstile"];

/** Réglages lus dans les options `--nom valeur` de la commande `config` ; option inconnue ou répétée refusée. */
export function reglagesDepuis(args: string[]): Reglages {
  const o = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const cle = args[i];
    const valeur = args[i + 1];
    if (!cle.startsWith("--") || valeur === undefined) throw new ReglagesRefuses([{ fr: `option mal formée\u00a0: ${cle}`, en: `malformed option: ${cle}` }]);
    const nom = cle.slice(2);
    if (!OPTIONS.includes(nom)) throw new ReglagesRefuses([{ fr: `option inconnue\u00a0: ${cle}`, en: `unknown option: ${cle}` }]);
    if (o.has(nom)) throw new ReglagesRefuses([{ fr: `option répétée\u00a0: ${cle}`, en: `repeated option: ${cle}` }]);
    o.set(nom, valeur);
  }
  return {
    compte: o.get("compte") ?? "",
    worker: o.get("worker") ?? "",
    base: o.get("base") ?? "",
    idBase: o.get("id-base") ?? "",
    domaine: o.get("domaine") || null,
    demandesParHeure: Number(o.get("demandes-par-heure") ?? "30"),
    cleSiteTurnstile: o.get("cle-site-turnstile") || null,
  };
}

/** Tableau JSON d'une sortie de wrangler, bandeau éventuel ignoré ; lève une erreur si aucun tableau n'est lisible. */
function tableau(sortie: string): unknown[] {
  const debut = sortie.indexOf("[");
  const fin = sortie.lastIndexOf("]");
  const lu: unknown = debut >= 0 && fin > debut ? JSON.parse(sortie.slice(debut, fin + 1)) : null;
  if (!Array.isArray(lu)) throw new ReglagesRefuses([{ fr: "réponse de wrangler illisible", en: "unreadable wrangler output" }]);
  return lu;
}

const champ = (x: unknown, nom: string): unknown => (typeof x === "object" && x !== null ? (x as Record<string, unknown>)[nom] : undefined);

/** Identifiant de la base D1 nommée `nom` dans la sortie de `wrangler d1 list --json`, ou `null` si elle manque. */
export function idBase(sortie: string, nom: string): string | null {
  const base = tableau(sortie).find((b) => champ(b, "name") === nom && typeof champ(b, "uuid") === "string");
  return base ? (champ(base, "uuid") as string) : null;
}

/** Noms des secrets déjà posés, dans la sortie de `wrangler secret list` (JSON). */
export function secretsPoses(sortie: string): string[] {
  return tableau(sortie).map((s) => champ(s, "name")).filter((n): n is string => typeof n === "string");
}

/** Réponse de l'API de Cloudflare réussie (`{ "success": true, … }`) ; une réponse illisible compte comme un refus. */
export function reponseReussie(sortie: string): boolean {
  try {
    return champ(JSON.parse(sortie), "success") === true;
  } catch {
    return false;
  }
}

/** `true` si la réponse de `GET /accounts/<compte>/workers/subdomain` dit clairement qu'il n'y a pas de sous-domaine workers.dev (code 10007, ou succès sans nom) ; refusée ou illisible, elle ne dit rien. */
export function sousDomaineAbsent(sortie: string): boolean {
  try {
    const reponse = JSON.parse(sortie);
    if (champ(reponse, "success") === true) return typeof champ(champ(reponse, "result"), "subdomain") !== "string" || champ(champ(reponse, "result"), "subdomain") === "";
    const erreurs = champ(reponse, "errors");
    return Array.isArray(erreurs) && erreurs.some((e) => champ(e, "code") === 10007);
  } catch {
    return false;
  }
}

/** Identifiant de la zone nommée `nom` dans une réponse de `GET /zones`, ou `null` si le jeton ne la voit pas. Lève `ReglagesRefuses` si la zone n'est pas `active` (serveurs de noms pas encore basculés). */
export function idZone(sortie: string, nom: string): string | null {
  if (!reponseReussie(sortie)) return null;
  const resultat = champ(JSON.parse(sortie), "result");
  const zone = Array.isArray(resultat) ? resultat.find((z) => champ(z, "name") === nom && typeof champ(z, "id") === "string") : undefined;
  if (!zone) return null;
  const etat = champ(zone, "status");
  if (etat !== "active") {
    const status = typeof etat === "string" ? etat : "?";
    throw new ReglagesRefuses([{ fr: `Zone ${nom} pas encore active (état\u00a0: ${status})\u00a0: attendre la bascule des serveurs de noms.`, en: `Zone ${nom} not active yet (status: ${status}): wait for the nameserver switch.` }]);
  }
  return champ(zone, "id") as string;
}

async function entree(): Promise<string> {
  let texte = "";
  for await (const morceau of process.stdin) texte += morceau;
  return texte;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const langue = process.env.LAMA_LANGUE === "en" ? "en" : "fr";
  const [commande, ...reste] = process.argv.slice(2);
  try {
    if (commande === "config") process.stdout.write(configWrangler(readFileSync(MODELE, "utf8"), reglagesDepuis(reste)));
    else if (commande === "id-base" && reste.length === 1) process.stdout.write(idBase(await entree(), reste[0]) ?? "");
    else if (commande === "secrets" && reste.length === 0) process.stdout.write(secretsPoses(await entree()).join("\n"));
    else if (commande === "succes" && reste.length === 0) process.exit(reponseReussie(await entree()) ? 0 : 2);
    else if (commande === "sous-domaine" && reste.length === 0) process.stdout.write(sousDomaineAbsent(await entree()) ? "absent" : "present");
    else if (commande === "zone" && reste.length === 1) process.stdout.write(idZone(await entree(), reste[0]) ?? "");
    else throw new ReglagesRefuses([{ fr: "commande inconnue (config, id-base, secrets, succes, sous-domaine ou zone)", en: "unknown command (config, id-base, secrets, succes, sous-domaine or zone)" }]);
  } catch (e) {
    const motifs = e instanceof ReglagesRefuses ? e.motifs.map((m) => m[langue]) : [e instanceof Error ? e.message : String(e)];
    for (const m of motifs) console.error(m);
    process.exit(2);
  }
}
