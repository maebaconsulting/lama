/**
 * Routes des imports (spec du 18/10/2026 § 2.1) : modèle CSV, aperçu sans écriture, import en une seule
 * transaction. Gérante et administrateur (`permissions.ts`) ; fichier en corps binaire, 5 Mo au plus
 * (`index.ts`), relu et recontrôlé en entier à chaque appel : l'import ne fait jamais confiance à l'aperçu.
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { clientIp, currentAccount } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { message, msg, requestLang, type Lang } from "../messages.ts";
import { publish } from "../realtime.ts";
import { getSetting } from "../settings.ts";
import type { Database, StorageBinding } from "../storage.ts";
import { DEVISE_DEFAUT, estCodeDevise, type CodeDevise } from "../../shared/devises.ts";
import { estTypeImport, IMPORT_MAX_LISTE, IMPORT_MAX_OCTETS, type ApercuImport, type TypeImport } from "../../shared/import.ts";
import { analyserCatalogue, COLONNES_CATALOGUE, deviseDeLaBase, ecrireCatalogue, lireCatalogueTableau } from "../catalogue/import-catalogue.ts";
import { decoderFichier, lireTableau, type Colonnes, type Tableau } from "./csv.ts";
import { importable, type Analyse, type Contexte } from "./commun.ts";
import { analyserClientes, COLONNES_CLIENTES, ecrireClientes } from "./clientes.ts";
import { analyserProduits, COLONNES_PRODUITS, ecrireProduits } from "./produits.ts";
import { analyserRendezVous, COLONNES_RENDEZ_VOUS, ecrireRendezVous } from "./rendez-vous.ts";
import { modele, retirerExemples } from "./modeles.ts";

interface Definition {
  colonnes: Colonnes;
  /** Action du journal d'audit. */
  action: string;
  /** Ressources prévenues en temps réel après un import réussi (`realtime.ts`). */
  ressources: string[];
  /** Analyse ; avec `ecrire` et si rien n'est refusé, écrit dans la même transaction. */
  traiter: (db: Database, tableau: Tableau, ctx: Contexte, ecrire: boolean) => Analyse<unknown>;
  /** Cible du journal, en français comme toutes les cibles du serveur. */
  cible: (a: Analyse<unknown>) => string;
}

const cibleCommune = (a: Analyse<unknown>) => message("fr", "import.cible", { lignes: a.lignes, ajouts: a.ajouts, mises: a.misesAJour });

const DEFINITIONS: Record<TypeImport, Definition> = {
  catalogue: {
    colonnes: COLONNES_CATALOGUE,
    action: "catalogue.import",
    ressources: ["services"],
    traiter: (db, tableau, ctx, ecrire) => {
      const lecture = lireCatalogueTableau(tableau);
      const a = analyserCatalogue(db, lecture, ctx);
      if (ecrire && importable(a)) ecrireCatalogue(db, a.operations, { desactiverAbsentes: ctx.desactiverAbsentes, devise: lecture.devise });
      return a;
    },
    cible: (a) => message("fr", "cli.catalogue_bilan", { lignes: a.lignes, ajoutees: a.ajouts, mises: a.misesAJour, desactivees: a.desactivees }),
  },
  clientes: {
    colonnes: COLONNES_CLIENTES,
    action: "import.clientes",
    ressources: ["clients"],
    traiter: (db, tableau, ctx, ecrire) => {
      const a = analyserClientes(db, tableau, ctx);
      if (ecrire && importable(a)) ecrireClientes(db, a.operations);
      return a;
    },
    cible: cibleCommune,
  },
  produits: {
    colonnes: COLONNES_PRODUITS,
    action: "import.produits",
    ressources: ["products"],
    traiter: (db, tableau, ctx, ecrire) => {
      const a = analyserProduits(db, tableau, ctx);
      if (ecrire && importable(a)) ecrireProduits(db, a.operations);
      return a;
    },
    cible: cibleCommune,
  },
  "rendez-vous": {
    colonnes: COLONNES_RENDEZ_VOUS,
    action: "import.rendez_vous",
    ressources: ["appointments", "clients"],
    traiter: (db, tableau, ctx, ecrire) => {
      const a = analyserRendezVous(db, tableau, ctx);
      if (ecrire && importable(a)) ecrireRendezVous(db, a.operations, ctx.maintenant);
      return a;
    },
    cible: cibleCommune,
  },
};

/** Réponse de l'aperçu et de l'import : motifs traduits dans la langue de la requête, listes bornées. */
function versJson(type: TypeImport, a: Analyse<unknown>, lang: Lang): ApercuImport {
  const refusees = [...a.refusees].sort((x, y) => x.ligne - y.ligne);
  return {
    type,
    lignes: a.lignes,
    ajouts: a.ajouts,
    mises_a_jour: a.misesAJour,
    inchangees: a.inchangees,
    desactivees: a.desactivees,
    clientes_creees: a.clientesCreees,
    stocks_changes: a.journal.filter((j) => j.action === "produit.stock").length,
    premier_prix: a.premierPrix,
    refusees: refusees.slice(0, IMPORT_MAX_LISTE).map((r) => ({ ligne: r.ligne, motif: message(lang, r.motif, r.valeurs), doublon: r.doublon === true })),
    refusees_total: refusees.length,
    doublons: refusees.filter((r) => r.doublon).length,
    avertissements: a.avertissements.slice(0, IMPORT_MAX_LISTE).map((w) => ({ ligne: w.ligne, texte: message(lang, w.motif, w.valeurs) })),
    avertissements_total: a.avertissements.length,
    importable: importable(a),
  };
}

const baseDevise = (code: unknown): CodeDevise => (estCodeDevise(code) ? code : DEVISE_DEFAUT);

/** Aperçu (`ecrire` faux) ou import (`ecrire` vrai) du fichier reçu. */
async function recevoir(c: Context, ecrire: boolean) {
  const type = c.req.param("type");
  if (!estTypeImport(type)) return c.json({ error: msg(c, "import.type") }, 404);
  const octets = new Uint8Array(await c.req.arrayBuffer());
  if (octets.byteLength > IMPORT_MAX_OCTETS) return c.json({ error: msg(c, "import.trop_lourd") }, 400);
  const texte = decoderFichier(octets);
  if (texte === null) return c.json({ error: msg(c, "import.encodage") }, 400);
  const definition = DEFINITIONS[type];
  const lecture = lireTableau(texte, definition.colonnes);
  if (!lecture.ok) return c.json({ error: msg(c, lecture.erreur.motif, lecture.erreur.valeurs) }, 400);
  const indicatif = await getSetting<string>("whatsapp.indicatif");
  const maintenant = nowOf(c);
  const desactiverAbsentes = c.req.query("desactiver") === "1";
  const storage = c.env.STORAGE as StorageBinding;
  // Une seule transaction : l'analyse et l'écriture voient la même base, et un refus ou une erreur n'écrit rien.
  const analyse = storage.transaction!((db) => {
    const ctx: Contexte = { indicatif, maintenant, base: baseDevise(deviseDeLaBase(db)), desactiverAbsentes };
    return definition.traiter(db, retirerExemples(type, lecture.tableau, indicatif), ctx, ecrire);
  });
  if (analyse.erreurFichier) return c.json({ error: msg(c, analyse.erreurFichier.motif, analyse.erreurFichier.valeurs) }, 400);
  const apercu = versJson(type, analyse, requestLang(c));
  if (!ecrire) return c.json(apercu, 200);
  if (!apercu.importable) return c.json({ error: msg(c, "import.refuse", { n: apercu.refusees_total }), apercu }, 422);
  const account = currentAccount(c);
  const ip = clientIp(c);
  await logAudit({ accountId: account.id, action: definition.action, target: definition.cible(analyse), ip, now: maintenant });
  for (const j of analyse.journal) await logAudit({ accountId: account.id, action: j.action, target: j.cible, ip, now: maintenant });
  for (const resource of definition.ressources) publish({ resource });
  return c.json(apercu, 200);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountImportRoutes(app: OpenAPIHono<any>): void {
  app.get("/api/import/:type/modele", async (c) => {
    const type = c.req.param("type");
    if (!estTypeImport(type)) return c.json({ error: msg(c, "import.type") }, 404);
    const devise = baseDevise(await getSetting<string>("institut.devise"));
    const texte = modele(type, { devise, indicatif: await getSetting<string>("whatsapp.indicatif"), maintenant: nowOf(c) });
    return c.body(texte, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="modele-${type}.csv"`,
      "Cache-Control": "no-store",
    });
  });
  app.post("/api/import/:type/apercu", (c) => recevoir(c, false));
  app.post("/api/import/:type", (c) => recevoir(c, true));
}
