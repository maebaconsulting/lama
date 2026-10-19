import type { Creneau, Resume, Suivi, Vitrine } from "./parcours.ts";
import type { Lang } from "./textes.ts";

/** Refus du serveur : statut HTTP et code d'erreur (`indisponible`, `trop_de_demandes`…), « autre » si illisible. */
export class ErreurApi extends Error {
  readonly statut: number;
  readonly code: string;

  constructor(statut: number, code: string) {
    super(code);
    this.name = "ErreurApi";
    this.statut = statut;
    this.code = code;
  }
}

export type DemandeEnvoyee = {
  type: "creneau" | "rappel"; prestation: string; praticienne: string | null; date: string | null; heure: string | null;
  souhait: { jours: string[]; moments: string[]; precision: string } | null;
  cliente: { prenom?: string; nom: string; telephone: string; langue: Lang }; note: string; accord: true; piege: string; turnstile?: string;
};

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

async function lire<T>(r: Response): Promise<T> {
  if (r.ok) {
    try {
      return (await r.json()) as T;
    } catch {
      throw new ErreurApi(r.status, "autre");
    }
  }
  const corps = (await r.json().catch(() => null)) as { erreur?: { code?: string } } | null;
  throw new ErreurApi(r.status, corps?.erreur?.code ?? "autre");
}

function parametres(o: Record<string, string | null>): string {
  return new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => e[1] !== null)).toString();
}

/** Appels de la page à l'API publique du relais pour un salon (même origine). */
export function creerApi(salon: string, f: Fetch = (url, init) => fetch(url, init)) {
  const racine = `/api/${encodeURIComponent(salon)}`;
  return {
    vitrine: () => f(`${racine}/vitrine`).then((r) => lire<Vitrine>(r)),
    jours: (prestation: string, praticienne: string | null) => f(`${racine}/jours?${parametres({ prestation, praticienne })}`).then((r) => lire<Resume>(r)),
    creneaux: (prestation: string, date: string, praticienne: string | null) =>
      f(`${racine}/creneaux?${parametres({ prestation, date, praticienne })}`).then((r) => lire<{ creneaux: Creneau[] }>(r)),
    envoyer: (d: DemandeEnvoyee) =>
      f(`${racine}/demandes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d) }).then((r) => lire<{ jeton: string; hors_horaires?: boolean }>(r)),
    // Le jeton voyage dans le corps (POST), jamais dans l'adresse, donc jamais dans les journaux.
    suivi: (jeton: string) =>
      f(`${racine}/suivi`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jeton }) }).then((r) => lire<Suivi>(r)),
  };
}

/** Appels du salon de la page : liaison vivante, fixée une fois par `choisirSalon` (main.tsx) avant tout appel. */
export let api = creerApi("");

export function choisirSalon(salon: string): void {
  api = creerApi(salon);
}
