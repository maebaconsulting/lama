/**
 * Routes du logo de l'institut (renommage lama, vague B, spec § 2) : dépôt et
 * retrait par la gérante, lecture publique (l'écran de connexion l'affiche
 * avant toute session), toujours avec le type contrôlé au dépôt et `nosniff`.
 * Contrôle du fichier par le module d'images commun (images des produits).
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import { clientIp, currentAccount } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { msg } from "../messages.ts";
import { IMAGE_MAX_BYTES, imageProblem, ImageTooLarge, sniffImage } from "../images.ts";
import { printImagePng, unpackPrintImage } from "../impression/image-logo.ts";
import { deleteLogo, LOGO_VARIANTS, preparePrintImage, readLogo, readPrintImage, saveLogo, type LogoVariant } from "./logos.ts";

const variantOf = (value: string): LogoVariant | null => (LOGO_VARIANTS.includes(value as LogoVariant) ? (value as LogoVariant) : null);

export function mountInstitutRoutes(app: OpenAPIHono<any>): void { // eslint-disable-line @typescript-eslint/no-explicit-any
  // Aperçu « tel qu'imprimé » (gérante) : déclaré avant `:variante`, qui le capturerait.
  app.get("/api/institut/logos/impression", async (c) => {
    const packed = await readPrintImage();
    const img = packed ? unpackPrintImage(packed) : null;
    if (!img) return c.json({ error: msg(c, "logo.absent") }, 404);
    return c.body(new Uint8Array(printImagePng(img)), 200, { "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" });
  });

  app.get("/api/institut/logos/:variante", async (c) => {
    const variant = variantOf(c.req.param("variante"));
    const logo = variant ? await readLogo(variant) : null;
    if (!logo) return c.json({ error: msg(c, "logo.absent") }, 404);
    return c.body(new Uint8Array(logo.bytes), 200, {
      "Content-Type": logo.type,
      "X-Content-Type-Options": "nosniff",
      // L'adresse porte la version (`?v=3`) : un nouveau dépôt change l'adresse, le cache peut être long.
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  app.put("/api/institut/logos/:variante", async (c) => {
    const variant = variantOf(c.req.param("variante"));
    if (!variant) return c.json({ error: msg(c, "logo.variante") }, 404);
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > IMAGE_MAX_BYTES) return c.json({ error: msg(c, "logo.trop_lourd") }, 400);
    const bytes = Buffer.from(await c.req.arrayBuffer());
    const problem = imageProblem(bytes);
    // Le logo garde son texte de poids (« Logo trop lourd ») ; les autres raisons sont celles du module commun.
    if (problem) return c.json({ error: msg(c, problem === "image.trop_lourd" ? "logo.trop_lourd" : problem) }, 400);
    const type = sniffImage(bytes)!;
    let printImage: Buffer | null = null;
    try {
      // L'image d'impression ne se fabrique que pour le clair ; le décodage peut encore refuser un fichier que pdfkit a ouvert.
      if (variant === "clair") printImage = preparePrintImage(bytes, type);
    } catch (err) {
      return c.json({ error: msg(c, err instanceof ImageTooLarge ? "image.trop_grand" : "image.illisible") }, 400);
    }
    const now = nowOf(c);
    const version = await saveLogo(variant, type, bytes, printImage, now);
    await logAudit({ accountId: currentAccount(c).id, action: "logo.depot", target: variant, ip: clientIp(c), now });
    return c.json({ ok: true, version });
  });

  app.delete("/api/institut/logos/:variante", async (c) => {
    const variant = variantOf(c.req.param("variante"));
    if (!variant) return c.json({ error: msg(c, "logo.variante") }, 404);
    if (!(await deleteLogo(variant))) return c.json({ error: msg(c, "logo.absent") }, 404);
    await logAudit({ accountId: currentAccount(c).id, action: "logo.retrait", target: variant, ip: clientIp(c), now: nowOf(c) });
    return c.json({ ok: true });
  });
}
