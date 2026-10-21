import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { clientIp, currentAccount, isMaintenance, requireConfirmation } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { refusFormation } from "../formation/coupures.ts";
import { localize, msg, requestLang, type MessageKey } from "../messages.ts";
import { getSetting, setSetting } from "../settings.ts";
import type { StorageBinding } from "../storage.ts";
import { lireBase } from "./base.ts";
import { consulter, noterConsultation, type Fetch } from "./consultation.ts";
import { demandeEnAttente, ecrireDemande, ecrireMode, lireEtat, mecanismePose, type EtatOperation } from "./echange.ts";
import { plusRecente, type VersionInstallee } from "./version.ts";

/** Liaison posée par boot.ts hors formation (`MISE_A_JOUR`) ; les essais y mettent un faux serveur des versions. */
export interface MiseAJourEnv {
  /** Dossier d'échange avec le service root (/var/lib/lama/mise-a-jour). */
  dossier: string;
  /** Dossier des données : restauration en attente (lama.db.restauration). */
  dataDir: string;
  installee: VersionInstallee;
  /** Adresse de la dernière version publiée (API de GitHub, ou faux serveur en développement). */
  source: string;
  fetch?: Fetch;
  delai?: number;
  /** Vrai pendant une sauvegarde, de nuit ou à la demande. */
  sauvegardeEnCours: () => Promise<boolean>;
  /** Vrai tant que lama-mise-a-jour.service tourne ; absent (essais) : vrai. */
  serviceActif?: () => Promise<boolean>;
}

/** Délai minimal entre deux « Vérifier maintenant » (M-12). */
export const VERIFICATION_MIN_MS = 60_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = Context<any>;
const envDe = (c: Ctx): MiseAJourEnv | null => (c.env as { MISE_A_JOUR?: MiseAJourEnv }).MISE_A_JOUR ?? null;
const storageDe = (c: Ctx) => c.env.STORAGE as StorageBinding;

/**
 * Opération en cours : demande déposée, ou état écrit par le service root sans fin tant que ce
 * service tourne. Sans fin alors que le service est arrêté : opération abandonnée, plus en cours.
 */
export async function operationEnCours(m: MiseAJourEnv, etat: EtatOperation | null): Promise<boolean> {
  if (demandeEnAttente(m.dossier)) return true;
  if (etat === null || etat.fin !== null) return false;
  return m.serviceActif ? await m.serviceActif() : true;
}

/** Version annoncée plus récente que la version installée, elle-même publiée ; sinon null. */
function annoncee(m: MiseAJourEnv, version: string | null): string | null {
  return version !== null && !m.installee.developpement && plusRecente(version, m.installee.numero) ? version : null;
}

/** Ce que la rubrique affiche (M-14) ; l'opération et le mode à l'administrateur seulement (M-15). */
async function etatPublic(c: Ctx, m: MiseAJourEnv) {
  const base = storageDe(c).transaction!((db) => lireBase(db));
  const version = annoncee(m, base.version);
  const lecture = {
    installee: { version: m.installee.numero, developpement: m.installee.developpement, installee_le: m.installee.installee_le },
    disponible: version === null ? null : { version, publiee_le: base.publiee_le, note: (requestLang(c) === "fr" ? base.note_fr : base.note_en) ?? "" },
    verifie_le: base.verifie_le,
    erreur: base.erreur ? localize(c, base.erreur) : null,
  };
  if (currentAccount(c).role !== "admin") return lecture;
  const etat = lireEtat(m.dossier);
  return {
    ...lecture,
    mecanisme: mecanismePose(m.dossier),
    mode: (await getSetting<string>("mise_a_jour.mode")) === "automatique" ? "automatique" : "manuel",
    en_cours: await operationEnCours(m, etat),
    operation: etat === null ? null : { ...etat, motif_texte: etat.motif ? msg(c, `mise_a_jour.motif.${etat.motif}` as MessageKey) : null },
  };
}

/**
 * Rubrique « Mise à jour » (spec du 21/10/2026, M-12 à M-17) : lama consulte, demande et affiche ;
 * le service root télécharge, vérifie et installe. Rien ici ne touche au programme installé.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountMiseAJourRoutes(app: OpenAPIHono<any>): void {
  app.get("/api/mise-a-jour", async (c) => {
    const m = envDe(c);
    if (!m) return c.json({ error: msg(c, "mise_a_jour.indisponible") }, 404);
    return c.json(await etatPublic(c, m));
  });

  // « Vérifier maintenant » : au plus une fois par minute ; une heure reculée ne bloque jamais (Review Focus 4).
  app.post("/api/mise-a-jour/verifier", async (c) => {
    const formation = refusFormation(c);
    if (formation) return formation;
    const m = envDe(c);
    if (!m) return c.json({ error: msg(c, "mise_a_jour.indisponible") }, 404);
    const maintenant = nowOf(c);
    const derniere = storageDe(c).transaction!((db) => lireBase(db)).verifie_le;
    if (derniere === null || maintenant - derniere >= VERIFICATION_MIN_MS || maintenant < derniere) {
      const r = await consulter({ source: m.source, fetch: m.fetch, delai: m.delai });
      storageDe(c).transaction!((db) => noterConsultation(db, maintenant, r));
    }
    return c.json(await etatPublic(c, m));
  });

  // Demande (M-13) : administrateur, mot de passe retapé ; le service root la prend par lama-mise-a-jour.path.
  app.post("/api/mise-a-jour", async (c) => {
    const formation = refusFormation(c);
    if (formation) return formation;
    const refused = requireConfirmation(c);
    if (refused) return refused;
    const m = envDe(c);
    if (!m) return c.json({ error: msg(c, "mise_a_jour.indisponible") }, 404);
    const refus = (cle: MessageKey) => c.json({ error: msg(c, cle), code: cle.slice("mise_a_jour.".length) }, 409);
    if (!mecanismePose(m.dossier)) return refus("mise_a_jour.non_pose");
    if (m.installee.developpement) return refus("mise_a_jour.developpement");
    const version = annoncee(m, storageDe(c).transaction!((db) => lireBase(db)).version);
    if (version === null) return refus("mise_a_jour.pas_de_version");
    if (await operationEnCours(m, lireEtat(m.dossier))) return refus("mise_a_jour.en_cours");
    if (isMaintenance() || existsSync(join(m.dataDir, "lama.db.restauration"))) return refus("mise_a_jour.restauration_en_cours");
    if (await m.sauvegardeEnCours()) return refus("mise_a_jour.sauvegarde_en_cours");
    ecrireDemande(m.dossier, version);
    await logAudit({ accountId: currentAccount(c).id, action: "mise_a_jour.demandee", target: version, ip: clientIp(c), now: nowOf(c) });
    return c.json({ ok: true, version });
  });

  // Mode (M-13) : réglage de l'administrateur, recopié dans le fichier lu la nuit par le service root.
  app.put("/api/mise-a-jour/mode", async (c) => {
    const formation = refusFormation(c);
    if (formation) return formation;
    const refused = requireConfirmation(c);
    if (refused) return refused;
    const m = envDe(c);
    if (!m) return c.json({ error: msg(c, "mise_a_jour.indisponible") }, 404);
    const { mode } = (await c.req.json().catch(() => ({}))) as { mode?: unknown };
    if (mode !== "manuel" && mode !== "automatique") return c.json({ error: msg(c, "reglage.mise_a_jour_mode") }, 400);
    const compte = currentAccount(c);
    await setSetting("mise_a_jour.mode", mode, compte.id, nowOf(c));
    // Mécanisme pas encore posé : la surveillance le recopie au démarrage qui suit sa pose (tâche 15).
    if (mecanismePose(m.dossier)) ecrireMode(m.dossier, mode);
    await logAudit({ accountId: compte.id, action: "mise_a_jour.mode", target: mode, ip: clientIp(c), now: nowOf(c) });
    return c.json({ ok: true, mode });
  });
}
