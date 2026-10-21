/**
 * Routes WhatsApp Business de l'administrateur (spec du 21/10/2026, W-11 à W-13) : test de connexion,
 * message d'essai hors file, modèles (état dans chaque langue, texte à déposer, vérification chez Meta).
 * Le navigateur ne parle jamais à Meta et le jeton n'est jamais rendu. Droits dans `auth/permissions.ts`
 * (administrateur seul) ; test, essai et vérification coupés en formation (`formation/coupures.ts`).
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { clientIp, currentAccount } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { refusFormation } from "../formation/coupures.ts";
import { localize, msg, requestLang } from "../messages.ts";
import { getSetting, setSetting } from "../settings.ts";
import { metaFromSettings, oublierEtatsMeta, type MetaProvider } from "./meta.ts";
import { etatsDepuisMeta, exemples, MODELES_META, nomModele, statutDe, texteADeposer, type EtatsModeles, type NomsModeles } from "./modeles-meta.ts";
import { normalizePhone } from "./numeros.ts";
import { TEMPLATE_KINDS } from "./textes.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = Context<any>;
/** `WHATSAPP_FETCH` : jamais posée en production ; les essais y mettent le faux Meta. */
const fetchOf = (c: Ctx): typeof fetch => c.env?.WHATSAPP_FETCH ?? fetch;
/** Refus de Meta (message codé), dans la langue de l'écran. */
const refus = (c: Ctx, error: unknown) => c.json({ error: localize(c, error instanceof Error ? error.message : String(error)) }, 502);
/** Second verrou de la formation : `metaFromSettings` n'y construit aucun fournisseur. */
const coupe = (c: Ctx) => refusFormation(c) ?? c.json({ error: msg(c, "formation.coupe"), code: "formation" }, 409);

async function institut(): Promise<{ nom: string; telephone: string }> {
  return { nom: await getSetting<string>("institut.nom"), telephone: await getSetting<string>("institut.telephone") };
}

/** Une ligne par type de message (W-13) : catégorie, en-tête, nom réglé, état dans chaque langue, texte à déposer. */
async function lignes() {
  const noms = await getSetting<NomsModeles | null>("whatsapp.meta.noms");
  const etats = await getSetting<EtatsModeles | null>("whatsapp.meta.etats");
  const inst = await institut();
  return {
    verifie_le: etats?.verifieLe ?? null,
    modeles: TEMPLATE_KINDS.map((kind) => {
      const nom = nomModele(kind, noms);
      return {
        kind, categorie: MODELES_META[kind].categorie, entete: MODELES_META[kind].entete, nom, nom_defaut: MODELES_META[kind].nom,
        statut: { fr: statutDe(etats, kind, nom, "fr").statut, en: statutDe(etats, kind, nom, "en").statut },
        depot: { fr: texteADeposer(kind, "fr", noms, inst), en: texteADeposer(kind, "en", noms, inst) },
      };
    }),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountMetaRoutes(app: OpenAPIHono<any>): void {
  const meta = (c: Ctx): Promise<MetaProvider | null> => metaFromSettings(fetchOf(c));

  // Tester la connexion (W-11) : lu chez Meta à chaque appui, jamais l'état gardé.
  app.post("/api/whatsapp/meta/tester", async (c) => {
    const provider = await meta(c);
    if (!provider) return coupe(c);
    if (!provider.complet) return c.json({ error: msg(c, "whatsapp.meta_incomplet") }, 409);
    oublierEtatsMeta();
    try {
      const lu = await provider.lireNumero();
      return c.json({ numero: lu.numero, nom: lu.nom, qualite: lu.qualite });
    } catch (error) {
      return refus(c, error);
    }
  });

  // Message d'essai (W-12) : modèle de confirmation, valeurs d'exemple, langue de l'écran ; envoi direct, hors file.
  app.post("/api/whatsapp/meta/essai", async (c) => {
    const provider = await meta(c);
    if (!provider) return coupe(c);
    const { to } = (await c.req.json().catch(() => ({}))) as { to?: unknown };
    const number = typeof to === "string" ? normalizePhone(to, await getSetting<string>("whatsapp.indicatif")) : null;
    if (!number) return c.json({ error: msg(c, "whatsapp.numero_invalide") }, 400);
    if (!provider.complet) return c.json({ error: msg(c, "whatsapp.meta_incomplet") }, 409);
    const lang = requestLang(c);
    try {
      await provider.sendTemplate(number, { modele: "confirmation", lang, valeurs: exemples(lang, await institut()) });
    } catch (error) {
      return refus(c, error);
    }
    await logAudit({ accountId: currentAccount(c).id, action: "whatsapp.meta_essai", target: number, ip: clientIp(c), now: nowOf(c) });
    return c.json({ ok: true });
  });

  app.get("/api/whatsapp/meta/modeles", async (c) => c.json(await lignes()));

  // Vérifier les modèles (W-13) : lus chez Meta, états et date gardés dans `whatsapp.meta.etats`.
  app.post("/api/whatsapp/meta/modeles/verifier", async (c) => {
    const provider = await meta(c);
    if (!provider) return coupe(c);
    let lus;
    try {
      lus = await provider.lireModeles();
    } catch (error) {
      return error instanceof Error && /meta_incomplet/.test(error.message) ? c.json({ error: localize(c, error.message) }, 409) : refus(c, error);
    }
    const account = currentAccount(c);
    const now = nowOf(c);
    await setSetting("whatsapp.meta.etats", etatsDepuisMeta(lus, await getSetting<NomsModeles | null>("whatsapp.meta.noms"), now), account.id, now);
    await logAudit({ accountId: account.id, action: "whatsapp.meta_verification", target: provider.compte, ip: clientIp(c), now });
    return c.json(await lignes());
  });
}
