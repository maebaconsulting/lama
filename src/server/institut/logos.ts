/**
 * Logo de l'institut (renommage lama, vague B, spec § 2) : contrôle,
 * stockage en BLOB, versions. Le logo suit la sauvegarde chiffrée et la
 * restauration sans changement (il vit dans la base).
 */
import { get, run } from "@clawnify/db";
import type { ImageType } from "../images.ts";
import type { DocumentFile } from "../whatsapp/fournisseur.ts";
import { decodeImage, packPrintImage, toPrintImage } from "../impression/image-logo.ts";

export type LogoVariant = "clair" | "sombre";
export const LOGO_VARIANTS: readonly LogoVariant[] = ["clair", "sombre"];
/** Type d'un logo : celui du module d'images commun (`src/server/images.ts`, qui contrôle aussi le dépôt). */
export type LogoType = ImageType;

export async function readLogo(variant: LogoVariant): Promise<{ type: LogoType; bytes: Buffer; version: number } | null> {
  const row = await get<{ type: LogoType; octets: Uint8Array; version: number }>("SELECT type, octets, version FROM institut_logos WHERE variante = ?", [variant]);
  return row ? { type: row.type, bytes: Buffer.from(row.octets), version: row.version } : null;
}

/** Logo de l'institut en pièce jointe (en-tête image d'un produit sans photo, WhatsApp Business W-17) : le clair, sinon le sombre. */
export async function logoForMessage(): Promise<DocumentFile | null> {
  const logo = (await readLogo("clair")) ?? (await readLogo("sombre"));
  return logo ? { name: `logo.${logo.type === "image/png" ? "png" : "jpg"}`, mime: logo.type, data: logo.bytes } : null;
}

export async function logoVersions(): Promise<{ clair: number | null; sombre: number | null }> {
  const clair = await get<{ version: number }>("SELECT version FROM institut_logos WHERE variante = 'clair'");
  const sombre = await get<{ version: number }>("SELECT version FROM institut_logos WHERE variante = 'sombre'");
  return { clair: clair?.version ?? null, sombre: sombre?.version ?? null };
}

/** Enregistre (ou remplace) un logo ; la version croît toujours, même après un retrait. */
export async function saveLogo(variant: LogoVariant, type: LogoType, bytes: Buffer, printImage: Buffer | null, now: number): Promise<number> {
  // Compteur incrémenté en une seule instruction : deux dépôts ne reçoivent jamais la même version (cache d'un an).
  const row = await get<{ v: number }>(
    "INSERT INTO _meta (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) RETURNING CAST(value AS INTEGER) AS v",
    [`logo_version_${variant}`],
  );
  const version = row!.v;
  await run(
    `INSERT INTO institut_logos (variante, type, octets, version, mis_a_jour, impression) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(variante) DO UPDATE SET type = excluded.type, octets = excluded.octets, version = excluded.version, mis_a_jour = excluded.mis_a_jour, impression = excluded.impression`,
    [variant, type, bytes, version, new Date(now).toISOString(), printImage],
  );
  return version;
}

export async function deleteLogo(variant: LogoVariant): Promise<boolean> {
  const result = await run("DELETE FROM institut_logos WHERE variante = ?", [variant]);
  return Number(result.changes) > 0;
}

/** Image tramée du logo clair pour l'imprimante thermique (tâche 2), `null` sans logo clair. */
export async function readPrintImage(): Promise<Buffer | null> {
  const row = await get<{ impression: Uint8Array | null }>("SELECT impression FROM institut_logos WHERE variante = 'clair'");
  return row?.impression ? Buffer.from(row.impression) : null;
}

/** Image d'impression d'un logo clair : décodé, réduit, tramé, empaqueté ; lève si l'image est illisible ou démesurée. */
export function preparePrintImage(bytes: Buffer, type: LogoType): Buffer {
  return packPrintImage(toPrintImage(decodeImage(bytes, type)));
}
