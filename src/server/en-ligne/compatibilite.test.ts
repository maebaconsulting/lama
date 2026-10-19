import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { dispoEssai, offreEssai } from "../../../relais/essais/donnees.ts";
import { appelSigne, relaisEssai } from "../../../relais/essais/relais.ts";
import { cleEtatSuivi } from "../../../relais/public/parcours.ts";
import { firstName } from "../whatsapp/textes.ts";
import { DemandeRelais } from "./demandes.ts";

/**
 * Compatibilité pendant la mise à jour : un relais neuf avec un lama ancien, et l'inverse. Le lama ancien
 * est simulé par son schéma d'avant le 18/10/2026 (cliente sans prénom) et par des décisions sans `issue`.
 */
const ClienteAncienne = z.object({ nom: z.string().trim().min(1).max(120), telephone: z.string().regex(/^\+[1-9]\d{6,14}$/), langue: z.enum(["fr", "en"]) });
const DemandeLamaAncien = DemandeRelais.extend({ cliente: ClienteAncienne });

async function relaisPublie() {
  const r = await relaisEssai();
  const appel = (methode: string, chemin: string, corps?: unknown) => appelSigne(r.app, r.cles.eclat, "eclat", methode, chemin, corps);
  assert.equal((await appel("PUT", "/lama/v1/offre", offreEssai(1))).statut, 200);
  assert.equal((await appel("PUT", "/lama/v1/disponibilites", dispoEssai({ p1: { "2026-10-21": [["09:00", "12:00"]] } }))).statut, 200);
  const suivi = async (jeton: string) => (await (await r.app.request("/api/eclat/suivi", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jeton }),
  })).json()) as { etat: "traitee"; issue?: "sans_suite" | null };
  return { appel, suivi };
}

const RAPPEL = { type: "rappel", prestation: "s60", praticienne: null, date: null, heure: null, souhait: { jours: ["sam"], moments: ["matin"], precision: "" }, note: "" };

test("relais neuf, lama ancien : la demande avec prénom se lit sans lui, et le nom complet donne encore le bon prénom", async () => {
  const { appel } = await relaisPublie();
  assert.equal((await appel("POST", "/lama/v1/essai/demande", { ...RAPPEL, cliente: { prenom: "Bertille", nom: "Bertille Essai", telephone: "+237690000101", langue: "fr" } })).statut, 201);
  const [releve] = (await appel("GET", "/lama/v1/demandes")).json.demandes;
  const ancien = DemandeLamaAncien.safeParse(releve);
  assert.ok(ancien.success, JSON.stringify(ancien.error?.issues));
  assert.equal(firstName(ancien.data.cliente.nom), "Bertille", "un lama ancien prend le premier mot : c'est bien le prénom");
  const neuf = DemandeRelais.parse(releve);
  assert.equal(neuf.cliente.prenom, "Bertille");
});

test("relais neuf, lama ancien : décision sans issue, la page de suivi garde son texte", async () => {
  const { appel, suivi } = await relaisPublie();
  const { id, jeton } = (await appel("POST", "/lama/v1/essai/demande", { ...RAPPEL, cliente: { nom: "Essai Bertille", telephone: "+237690000202", langue: "fr" } })).json;
  assert.equal((await appel("POST", `/lama/v1/demandes/${id}/decision`, { decision: "traitee", horaire: null, message: null })).statut, 200);
  const s = await suivi(jeton);
  assert.deepEqual([s.etat, s.issue, cleEtatSuivi(s)], ["traitee", null, "suivi.traitee"]);
});

test("relais ancien, lama neuf : demande sans prénom lue, prénom absent ; décision avec issue acceptée par un schéma qui l'ignore", () => {
  const sansPrenom = DemandeRelais.parse({
    id: "d_1", curseur: "000001", recue_le: 1, ...RAPPEL, cliente: { nom: "Essai Bertille", telephone: "+237690000202", langue: "fr" }, acompte: null,
  });
  assert.equal(sansPrenom.cliente.prenom, undefined);
  // Décision d'un relais ancien : objet zod non strict, sans `issue` ; le champ envoyé par un lama neuf est retiré, jamais refusé.
  const DecisionAncienne = z.object({
    decision: z.enum(["acceptee", "autre_horaire", "refusee", "traitee"]),
    horaire: z.object({ date: z.string(), heure: z.string(), praticienne: z.string() }).nullable().default(null),
    message: z.object({ fr: z.string(), en: z.string() }).nullable().default(null),
  });
  const lue = DecisionAncienne.safeParse({ decision: "traitee", horaire: null, message: null, issue: "sans_suite" });
  assert.ok(lue.success);
  assert.equal("issue" in lue.data, false);
  assert.equal(cleEtatSuivi({ etat: "traitee" }), "suivi.traitee", "page d'un relais ancien : pas d'issue, ancien texte");
});
