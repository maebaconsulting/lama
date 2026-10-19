import { z } from "@hono/zod-openapi";
import { MOTIF_ORIGINE, MOTIF_SALON, SALONS_RESERVES } from "./motifs.ts";

/** Règles des salons d'un relais (spec § 5, « Plusieurs salons »). */

export { SALONS_RESERVES };

export const IdSalon = z.string()
  .regex(MOTIF_SALON, "identifiant de 1 à 32 caractères\u00a0: minuscules, chiffres, tirets")
  .refine((v) => !SALONS_RESERVES.includes(v), "identifiant réservé");

export const EtatSalon = z.enum(["actif", "suspendu", "essai"]);
export type EtatSalon = z.infer<typeof EtatSalon>;

/** Origine d'un site autorisé à appeler l'API publique depuis le navigateur : `https://www.exemple.cm`. */
export const Origine = z.string().regex(MOTIF_ORIGINE, "origine https://exemple.cm attendue, sans chemin");

export const NomSalon = z.string().trim().min(1).max(120);
