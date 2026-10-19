import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import type { Database } from "../storage.ts";
import { deviseActive } from "../../shared/devise-active.ts";
import { semaineProblem, type Semaine } from "../../shared/horaires.ts";
import { texteSur, type ThemeEnLigne } from "../../shared/en-ligne.ts";
import type { ImageType } from "../images.ts";
import { decodeImage, type Rgba } from "../impression/image-logo.ts";
import { logoVersions, readLogo, type LogoVariant } from "../institut/logos.ts";
import { message, MessageError } from "../messages.ts";
import { normalizePhone } from "../whatsapp/numeros.ts";
import { firstName } from "../whatsapp/textes.ts";
import { FUSEAU, type ConfigEnLigne } from "./config.ts";

/**
 * Offre publiée sur le relais (contrat v1, `PUT /offre`, spec § 2 et § 9.3) : l'institut (nom, téléphone,
 * logo réduit, devise, langues, texte d'accord, thème, horaires), les prestations et les praticiennes
 * ouvertes en ligne. Le corps est construit sans version : la boucle compare son empreinte à la dernière
 * publiée et n'ajoute la version qu'à la publication.
 */
export type TexteBilingue = { fr: string; en: string };
export type PrestationPubliee = { id: string; nom: TexteBilingue; categorie: TexteBilingue; description: TexteBilingue; duree: number; prix: number };
export type PraticiennePubliee = { id: string; prenom: string; photo: null; prestations: string[] };
export type InstitutPublie = {
  nom: string; fuseau: string; telephone: string; logo: string | null;
  devise: { code: string; decimales: number; symbole: string; position: "avant" | "apres" };
  langues: ("fr" | "en")[]; texte_donnees: TexteBilingue; theme?: ThemeEnLigne; horaires: Semaine;
};
export type CorpsOffre = { institut: InstitutPublie; prestations: PrestationPubliee[]; praticiennes: PraticiennePubliee[] };

/** Identifiants opaques du contrat : `s12` pour la prestation 12, `p3` pour la praticienne 3. */
export const idPrestation = (id: number) => `s${id}`;
export const idPraticienne = (id: number) => `p${id}`;

/** Identifiant de lama lu dans un identifiant du contrat, ou `null` s'il n'est pas de la forme attendue. */
export function deIdentifiant(ref: string, prefixe: "s" | "p"): number | null {
  const m = /^([sp])([1-9]\d{0,9})$/.exec(ref);
  return m && m[1] === prefixe ? Number(m[2]) : null;
}

/** Semaine type enregistrée sur la fiche ; `null` (comme l'institut) si elle est absente ou illisible. */
export function semaineDe(brut: string | null): Semaine | null {
  if (!brut) return null;
  try {
    const v = JSON.parse(brut) as unknown;
    return semaineProblem(v) ? null : (v as Semaine);
  } catch {
    return null;
  }
}

type LignePrestation = {
  id: number; name: string; name_en: string | null; category: string | null; category_en: string | null;
  description: string | null; description_en: string | null; duration: number; price: number;
};
export type Catalogue = {
  prestations: LignePrestation[];
  praticiennes: { id: number; name: string; horaires: Semaine | null; services: number[] }[];
};

/**
 * Catalogue ouvert en ligne (spec § 4.2) : prestations actives, cochées en ligne, vendues seules (jamais « supplément seulement »), avec une durée et un prix ;
 * praticiennes actives, cochées en ligne, qui pratiquent au moins une de ces prestations ; une prestation
 * que personne ne pratique n'est pas publiée.
 */
export function catalogueEnLigne(db: Database): Catalogue {
  const services = db.prepare(
    `SELECT id, name, name_en, category, category_en, description, description_en, duration, price FROM services
      WHERE active = 1 AND en_ligne = 1 AND supplement_seulement = 0 AND duration BETWEEN 5 AND 720 AND price >= 1 ORDER BY category, name, id`,
  ).all() as LignePrestation[];
  const ouvertes = new Set(services.map((s) => s.id));
  const equipe = db.prepare("SELECT id, name, horaires FROM staff WHERE active = 1 AND en_ligne = 1 ORDER BY name, id").all() as { id: number; name: string; horaires: string | null }[];
  const liens = db.prepare("SELECT staff_id, service_id FROM staff_services ORDER BY service_id").all() as { staff_id: number; service_id: number }[];
  const praticiennes = equipe
    .map((s) => ({ id: s.id, name: s.name, horaires: semaineDe(s.horaires), services: liens.filter((l) => l.staff_id === s.id && ouvertes.has(l.service_id)).map((l) => l.service_id) }))
    .filter((p) => p.services.length > 0);
  const pratiquees = new Set(praticiennes.flatMap((p) => p.services));
  return { prestations: services.filter((s) => pratiquees.has(s.id)).map((s) => ({ ...s })), praticiennes };
}

const texte = (fr: string | null, en: string | null, max = 2000): TexteBilingue => ({ fr: (fr ?? "").slice(0, max), en: ((en ?? "").trim() || fr || "").slice(0, max) });

/** Institut publié : le nom est exigé par le contrat, rien n'est publié sans lui. */
function institutPublie(cfg: ConfigEnLigne, logo: string | null): InstitutPublie {
  if (!cfg.institut.nom) throw new MessageError("en_ligne.nom_manquant");
  const d = deviseActive();
  const numero = normalizePhone(cfg.institut.telephone, cfg.institut.indicatif);
  return {
    nom: cfg.institut.nom.slice(0, 120), fuseau: FUSEAU, telephone: numero ? `+${numero}` : cfg.institut.telephone.slice(0, 30), logo,
    devise: { code: d.code, decimales: d.decimales, symbole: d.symbole, position: d.position },
    langues: ["fr", "en"], texte_donnees: texte(cfg.texteDonnees.fr, cfg.texteDonnees.en),
    ...(cfg.theme ? { theme: cfg.theme } : {}),
    horaires: cfg.institut.horaires,
  };
}

export function construireOffre(db: Database, cfg: ConfigEnLigne, logo: string | null): CorpsOffre {
  const institut = institutPublie(cfg, logo);
  const c = catalogueEnLigne(db);
  const sansCategorie = { fr: message("fr", "en_ligne.categorie_defaut"), en: message("en", "en_ligne.categorie_defaut") };
  return {
    institut,
    prestations: c.prestations.map((s) => ({
      id: idPrestation(s.id), nom: texte(s.name, s.name_en), categorie: (s.category ?? "").trim() ? texte(s.category, s.category_en) : sansCategorie,
      description: texte(s.description, s.description_en), duree: s.duration, prix: Math.round(s.price),
    })),
    praticiennes: c.praticiennes.map((p) => ({ id: idPraticienne(p.id), prenom: (firstName(p.name) || idPraticienne(p.id)).slice(0, 60), photo: null, prestations: p.services.map(idPrestation) })),
  };
}

/** Offre vide (interrupteur coupé, spec § 4.6) : le relais affiche « momentanément indisponible ». */
export function offreVide(cfg: ConfigEnLigne, logo: string | null): CorpsOffre {
  return { institut: institutPublie(cfg, logo), prestations: [], praticiennes: [] };
}

/** Empreinte d'un document à publier : il n'est republié que si elle change. */
export function empreinte(valeur: unknown): string {
  return createHash("sha256").update(JSON.stringify(valeur)).digest("hex");
}

/** Logo publié dans 320 × 128 points : même sans compression (163 840 octets), il tient sous les 200 ko du contrat. */
export const LOGO_LARGEUR = 320;
export const LOGO_HAUTEUR = 128;
export const LOGO_MAX_OCTETS = 200 * 1024;

/** Réduction par moyenne des points couverts (jamais d'agrandissement). */
function reduire(img: Rgba, largeur: number, hauteur: number): Rgba {
  const k = Math.min(1, largeur / img.width, hauteur / img.height);
  if (k === 1) return img;
  const l = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const out = new Uint8Array(l * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < l; x++) {
      const x0 = Math.floor((x * img.width) / l);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / l));
      const somme = [0, 0, 0, 0];
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          for (let c = 0; c < 4; c++) somme[c] += img.rgba[i + c];
          n++;
        }
      }
      const o = (y * l + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(somme[c] / n);
    }
  }
  return { width: l, height: h, rgba: out };
}

/** Logo réduit en PNG `data:` pour l'offre, ou `null` s'il est illisible ou trop lourd malgré la réduction. */
export function reduireLogo(octets: Buffer, type: ImageType): string | null {
  try {
    const img = reduire(decodeImage(octets, type), LOGO_LARGEUR, LOGO_HAUTEUR);
    const png = new PNG({ width: img.width, height: img.height });
    png.data = Buffer.from(img.rgba);
    const sortie = PNG.sync.write(png);
    return sortie.length <= LOGO_MAX_OCTETS ? `data:image/png;base64,${sortie.toString("base64")}` : null;
  } catch {
    return null;
  }
}

let memoire: { cle: string; logo: string | null } | null = null;

/**
 * Logo de l'offre (réglage « Logo et nom ») : le logo clair, ou le sombre si le fond du thème appelle un texte
 * blanc, l'autre à défaut. La réduction n'est refaite que si un logo ou le fond change.
 */
export async function logoPourOffre(theme: ThemeEnLigne | null): Promise<string | null> {
  const ordre: LogoVariant[] = theme && texteSur(theme.fond) === "#FFFFFF" ? ["sombre", "clair"] : ["clair", "sombre"];
  const versions = await logoVersions();
  const cle = `${ordre.join(",")}:${versions.clair}:${versions.sombre}`;
  if (memoire?.cle === cle) return memoire.logo;
  let logo: string | null = null;
  for (const variante of ordre) {
    const lu = await readLogo(variante);
    logo = lu ? reduireLogo(lu.bytes, lu.type) : null;
    if (logo) break;
  }
  memoire = { cle, logo };
  return logo;
}
