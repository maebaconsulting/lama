import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { qrSvg } from "../certificat/page.ts";
import { nowOf } from "../clock.ts";
import { coded, localize, msg } from "../messages.ts";
import type { StorageBinding } from "../storage.ts";
import { codeIntegration, pageSalon } from "../../shared/en-ligne.ts";
import { codeErreur, refusDe, relancerEnLigne } from "./boucle.ts";
import { clientRelais, type Fetch } from "./client-relais.ts";
import { liaisonReglee, lireConfig } from "./config.ts";
import { ecrireEtat, lireEtat } from "./etat-liaison.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = Context<any>;
const storageOf = (c: Ctx) => c.env.STORAGE as StorageBinding;
/** Relais d'essai en mémoire (`EN_LIGNE_FETCH`), jamais posé en production : sans lui, le vrai réseau. */
const fetchDe = (c: Ctx) => (c.env as { EN_LIGNE_FETCH?: Fetch }).EN_LIGNE_FETCH;

/** Rubrique Réglages > Réservation en ligne (spec § 4.6) : état de la liaison, essai, QR code de la page. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountReglagesEnLigneRoutes(app: OpenAPIHono<any>): void {
  app.get("/api/en-ligne/etat", async (c) => {
    const cfg = await lireConfig();
    const etat = storageOf(c).transaction!((db) => lireEtat(db));
    return c.json({
      active: cfg.active, reglee: liaisonReglee(cfg), adresse: cfg.adresse, salon: cfg.salon,
      page: pageSalon(cfg.adresse, cfg.salon), integration: codeIntegration(cfg.adresse, cfg.salon),
      dernier_succes_le: etat.dernier_succes_le, derniere_erreur: etat.derniere_erreur ? localize(c, etat.derniere_erreur) : null,
      derniere_erreur_le: etat.derniere_erreur_le, attente_relais: etat.attente_relais,
      offre_publiee_le: etat.offre_publiee_le, plages_publiees_le: etat.plages_publiees_le,
    });
  });

  // « Tester la liaison » : `GET /etat` du relais, résultat noté dans l'état de la liaison, puis un tour de la boucle au plus vite
  // (jamais `tour()` directement : seule l'instance lancée par `startEnLigne` enchaîne les tours).
  app.post("/api/en-ligne/tester", async (c) => {
    const cfg = await lireConfig();
    if (!liaisonReglee(cfg)) return c.json({ error: msg(c, "en_ligne.non_reglee") }, 409);
    const maintenant = nowOf(c);
    const relais = clientRelais({ adresse: cfg.adresse, institut: cfg.salon, cle: cfg.cle!, fetch: fetchDe(c), maintenant: () => nowOf(c) });
    let refus: string | null;
    let json: { mode_essai?: unknown; demandes_en_attente?: unknown } | null = null;
    try {
      const r = await relais.appeler("GET", "/etat");
      json = r.json;
      refus = refusDe(r) ?? (r.json?.contrat === "v1" ? null : coded("en_ligne.contrat"));
    } catch (e) {
      refus = codeErreur(e);
    }
    const attente = typeof json?.demandes_en_attente === "number" ? json.demandes_en_attente : null;
    storageOf(c).transaction!((db) => ecrireEtat(db, refus
      ? { derniere_erreur: refus, derniere_erreur_le: maintenant }
      : { dernier_succes_le: maintenant, derniere_erreur: null, derniere_erreur_le: null, attente_relais: attente }));
    relancerEnLigne();
    if (refus) return c.json({ ok: false, message: localize(c, refus) });
    return c.json({ ok: true, message: msg(c, "en_ligne.liaison_ok", { attente: attente ?? 0 }), mode_essai: json?.mode_essai === true, demandes_en_attente: attente ?? 0 });
  });

  // QR code de la page de réservation (SVG, à télécharger et imprimer).
  app.get("/api/en-ligne/qr", async (c) => {
    const cfg = await lireConfig();
    const page = pageSalon(cfg.adresse, cfg.salon);
    if (!page) return c.json({ error: msg(c, "en_ligne.non_reglee") }, 404);
    return c.json({ image: `data:image/svg+xml;base64,${Buffer.from(qrSvg(page)).toString("base64")}`, page });
  });
}
