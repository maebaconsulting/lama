import { type Lang, message, type MessageKey } from "../messages.ts";
import { clientRelais, DELAI_MS, ErreurDelai, type Fetch, type OptionsAppel, type ReponseRelais } from "./client-relais.ts";

/**
 * Outil de vérification du contrat v1 (spec du 16/10/2026 § 2) : joue le contrat contre une application en
 * mode essai et s'arrête au premier écart. Il publie une offre d'essai puis une offre vide pour ce salon :
 * jamais contre un salon en service (la deuxième étape exige le mode essai).
 */
export type Point = { nom: string; ok: boolean; detail?: string };

class Ecart extends Error {}

function exiger(condition: boolean, detail: string): asserts condition {
  if (!condition) throw new Ecart(detail);
}

const FUSEAU = "Africa/Douala";
const HEURE_MS = 60 * 60 * 1000;

function dateLocale(instant: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
}

function plusJours(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const JOURNEE = [["09:00", "20:00"]];
const SOIREE = [["09:30", "22:00"]];
/** Thème et horaires d'essai (champs facultatifs du 18/10/2026) : accent foncé sur un fond ivoire, contraste largement suffisant. */
const THEME_ESSAI = { fond: "#F3EDE3", accent: "#141312", police: "elegante" };
const HORAIRES_ESSAI = { lun: JOURNEE, mar: JOURNEE, mer: JOURNEE, jeu: JOURNEE, ven: SOIREE, sam: SOIREE, dim: [] };

export async function verifierRelais(o: {
  adresse: string; institut: string; cle: string; fetch?: Fetch; maintenant?: () => number; journal?: (p: Point) => void; lang?: Lang; delai?: number;
}): Promise<{ ok: boolean; points: Point[] }> {
  const maintenant = o.maintenant ?? Date.now;
  const relais = clientRelais({ adresse: o.adresse, institut: o.institut, cle: o.cle, fetch: o.fetch, maintenant, delai: o.delai });
  const lang = o.lang ?? "fr";
  const t = (cle: string, valeurs: Record<string, string | number> = {}) => message(lang, `verif.${cle}` as MessageKey, valeurs);
  const t0 = maintenant();
  const aujourdhui = dateLocale(t0);
  const J = plusJours(aujourdhui, 3);
  const PROCHE = plusJours(aujourdhui, 1);
  const V = t0;
  const texte = (fr: string, en: string) => ({ fr, en });
  const offre = (version: number, vide = false, complete = false) => ({
    version,
    institut: {
      nom: "Institut d'essai", fuseau: FUSEAU, telephone: "+237600000000", logo: null,
      devise: { code: "XAF", decimales: 0, symbole: "F", position: "apres" }, langues: ["fr", "en"], texte_donnees: texte("Essai.", "Test."),
      ...(complete ? { theme: THEME_ESSAI, horaires: HORAIRES_ESSAI } : {}),
    },
    prestations: vide ? [] : [
      { id: "s60", nom: texte("Soin d'essai", "Test care"), categorie: texte("Essai", "Test"), description: texte("", ""), duree: 60, prix: 10000 },
      { id: "s30", nom: texte("Pose d'essai", "Test polish"), categorie: texte("Essai", "Test"), description: texte("", ""), duree: 30, prix: 5000 },
    ],
    praticiennes: vide ? [] : [
      { id: "p1", prenom: "Une", photo: null, prestations: ["s60", "s30"] },
      { id: "p2", prenom: "Deux", photo: null, prestations: ["s60"] },
    ],
  });
  const dispo = (version: number, genereLe: number) => ({
    version, genere_le: genereLe, du: aujourdhui, au: plusJours(aujourdhui, 5), pas: 15, delai_minimal: 2880,
    plages: { p1: { [PROCHE]: [["09:00", "12:00"]], [J]: [["09:00", "12:00"]] }, p2: { [J]: [["09:00", "10:00"]] } },
  });
  const cliente = { nom: "Cliente d'essai", telephone: "+237699000000", langue: "fr" };
  const creneau = (prestation: string, praticienne: string | null, date: string, heure: string) =>
    ({ type: "creneau", prestation, praticienne, date, heure, souhait: null, cliente, note: "note d'essai" });
  const rappel = { type: "rappel", prestation: "s60", praticienne: null, date: null, heure: null, souhait: { jours: ["lun"], moments: ["matin"], precision: "" }, cliente, note: "" };
  const ids: Record<string, string> = {};

  const statut = async (methode: "GET" | "PUT" | "POST", chemin: string, corps: unknown, attendu: number, opt?: OptionsAppel): Promise<ReponseRelais> => {
    const r = await relais.appeler(methode, chemin, corps, opt);
    exiger(r.statut === attendu, t("d_statut", { attendu, recu: r.statut }));
    return r;
  };
  /** Dépôt par la route d'essai : 201 attendu (identifiant gardé sous `nom`), ou 409 avec le code attendu. */
  const deposer = async (corps: unknown, attendu: 201 | string, nom?: string) => {
    const r = await relais.appeler("POST", "/essai/demande", corps);
    exiger(r.statut !== 404, t("d_route_essai"));
    if (attendu === 201) {
      exiger(r.statut === 201 && typeof r.json?.id === "string", t("d_statut", { attendu: 201, recu: r.statut }));
      if (nom) ids[nom] = r.json.id;
    } else {
      exiger(r.statut === 409 && r.json?.erreur?.code === attendu, t("d_code", { code: attendu, statut: r.statut, recu: r.json?.erreur?.code ?? "" }));
    }
  };
  const solder = async () => {
    for (let tour = 0; tour < 50; tour++) {
      const demandes = ((await statut("GET", "/demandes?limite=200", undefined, 200)).json?.demandes ?? []) as { id: string }[];
      if (!demandes.length) return;
      for (const d of demandes) {
        await statut("POST", `/demandes/${encodeURIComponent(d.id)}/decision`, { decision: "refusee" }, 200);
        await statut("POST", `/demandes/${encodeURIComponent(d.id)}/accuse`, undefined, 200);
      }
    }
    throw new Ecart(t("d_inepuisable"));
  };
  const versions = async (champ: "version_offre" | "version_disponibilites", attendue: number) => {
    const e = await statut("GET", "/etat", undefined, 200);
    exiger(e.json?.[champ] === attendue, t("d_version", { champ, attendue, recue: e.json?.[champ] ?? "" }));
  };

  /** Clé du nom de l'étape (`verif.<clé>`) et sa vérification. */
  const etapes: [string, () => Promise<unknown>][] = [
    ["etat", async () => exiger((await statut("GET", "/etat", undefined, 200)).json?.contrat === "v1", t("d_contrat"))],
    ["essai", async () => exiger((await statut("GET", "/etat", undefined, 200)).json?.mode_essai === true, t("d_pas_essai"))],
    ["signature", () => statut("GET", "/etat", undefined, 401, { cle: `${o.cle}x` })],
    ["horodatage", () => statut("GET", "/etat", undefined, 401, { horodatage: maintenant() - 6 * 60 * 1000 })],
    ["rejeu", async () => {
      // Le même appel signé deux fois : la seconde doit être refusée (une signature n'est acceptée qu'une fois).
      const h = maintenant() - 60_000;
      await statut("GET", "/etat", undefined, 200, { horodatage: h });
      await statut("GET", "/etat", undefined, 401, { horodatage: h });
    }],
    ["salon_inconnu", () => statut("GET", "/etat", undefined, 401, { institut: `${o.institut}-inconnu` })],
    ["solde", solder],
    ["offre_publiee", async () => { await statut("PUT", "/offre", offre(V), 200); await versions("version_offre", V); }],
    ["offre_invalide", () => statut("PUT", "/offre", { version: V + 1 }, 422)],
    ["offre_ancienne", () => statut("PUT", "/offre", offre(V - 1), 409)],
    ["offre_complete", async () => { await statut("PUT", "/offre", offre(V + 1, false, true), 200); await versions("version_offre", V + 1); }],
    ["plages_publiees", async () => { await statut("PUT", "/disponibilites", dispo(V, t0), 200); await versions("version_disponibilites", V); }],
    ["plages_anciennes", () => statut("PUT", "/disponibilites", dispo(V - 1, t0), 409)],
    ["decoupage_pas", () => deposer(creneau("s60", "p1", J, "09:10"), "indisponible")],
    ["decoupage_plage", () => deposer(creneau("s60", "p1", J, "11:15"), "indisponible")],
    ["decoupage_praticienne", () => deposer(creneau("s30", "p2", J, "09:00"), "inconnue")],
    ["delai_minimal", () => deposer(creneau("s60", "p1", PROCHE, "09:00"), "indisponible")],
    ["accepte_retire", async () => {
      await deposer(creneau("s60", "p1", J, "10:00"), 201, "A");
      await deposer(creneau("s60", "p1", J, "10:30"), "indisponible");
      await deposer(creneau("s60", "p1", J, "11:00"), 201, "B");
    }],
    ["sans_preference", async () => {
      await deposer(creneau("s60", null, J, "09:00"), 201, "C");
      await deposer(creneau("s60", null, J, "09:00"), 201, "D");
      await deposer(creneau("s60", null, J, "09:00"), "indisponible");
      await deposer(creneau("s60", "p2", J, "09:00"), "indisponible");
    }],
    ["refus_rendu", async () => {
      await statut("POST", `/demandes/${encodeURIComponent(ids.A)}/decision`, { decision: "refusee" }, 200);
      await deposer(creneau("s60", "p1", J, "10:00"), 201, "E");
    }],
    ["releve", async () => {
      const liste = ((await statut("GET", "/demandes", undefined, 200)).json?.demandes ?? []) as { id: string; curseur: string }[];
      exiger(JSON.stringify(liste.map((d) => d.id)) === JSON.stringify(["A", "B", "C", "D", "E"].map((k) => ids[k])), t("d_ordre"));
      const suite = await statut("GET", `/demandes?apres=${encodeURIComponent(liste[2].curseur)}&limite=1`, undefined, 200);
      exiger(suite.json?.demandes?.length === 1 && suite.json.demandes[0].id === ids.D && suite.json.curseur === liste[3].curseur, t("d_curseur"));
      const fin = await statut("GET", `/demandes?apres=${encodeURIComponent(liste[4].curseur)}`, undefined, 200);
      exiger(fin.json?.demandes?.length === 0, t("d_apres_dernier"));
    }],
    ["rappel", () => deposer(rappel, 201, "F")],
    ["accuse", async () => {
      await statut("POST", `/demandes/${encodeURIComponent(ids.A)}/accuse`, undefined, 200);
      const brut = await statut("GET", `/essai/demande/${encodeURIComponent(ids.A)}`, undefined, 200);
      exiger(brut.json?.cliente === null && brut.json?.note === null, t("d_efface"));
      const liste = ((await statut("GET", "/demandes", undefined, 200)).json?.demandes ?? []) as { id: string }[];
      exiger(!liste.some((d) => d.id === ids.A), t("d_encore_relevee"));
      await statut("POST", `/demandes/${encodeURIComponent(ids.A)}/accuse`, undefined, 200);
      await statut("POST", "/demandes/d_inconnue_essai/accuse", undefined, 404);
    }],
    ["decisions", async () => {
      const chemin = `/demandes/${encodeURIComponent(ids.B)}/decision`;
      await statut("POST", chemin, { decision: "acceptee" }, 200);
      await statut("POST", chemin, { decision: "acceptee" }, 200);
      await statut("POST", chemin, { decision: "refusee", message: texte("Essai.", "Test.") }, 200);
      const brut = await statut("GET", `/essai/demande/${encodeURIComponent(ids.B)}`, undefined, 200);
      exiger(brut.json?.decision?.decision === "refusee", t("d_remplace"));
      await statut("POST", "/demandes/d_inconnue_essai/decision", { decision: "refusee" }, 404);
      await statut("POST", chemin, { decision: "autre_horaire" }, 422);
    }],
    ["en_attente", async () => {
      const e = await statut("GET", "/etat", undefined, 200);
      exiger(e.json?.demandes_en_attente === 5, t("d_attente", { recu: e.json?.demandes_en_attente ?? "" }));
    }],
    ["fraicheur", async () => {
      await statut("PUT", "/disponibilites", dispo(V + 1, t0 - 3 * HEURE_MS), 200);
      await deposer(creneau("s60", null, J, "09:15"), "rappel_seulement");
      await deposer(rappel, 201, "G");
    }],
    ["offre_vide", async () => {
      await statut("PUT", "/offre", offre(V + 2, true), 200);
      await deposer(rappel, "ferme");
    }],
    ["nettoyage", solder],
  ];

  const points: Point[] = [];
  for (const [cle, faire] of etapes) {
    const nom = t(cle);
    let point: Point;
    try {
      await faire();
      point = { nom, ok: true };
    } catch (e) {
      const detail = e instanceof Ecart ? e.message
        : e instanceof ErreurDelai ? t("d_delai", { secondes: Math.round((o.delai ?? DELAI_MS) / 100) / 10 })
        : t("erreur", { detail: e instanceof Error ? e.message : String(e) });
      point = { nom, ok: false, detail };
    }
    points.push(point);
    o.journal?.(point);
    if (!point.ok) return { ok: false, points };
  }
  return { ok: true, points };
}
