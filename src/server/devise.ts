/**
 * Devise de l'institut (spec du 15/10/2026, § 5) : chargée au démarrage et à
 * chaque changement de réglage ; figée dès la première facture (ou avoir),
 * le premier acompte ou la première clôture.
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import { definirDevise } from "../shared/devise-active.ts";
import { DEVISE_DEFAUT, DEVISES, estCodeDevise, type CodeDevise, type PositionSymbole } from "../shared/devises.ts";
import { loyaltyLimits, type Tier } from "../shared/fidelite.ts";
import { clientIp, currentAccount, requireConfirmation } from "./auth/middleware.ts";
import { logAudit } from "./audit.ts";
import { nowOf } from "./clock.ts";
import { msg } from "./messages.ts";
import { getSetting, writeSettingNow } from "./settings.ts";
import type { Database, StorageBinding } from "./storage.ts";

export async function chargerDevise(): Promise<void> {
  const code = await getSetting<string>("institut.devise");
  const position = await getSetting<PositionSymbole | null>("affichage.symbole_position");
  const symboleEcran = await getSetting<boolean>("affichage.symbole_ecran");
  definirDevise({ code: estCodeDevise(code) ? code : DEVISE_DEFAUT, position, symboleEcran });
}

/** Ce qui fige la devise, lu dans la transaction de l'appelant ; `null` tant que rien n'existe. */
export function deviseFigeePar(db: Database): { numero: string } | null {
  const facture = db.prepare("SELECT number FROM invoices ORDER BY id LIMIT 1").get() as { number: string } | undefined;
  if (facture) return { numero: facture.number };
  const acompte = db.prepare("SELECT number FROM deposits ORDER BY id LIMIT 1").get() as { number: string } | undefined;
  if (acompte) return { numero: acompte.number };
  const cloture = db.prepare("SELECT day, seq FROM cash_closings ORDER BY id LIMIT 1").get() as { day: string; seq: number } | undefined;
  return cloture ? { numero: `${cloture.day} n°\u00a0${cloture.seq}` } : null;
}

const COLONNES: [table: string, colonnes: string[]][] = [
  ["services", ["price"]], ["products", ["price", "cost"]], ["appointments", ["total_price"]], ["appointment_services", ["price"]],
  ["appointment_supplements", ["price"]],
];

/**
 * Change l'unité mineure des montants en gardant le nombre saisi (15 000 F
 * devient 15 000,00 €) : ×10^écart vers plus de décimales, ÷10^écart arrondi
 * sinon. Catalogue, rendez-vous, tranche et paliers de fidélité (ramenés dans
 * leurs bornes). Seules les valeurs de fidélité enregistrées sont converties :
 * un défaut jamais écrit en base (tranche 1000, paliers 5000 et 15000, settings.ts:142-149)
 * reste le défaut, lu dans la nouvelle devise (spec § 5). Dans la transaction de l'appelant.
 */
export function convertirMontants(db: Database, from: CodeDevise, to: CodeDevise): void {
  const ecart = DEVISES[to].decimales - DEVISES[from].decimales;
  if (ecart === 0) return;
  const k = 10 ** Math.abs(ecart);
  const conv = (n: number) => (ecart > 0 ? n * k : Math.round(n / k));
  const expr = (col: string) => (ecart > 0 ? `${col} * ${k}` : `ROUND(${col} / ${k}.0)`);
  for (const [table, cols] of COLONNES) db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ${expr(c)}`).join(", ")}`).run();
  const L = loyaltyLimits(DEVISES[to].decimales);
  const borne = (n: number, b: { min: number; max: number }) => Math.min(Math.max(n, b.min), b.max);
  const lire = (key: string) => db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  const ecrire = (key: string, value: unknown) => db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(JSON.stringify(value), key);
  const tranche = lire("fidelite.tranche");
  if (tranche) ecrire("fidelite.tranche", borne(conv(JSON.parse(tranche.value) as number), L.tranche));
  const paliers = lire("fidelite.paliers");
  if (paliers) ecrire("fidelite.paliers", (JSON.parse(paliers.value) as Tier[]).map((p) => ({ ...p, montant: borne(conv(p.montant), L.tierMontant) })));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountDeviseRoutes(app: OpenAPIHono<any>): void {
  app.put("/api/devise", async (c) => {
    const account = currentAccount(c);
    if (account.role !== "admin" && account.role !== "manager") return c.json({ error: msg(c, "acces.refuse") }, 403);
    const refused = requireConfirmation(c);
    if (refused) return refused;
    const { code } = (await c.req.json().catch(() => ({}))) as { code?: unknown };
    if (!estCodeDevise(code)) return c.json({ error: msg(c, "reglage.devise") }, 400);
    const now = nowOf(c);
    const result = (c.env.STORAGE as StorageBinding).transaction!((db) => {
      const by = deviseFigeePar(db);
      if (by) return { fige: by };
      const row = db.prepare("SELECT value FROM settings WHERE key = 'institut.devise'").get() as { value: string } | undefined;
      const parsed = row ? (JSON.parse(row.value) as unknown) : DEVISE_DEFAUT;
      const from: CodeDevise = estCodeDevise(parsed) ? parsed : DEVISE_DEFAUT;
      if (from !== code) convertirMontants(db, from, code);
      writeSettingNow(db, "institut.devise", code, account.id, now);
      return { from };
    });
    if ("fige" in result) return c.json({ error: msg(c, "devise.figee", result.fige) }, 409);
    await chargerDevise();
    await logAudit({ accountId: account.id, action: "reglage.devise", target: `${result.from} → ${code}`, ip: clientIp(c), now });
    return c.json({ ok: true });
  });
}
