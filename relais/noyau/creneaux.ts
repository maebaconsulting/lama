import type { Disponibilites, NomDecision, Offre } from "./contrat.ts";
import { ajouterJours, enHeure, enMinutes, localDe } from "./temps.ts";

/**
 * Créneaux proposés à la cliente (contrat v1, « Règle de découpage ») : découpage des plages libres publiées
 * par lama, demandes en attente retirées aussitôt, capacité « Sans préférence », fraîcheur. Module pur.
 * Intervalles en minutes depuis minuit, fin exclusive.
 */

/** Plages de plus de deux heures : plus aucun créneau, rappel seulement (règle 5). */
export const FRAICHEUR_MS = 2 * 60 * 60 * 1000;

/** Ce que le calcul a besoin de savoir d'une demande reçue par l'application. */
export type DemandeActive = {
  id: string;
  type: "creneau" | "rappel";
  prestation: string;
  praticienne: string | null;
  date: string | null;
  debut: number | null;
  fin: number | null;
  accusee_le: number | null;
  decision: NomDecision | null;
  decidee_le: number | null;
};

export type Contexte = { offre: Offre | null; dispo: Disponibilites | null; demandes: DemandeActive[]; maintenant: number };
export type EtatVitrine = "ferme" | "rappel" | "ouvert";
export type Creneau = { heure: string; praticiennes: string[] };
export type Refus = "ferme" | "inconnue" | "rappel_seulement" | "indisponible";
type Intervalle = { start: number; end: number };

export function etatVitrine(ctx: Contexte): EtatVitrine {
  if (!ctx.offre || ctx.offre.prestations.length === 0) return "ferme";
  if (!ctx.dispo || ctx.maintenant - ctx.dispo.genere_le > FRAICHEUR_MS) return "rappel";
  return "ouvert";
}

/** Lama a enregistré (accusé) la demande avant de générer les plages : elles en tiennent déjà compte. */
function integree(d: DemandeActive, dispo: Disponibilites): boolean {
  return d.accusee_le !== null && d.accusee_le <= dispo.genere_le;
}

function situee(d: DemandeActive): d is DemandeActive & { date: string; debut: number; fin: number } {
  return d.type === "creneau" && d.date !== null && d.debut !== null && d.fin !== null;
}

/** Demande qui occupe encore son créneau : pas encore dans les plages, ni refusée ni déplacée (règle 3). */
function retenue(d: DemandeActive, dispo: Disponibilites): boolean {
  return situee(d) && !integree(d, dispo) && (d.decision === null || d.decision === "acceptee");
}

/** Demande déjà dans les plages puis refusée ou déplacée après leur génération : son créneau revient. */
function liberee(d: DemandeActive, dispo: Disponibilites): boolean {
  return situee(d) && d.praticienne !== null && integree(d, dispo)
    && (d.decision === "refusee" || d.decision === "autre_horaire") && d.decidee_le !== null && d.decidee_le > dispo.genere_le;
}

function union(liste: Intervalle[]): Intervalle[] {
  const out: Intervalle[] = [];
  for (const i of [...liste].sort((a, b) => a.start - b.start)) {
    const dernier = out.at(-1);
    if (dernier && i.start <= dernier.end) dernier.end = Math.max(dernier.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

function soustraire(base: Intervalle[], retraits: Intervalle[]): Intervalle[] {
  let reste = base;
  for (const r of retraits) {
    reste = reste.flatMap((b) => {
      if (r.end <= b.start || b.end <= r.start) return [b];
      const morceaux: Intervalle[] = [];
      if (b.start < r.start) morceaux.push({ start: b.start, end: r.start });
      if (r.end < b.end) morceaux.push({ start: r.end, end: b.end });
      return morceaux;
    });
  }
  return reste;
}

/** Plages d'une praticienne un jour : publiées, plus les créneaux libérés, moins ses demandes retenues. */
export function plagesEffectives(ctx: Contexte, praticienne: string, date: string): Intervalle[] {
  const dispo = ctx.dispo;
  if (!dispo) return [];
  const publiees = (dispo.plages[praticienne]?.[date] ?? []).map(([a, b]) => ({ start: enMinutes(a), end: enMinutes(b) }));
  const siennes = ctx.demandes.filter((d) => d.praticienne === praticienne && d.date === date);
  const rendues = siennes.filter((d) => liberee(d, dispo)).map((d) => ({ start: d.debut!, end: d.fin! }));
  const prises = siennes.filter((d) => retenue(d, dispo)).map((d) => ({ start: d.debut!, end: d.fin! }));
  return soustraire(union([...publiees, ...rendues]), prises);
}

/** Demande « sans préférence » retenue d'un jour, avec les praticiennes qui pourraient la prendre. */
type Noeud = { iv: Intervalle; candidates: string[] };

/**
 * Calcul d'une requête : plages effectives, praticiennes de chaque prestation et demandes « sans préférence »
 * de chaque jour (avec leurs candidates) sont gardées en mémoire le temps de la requête.
 */
function calcul(ctx: Contexte) {
  const offre = ctx.offre!;
  const dispo = ctx.dispo!;
  const memoPlages = new Map<string, Intervalle[]>();
  const plages = (p: string, date: string): Intervalle[] => {
    const cle = `${p}|${date}`;
    let v = memoPlages.get(cle);
    if (!v) {
      v = plagesEffectives(ctx, p, date);
      memoPlages.set(cle, v);
    }
    return v;
  };
  const libre = (p: string, date: string, iv: Intervalle) => plages(p, date).some((x) => x.start <= iv.start && iv.end <= x.end);
  const memoPratiquantes = new Map<string, string[]>();
  const pratiquantes = (prestation: string): string[] => {
    let v = memoPratiquantes.get(prestation);
    if (!v) {
      v = offre.praticiennes.filter((p) => p.prestations.includes(prestation)).map((p) => p.id);
      memoPratiquantes.set(prestation, v);
    }
    return v;
  };
  const candidates = (prestation: string, date: string, x: Intervalle) => pratiquantes(prestation).filter((p) => libre(p, date, x));
  // Une demande sans aucune praticienne libre (plages republiées sans elle) ne compte pas : lama arbitre.
  const memoNoeuds = new Map<string, Noeud[]>();
  const noeuds = (date: string): Noeud[] => {
    let v = memoNoeuds.get(date);
    if (!v) {
      v = ctx.demandes
        .filter((d) => d.praticienne === null && d.date === date && retenue(d, dispo))
        .map((d) => {
          const x = { start: d.debut!, end: d.fin! };
          return { iv: x, candidates: candidates(d.prestation, date, x) };
        })
        .filter((n) => n.candidates.length > 0);
      memoNoeuds.set(date, v);
    }
    return v;
  };
  return { plages, libre, pratiquantes, candidates, noeuds };
}

/** Au-delà de ce nombre de demandes « sans préférence » liées entre elles, le créneau est refusé par prudence. */
const COMPOSANTE_MAX = 12;
/** Budget d'essais de placement par créneau examiné (borne le temps de calcul) : épuisé, le créneau est refusé. */
export const ESSAIS_MAX = 20_000;

const chevauche = (a: Intervalle, b: Intervalle) => a.start < b.end && b.start < a.end;

/**
 * Règle 4, exacte : on forme la composante connexe (par chevauchement) qui contient la nouvelle demande parmi
 * les demandes « sans préférence » retenues du jour. Le créneau est accepté si toutes les demandes de cette
 * composante peuvent être affectées à une praticienne qui pratique leur prestation et est libre sur tout leur
 * intervalle, sans que deux demandes qui se chevauchent aient la même praticienne (recherche par retour arrière).
 * Une composante de plus de 12 demandes est refusée, de même qu'une recherche qui épuise `ESSAIS_MAX` essais.
 * Une demande sans aucune praticienne libre (plages republiées sans elle) ne compte pas : lama arbitre.
 *
 * La composante ne dépend que de l'intervalle : elle est formée une fois, puis la fonction rendue fait la
 * recherche pour une praticienne demandée (ou `null`), chacune avec son propre budget d'essais.
 */
function accueillable(c: ReturnType<typeof calcul>, prestation: string, date: string, iv: Intervalle): (praticienne: string | null) => boolean {
  const toutes = c.candidates(prestation, date, iv);
  if (toutes.length === 0) return () => false;
  const autres: Noeud[] = [];
  const restants = new Set(c.noeuds(date));
  const fronts: Intervalle[] = [iv];
  for (let i = 0; i < fronts.length && fronts.length <= COMPOSANTE_MAX; i++) {
    for (const n of restants) {
      if (chevauche(fronts[i], n.iv)) {
        autres.push(n);
        fronts.push(n.iv);
        restants.delete(n);
      }
    }
  }
  if (autres.length + 1 > COMPOSANTE_MAX) return () => false;
  return (praticienne) => {
    const nouvelle = toutes.filter((p) => praticienne === null || p === praticienne);
    if (nouvelle.length === 0) return false;
    // Tri stable : la nouvelle demande reste devant les demandes de même début, comme dans l'ordre de formation.
    const composante: Noeud[] = [{ iv, candidates: nouvelle }, ...autres].sort((a, b) => a.iv.start - b.iv.start);
    if (!assezDePraticiennes(composante)) return false;
    const choisies: string[] = [];
    let essais = 0;
    const placer = (i: number): boolean => {
      if (i === composante.length) return true;
      for (const p of composante[i].candidates) {
        if (++essais > ESSAIS_MAX) return false;
        const pris = choisies.slice(0, i).some((q, j) => q === p && chevauche(composante[j].iv, composante[i].iv));
        if (pris) continue;
        choisies[i] = p;
        if (placer(i + 1)) return true;
      }
      return false;
    };
    return placer(0);
  };
}

/**
 * Condition nécessaire, vérifiée avant la recherche sans en changer le résultat : à chaque début de demande, les
 * demandes en cours à cet instant se chevauchent toutes et demandent autant de praticiennes distinctes. S'il y a
 * moins de candidates que de demandes, aucune affectation n'existe : refus immédiat, sans épuiser le budget d'essais.
 */
function assezDePraticiennes(composante: Noeud[]): boolean {
  for (const n of composante) {
    const enCours = composante.filter((m) => m.iv.start <= n.iv.start && n.iv.start < m.iv.end);
    if (new Set(enCours.flatMap((m) => m.candidates)).size < enCours.length) return false;
  }
  return true;
}

/**
 * Créneaux d'une prestation un jour, dans l'ordre des heures. Au plus `max` créneaux ; avec `toutes` faux, chaque
 * créneau ne cite que la première praticienne qui peut l'accueillir (il suffit de savoir qu'il est libre).
 */
function parcourir(ctx: Contexte, c: ReturnType<typeof calcul>, prestation: string, date: string, praticienne: string | null, max: number, toutes: boolean): Creneau[] {
  const offre = ctx.offre!;
  const dispo = ctx.dispo!;
  const s = offre.prestations.find((x) => x.id === prestation);
  if (!s || date < dispo.du || date > dispo.au) return [];
  // Minute entamée comptée : à 08:00:30 avec 120 min de délai, le premier début possible est 10:01.
  const limite = localDe(ctx.maintenant + dispo.delai_minimal * 60_000 + 59_999, offre.institut.fuseau);
  if (date < limite.date) return [];
  const plusTot = date === limite.date ? limite.minutes : 0;
  const qui = c.pratiquantes(prestation).filter((p) => praticienne === null || p === praticienne);
  const debuts = new Set<number>();
  for (const p of qui) {
    for (const pl of c.plages(p, date)) {
      for (let h = Math.ceil(Math.max(pl.start, plusTot) / dispo.pas) * dispo.pas; h + s.duree <= pl.end; h += dispo.pas) debuts.add(h);
    }
  }
  const out: Creneau[] = [];
  for (const h of [...debuts].sort((a, b) => a - b)) {
    if (out.length >= max) break;
    const peut = accueillable(c, prestation, date, { start: h, end: h + s.duree });
    let libres: string[];
    if (toutes) libres = qui.filter((p) => peut(p));
    else {
      const premiere = qui.find((p) => peut(p));
      libres = premiere === undefined ? [] : [premiere];
    }
    if (libres.length) out.push({ heure: enHeure(h), praticiennes: libres });
  }
  return out;
}

/** Créneaux d'une prestation un jour, avec pour chaque heure les praticiennes qui peuvent l'accueillir. */
export function creneaux(ctx: Contexte, prestation: string, date: string, praticienne: string | null): Creneau[] {
  if (etatVitrine(ctx) !== "ouvert") return [];
  return parcourir(ctx, calcul(ctx), prestation, date, praticienne, Infinity, true);
}

/**
 * Jours qui ont au moins un créneau, et les trois premiers créneaux (« Prochaines disponibilités »).
 * Chaque jour s'arrête au premier créneau libre (aux trois premiers tant que « prochains » n'est pas rempli) :
 * même résultat que `creneaux` jour par jour, pour une fraction du calcul (GET /jours).
 */
export function resume(ctx: Contexte, prestation: string, praticienne: string | null): { jours: string[]; prochains: { date: string; heure: string }[] } {
  const jours: string[] = [];
  const prochains: { date: string; heure: string }[] = [];
  if (etatVitrine(ctx) !== "ouvert") return { jours, prochains };
  const dispo = ctx.dispo!;
  const c = calcul(ctx);
  for (let d = dispo.du; d <= dispo.au; d = ajouterJours(d, 1)) {
    const liste = parcourir(ctx, c, prestation, d, praticienne, Math.max(1, 3 - prochains.length), false);
    if (!liste.length) continue;
    jours.push(d);
    for (const x of liste) if (prochains.length < 3) prochains.push({ date: d, heure: x.heure });
  }
  return { jours, prochains };
}

/** Raison de refuser une demande déposée, ou `null` si elle est recevable (codes du contrat). */
export function refusDemande(ctx: Contexte, d: { type: "creneau" | "rappel"; prestation: string; praticienne: string | null; date: string | null; heure: string | null }): Refus | null {
  const etat = etatVitrine(ctx);
  if (etat === "ferme") return "ferme";
  const offre = ctx.offre!;
  const s = offre.prestations.find((x) => x.id === d.prestation);
  if (!s) return "inconnue";
  if (d.praticienne !== null) {
    const p = offre.praticiennes.find((x) => x.id === d.praticienne);
    if (!p || !p.prestations.includes(s.id)) return "inconnue";
  }
  if (d.type === "rappel") return null;
  if (etat === "rappel") return "rappel_seulement";
  if (d.date === null || d.heure === null) return "indisponible";
  return creneaux(ctx, d.prestation, d.date, d.praticienne).some((c) => c.heure === d.heure) ? null : "indisponible";
}
