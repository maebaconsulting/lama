/** Client de l'API de gestion (même origine, cookie de session, en-tête de l'interface). */
export type EtatSalon = "actif" | "suspendu" | "essai";
export type SalonGestion = {
  id: string; nom: string; etat: EtatSalon; origines: string[]; cree_le: number; dernier_appel_le: number | null;
  version_offre: number | null; plages_generees_le: number | null; plages_a_jour: boolean; demandes_en_attente: number;
};

export class ErreurGestion extends Error {
  readonly statut: number;
  readonly code: string;
  /** Message de détail renvoyé par le relais (vide s'il n'y en a pas). */
  readonly detail: string;

  constructor(statut: number, code: string, detail = "") {
    super(code);
    this.name = "ErreurGestion";
    this.statut = statut;
    this.code = code;
    this.detail = detail;
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export function creerApiGestion(f: Fetch = (url, init) => fetch(url, init)) {
  // Heure du relais (en-tête `Date` de la dernière réponse) : les durées « il y a … » ne dépendent pas de l'horloge de l'opérateur.
  let heureRelais: number | null = null;
  async function appel<T>(methode: string, chemin: string, corps?: unknown): Promise<T> {
    const r = await f(`/gestion/api${chemin}`, {
      method: methode,
      credentials: "same-origin",
      headers: { "x-relais-gestion": "1", ...(corps === undefined ? {} : { "content-type": "application/json" }) },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
    const date = Date.parse(r.headers.get("date") ?? "");
    if (!Number.isNaN(date)) heureRelais = date;
    if (r.status === 204) return null as T;
    if (r.ok) return (await r.json()) as T;
    const e = (await r.json().catch(() => null)) as { erreur?: { code?: string; message?: string } } | null;
    throw new ErreurGestion(r.status, e?.erreur?.code ?? "autre", e?.erreur?.message ?? "");
  }
  return {
    /** Heure du relais d'après la dernière réponse, `null` si aucune n'a porté d'en-tête `Date`. */
    heureRelais: () => heureRelais,
    connexion: (motDePasse: string) => appel<null>("POST", "/connexion", { mot_de_passe: motDePasse }),
    deconnexion: () => appel<null>("POST", "/deconnexion"),
    salons: () => appel<{ salons: SalonGestion[] }>("GET", "/salons").then((r) => r.salons),
    creer: (id: string, nom: string) => appel<{ salon: SalonGestion; cle: string }>("POST", "/salons", { id, nom }),
    modifier: (id: string, m: { nom?: string; etat?: EtatSalon; origines?: string[] }) =>
      appel<{ salon: SalonGestion }>("PUT", `/salons/${encodeURIComponent(id)}`, m).then((r) => r.salon),
    remplacerCle: (id: string) => appel<{ cle: string }>("POST", `/salons/${encodeURIComponent(id)}/cle`).then((r) => r.cle),
    supprimer: (id: string, confirmation: string) => appel<null>("DELETE", `/salons/${encodeURIComponent(id)}`, { confirmation }),
  };
}

export const apiGestion = creerApiGestion();
