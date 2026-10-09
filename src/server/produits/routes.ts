/**
 * Adresses de la photo d'un produit (images des produits, spec du
 * 04/10/2026, § 1) : dépôt et retrait par la gérante, lecture par tout compte
 * connecté (jamais sans session, `auth/permissions.ts`), type contrôlé au
 * dépôt, `nosniff`, cache privé d'un an (l'adresse porte la version).
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get } from "@clawnify/db";
import { clientIp, currentAccount } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { IMAGE_MAX_BYTES, imageProblem, sniffImage } from "../images.ts";
import { msg } from "../messages.ts";
import { deleteProductImage, readProductImage, saveProductImage } from "./images.ts";

/** Identifiant et nom du produit de l'adresse ; `null` s'il n'existe pas. */
async function productOf(raw: string): Promise<{ id: number; name: string } | null> {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await get<{ name: string }>("SELECT name FROM products WHERE id = ?", [id]);
  return row ? { id, name: row.name } : null;
}

export function mountProductImageRoutes(app: OpenAPIHono<any>): void { // eslint-disable-line @typescript-eslint/no-explicit-any
  app.get("/api/products/:id/image", async (c) => {
    const id = Number(c.req.param("id"));
    const image = Number.isInteger(id) ? await readProductImage(id) : null;
    if (!image) return c.json({ error: msg(c, "produit.photo_absente") }, 404);
    return c.body(new Uint8Array(image.bytes), 200, {
      "Content-Type": image.type,
      "X-Content-Type-Options": "nosniff",
      // L'adresse porte la version (`?v=7`) : un nouveau dépôt change l'adresse. Privé : jamais dans un cache partagé.
      "Cache-Control": "private, max-age=31536000, immutable",
    });
  });

  app.put("/api/products/:id/image", async (c) => {
    const product = await productOf(c.req.param("id"));
    if (!product) return c.json({ error: msg(c, "produit.introuvable") }, 404);
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > IMAGE_MAX_BYTES) return c.json({ error: msg(c, "image.trop_lourd") }, 400);
    const bytes = Buffer.from(await c.req.arrayBuffer());
    const problem = imageProblem(bytes);
    if (problem) return c.json({ error: msg(c, problem) }, 400);
    const now = nowOf(c);
    const version = await saveProductImage(product.id, sniffImage(bytes)!, bytes, now);
    await logAudit({ accountId: currentAccount(c).id, action: "produit.photo_depot", target: product.name, ip: clientIp(c), now });
    return c.json({ ok: true, version });
  });

  app.delete("/api/products/:id/image", async (c) => {
    const product = await productOf(c.req.param("id"));
    if (!product) return c.json({ error: msg(c, "produit.introuvable") }, 404);
    if (!(await deleteProductImage(product.id))) return c.json({ error: msg(c, "produit.photo_absente") }, 404);
    await logAudit({ accountId: currentAccount(c).id, action: "produit.photo_retrait", target: product.name, ip: clientIp(c), now: nowOf(c) });
    return c.json({ ok: true });
  });
}
