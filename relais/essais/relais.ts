import { DatabaseSync } from "node:sqlite";
import { creerApp, type Config, type Dependances } from "../app.ts";
import type { EtatSalon } from "../noyau/salon.ts";
import { signer } from "../noyau/signature.ts";
import { baseSqlite, migrerSqlite } from "../stockage/sqlite.ts";
import { Salons } from "../stockage/salons.ts";
import { MAINTENANT } from "./donnees.ts";

/** Relais d'essai pour les tests : base en mémoire, deux salons (`eclat`, en essai par défaut, et `voisin`, actif). */
export const MAITRE = "m".repeat(48);
export const CONFIG_ESSAI: Config = { cleMaitre: MAITRE, motDePasseGestion: "mot-de-passe-d-essai", demandesParHeureParIp: 10, turnstile: null };

export async function relaisEssai(o: { etat?: EtatSalon; config?: Partial<Config> } & Partial<Omit<Dependances, "base" | "config">> = {}) {
  const db = new DatabaseSync(":memory:");
  migrerSqlite(db);
  const base = baseSqlite(db);
  const salons = new Salons(base, MAITRE);
  const eclat = await salons.creer("eclat", "Institut Éclat", MAINTENANT);
  const voisin = await salons.creer("voisin", "Salon voisin", MAINTENANT);
  if (eclat === "existe" || voisin === "existe") throw new Error("salons d'essai déjà créés");
  await salons.modifier("eclat", { etat: o.etat ?? "essai" });
  const { etat: _etat, config, ...deps } = o;
  const app = creerApp({ base, config: { ...CONFIG_ESSAI, ...config }, maintenant: () => MAINTENANT, ...deps });
  return { app, base, salons, cles: { eclat: eclat.cle, voisin: voisin.cle } };
}

/** Appel signé comme lama le fait (chemin avec sa requête, corps JSON). */
const derniers = new Map<string, number>();

/**
 * Sans horodatage explicite, l'horodatage est strictement croissant par clé et salon (une signature n'est acceptée qu'une
 * fois, et deux appels dans la même milliseconde se confondraient).
 */
export async function appelSigne(app: ReturnType<typeof creerApp>, cle: string, salon: string, methode: string, chemin: string, corps?: unknown, explicite?: number) {
  const ref = `${salon}\n${cle}`;
  const horodatage = explicite ?? Math.max(MAINTENANT, (derniers.get(ref) ?? 0) + 1);
  if (explicite === undefined) derniers.set(ref, horodatage);
  const texte = corps === undefined ? "" : JSON.stringify(corps);
  const h = String(horodatage);
  const res = await app.request(chemin, {
    method: methode,
    headers: { "content-type": "application/json", "x-lama-institut": salon, "x-lama-horodatage": h, "x-lama-signature": await signer(cle, h, methode, chemin, texte) },
    body: texte === "" ? undefined : texte,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { statut: res.status, json: (await res.json()) as any };
}
