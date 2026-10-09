import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Garde-fou D14 (audit-responsive.md) : zones sûres de l'iPhone (encoche,
 * indicateur d'accueil). `viewport-fit=cover` doit être déclaré, et les
 * zones qui touchent un bord (en-tête mobile, bas du menu, fenêtres)
 * doivent composer avec `env(safe-area-inset-*)`.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("D14 : viewport-fit=cover est déclaré", () => {
  const html = read("../../index.html");
  assert.match(html, /viewport-fit=cover/);
});

test("D14 : l'en-tête du téléphone (encoche) et la barre d'onglets (indicateur d'accueil) composent avec les zones sûres", () => {
  const phone = read("./components/cadre/telephone.tsx");
  const header = phone.match(/<header className="([^"]*)"/)?.[1] ?? "";
  assert.match(header, /pt-\[calc\(0\.5rem\+env\(safe-area-inset-top\)\)\]/);
  assert.match(header, /safe-area-inset-left/);
  assert.match(header, /safe-area-inset-right/);
  const tabs = phone.slice(phone.indexOf("export function OngletsTelephone"));
  assert.match(tabs, /fixed inset-x-0 bottom-0[^"]*pb-\[env\(safe-area-inset-bottom\)\][^"]*pl-\[env\(safe-area-inset-left\)\][^"]*pr-\[env\(safe-area-inset-right\)\]/);
});

test("D14 (sous-projet 4) : la page garde la place de la barre d'onglets, marges gauche/droite en paysage", () => {
  const app = read("./app.tsx");
  assert.match(app, /<main inert=\{covered\} className=\{cn\(\s*"[^"]*safe-area-inset-left[^"]*safe-area-inset-right/);
  assert.match(app, /pb-\[calc\(8rem\+env\(safe-area-inset-bottom\)\)\] md:pb-0/, "place des onglets (3,5 rem) et du « + » (3,5 rem et son écart)");
});

test("D14 (sous-projet 4) : « Plus » et le rail composent avec les zones sûres", () => {
  const phone = read("./components/cadre/telephone.tsx");
  assert.match(phone, /pb-\[calc\(1rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(phone, /\[&>button\]:right-\[max\(0\.5rem,env\(safe-area-inset-right\)\)\]/);
  const rail = read("./components/cadre/rail.tsx");
  assert.match(rail, /pt-\[env\(safe-area-inset-top\)\]/);
  assert.match(rail, /pb-\[env\(safe-area-inset-bottom\)\]/);
  assert.match(rail, /pl-\[env\(safe-area-inset-left\)\]/);
});

test("D14 : les fenêtres composent avec les zones sûres (bouton de fermeture)", () => {
  const dialog = read("./components/ui/dialog.tsx");
  assert.match(dialog, /safe-area-inset-right/);
  assert.match(dialog, /safe-area-inset-top/);
});

test("D14 : le bandeau d'erreur ne recouvre ni l'indicateur d'accueil ni la barre d'onglets", () => {
  const banner = read("./components/error-banner.tsx");
  assert.match(banner, /bottom-\[calc\(8\.5rem\+env\(safe-area-inset-bottom\)\)\]/, "au-dessus des onglets et du « + »");
  assert.match(banner, /md:bottom-\[calc\(1rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.doesNotMatch(banner, /shadow-/, "aucune ombre (charte)");
});
