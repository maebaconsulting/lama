import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import { logAudit } from "../audit.ts";
import { clientIp, currentAccount } from "../auth/middleware.ts";
import { nowOf } from "../clock.ts";
import { get, query } from "../db.ts";
import { msg } from "../messages.ts";
import { publish } from "../realtime.ts";
import { getSetting } from "../settings.ts";
import type { Database, StorageBinding } from "../storage.ts";
import { dateValide } from "../../shared/horaires.ts";
import { readMessageSettings } from "../whatsapp/rendez-vous.ts";
import { clore, confirmer, ISSUES, MOTIFS, proposerAutreHoraire, refuserDemande, rendezVousDepuisAutreHoraire, type ContexteAction, type Issue } from "./actions.ts";
import { relancerEnLigne } from "./boucle.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = Context<any>;
const storageOf = (c: Ctx) => c.env.STORAGE as StorageBinding;

const Fiche = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("trouvee") }),
  z.object({ mode: z.literal("autre"), client_id: z.number().int().positive() }),
  z.object({ mode: z.literal("nouvelle") }),
]);
const Horaire = z.object({ date: z.string(), heure: z.string(), staff_id: z.number().int().positive() });
const RendezVous = Horaire.extend({ service_id: z.number().int().positive().optional(), fiche: Fiche, allow_conflict: z.boolean().optional() });
const Confirmer = z.object({ staff_id: z.number().int().positive(), fiche: Fiche, allow_conflict: z.boolean().optional() });
const Refuser = z.object({ motif: z.enum(MOTIFS), message: z.string().max(500).optional() });
const Clore = z.object({ issue: z.enum(ISSUES), rendez_vous: RendezVous.optional() });

const A_TRAITER = "('a_confirmer', 'en_conflit', 'a_rappeler')";
const TRENTE_JOURS_MS = 30 * 86_400_000;
const VUE = `SELECT d.*, sd.name AS staff_demande_nom, s.name AS staff_nom, sa.name AS autre_staff_nom, c.name AS client_nom, a.display_name AS decidee_par_nom
  FROM demandes_en_ligne d LEFT JOIN staff sd ON sd.id = d.staff_demande_id LEFT JOIN staff s ON s.id = d.staff_id
  LEFT JOIN staff sa ON sa.id = d.autre_staff_id LEFT JOIN clients c ON c.id = d.client_id LEFT JOIN accounts a ON a.id = d.decidee_par`;

/** Demande vue par l'écran : souhait lu, décision remplacée par « encore à transmettre au relais ». */
function vue(l: Record<string, unknown>): Record<string, unknown> {
  const { decision, decision_envoyee_le, souhait, ...reste } = l;
  return { ...reste, souhait: typeof souhait === "string" ? JSON.parse(souhait) : null, decision_attente: decision !== null && decision_envoyee_le === null };
}

type Action<T> = (db: Database, id: number, entree: T, ctx: ContexteAction) => Issue<unknown>;

/** Action de la réception : corps contrôlé, transaction, journal, signal temps réel, décision transmise au plus vite. */
async function agir<T>(c: Ctx, o: { action: string; corps: z.ZodType<T>; faire: Action<T> }) {
  const lu = o.corps.safeParse(await c.req.json().catch(() => null));
  if (!lu.success) return c.json({ error: msg(c, "requete.invalide", { champ: lu.error.issues[0]?.path.join(".") || "?" }) }, 400);
  const id = Number(c.req.param("id"));
  const compte = currentAccount(c);
  const messages = await readMessageSettings();
  const maintenant = nowOf(c);
  const issue = storageOf(c).transaction!((db) => o.faire(db, id, lu.data, { maintenant, compte: compte.id, messages }));
  if (!issue.ok) return c.json({ error: msg(c, issue.cle, issue.valeurs), ...(issue.conflits ? { conflicts: issue.conflits } : {}) }, issue.statut);
  await logAudit({ accountId: compte.id, action: o.action, target: String(id), ip: clientIp(c), now: maintenant });
  publish({ resource: "appointments" });
  relancerEnLigne();
  return c.json({ ok: true, ...(issue.valeur as object) });
}

/** Écran « Demandes en ligne » (spec § 4.5) : réception et gérante ; l'agenda, aussi la praticienne (`auth/permissions.ts`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountDemandesRoutes(app: OpenAPIHono<any>): void {
  app.get("/api/demandes-en-ligne", async (c) => {
    const toutes = c.req.query("filtre") === "toutes";
    const lignes = toutes
      ? await query<Record<string, unknown>>(`${VUE} WHERE d.etat IN ${A_TRAITER} OR d.recue_le >= ? ORDER BY d.recue_le, d.id`, [nowOf(c) - TRENTE_JOURS_MS])
      : await query<Record<string, unknown>>(`${VUE} WHERE d.etat IN ${A_TRAITER} ORDER BY d.recue_le, d.id`);
    return c.json({ demandes: lignes.map(vue) });
  });

  app.get("/api/demandes-en-ligne/compte", async (c) => {
    const n = await get<{ n: number }>(`SELECT COUNT(*) AS n FROM demandes_en_ligne WHERE etat IN ${A_TRAITER}`);
    return c.json({ active: (await getSetting<boolean>("en_ligne.active")) === true, a_traiter: n?.n ?? 0 });
  });

  // Agenda : cartes « En ligne · à confirmer » ; la praticienne n'y voit qu'un créneau réservé, sans nom ni prestation (spec § 4.4).
  app.get("/api/demandes-en-ligne/agenda", async (c) => {
    const date = c.req.query("date") ?? "";
    if (!dateValide(date)) return c.json({ error: msg(c, "vente.date") }, 400);
    const lignes = await query<{ id: number; staff_id: number; start_time: string; end_time: string; cliente_nom: string; prestation_nom: string; prestation_nom_en: string; sans_preference: number }>(
      "SELECT id, staff_id, start_time, end_time, cliente_nom, prestation_nom, prestation_nom_en, sans_preference FROM demandes_en_ligne WHERE date = ? AND etat = 'a_confirmer' AND staff_id IS NOT NULL ORDER BY start_time, id",
      [date],
    );
    const praticienne = currentAccount(c).role === "practitioner";
    return c.json({ demandes: lignes.map((l) => (praticienne ? { staff_id: l.staff_id, start_time: l.start_time, end_time: l.end_time } : l)) });
  });

  app.post("/api/demandes-en-ligne/:id{[0-9]+}/confirmer", (c) => agir(c, { action: "en_ligne.confirmation", corps: Confirmer, faire: confirmer }));
  app.post("/api/demandes-en-ligne/:id{[0-9]+}/autre-horaire", (c) => agir(c, { action: "en_ligne.autre_horaire", corps: Horaire, faire: proposerAutreHoraire }));
  app.post("/api/demandes-en-ligne/:id{[0-9]+}/rendez-vous", (c) => agir(c, { action: "en_ligne.rendez_vous", corps: RendezVous, faire: rendezVousDepuisAutreHoraire }));
  app.post("/api/demandes-en-ligne/:id{[0-9]+}/refuser", (c) => agir(c, { action: "en_ligne.refus", corps: Refuser, faire: refuserDemande }));
  app.post("/api/demandes-en-ligne/:id{[0-9]+}/clore", (c) => agir(c, { action: "en_ligne.cloture", corps: Clore, faire: clore }));
}
