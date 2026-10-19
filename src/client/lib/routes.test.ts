import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { View } from "../types.ts";
import { canonicalUrl, localizeUrl, PANEL_STATE, panelCloseMode, panelOpenMode, parsePanel, parseRoute, pathFor, withoutPanel, withPanel } from "./routes.ts";

/** Écran, adresse française, adresse anglaise, adresse d'origine d'OpenSalon (spec § 7). */
const TABLE: [View, string, string, string][] = [
  ["dashboard", "/", "/", "/"],
  ["calendar", "/agenda", "/calendar", "/calendar"],
  ["appointments", "/rendez-vous", "/appointments", "/appointments"],
  ["clients", "/clientes", "/clients", "/clients"],
  ["staff", "/equipe", "/staff", "/staff"],
  ["services", "/prestations", "/services", "/services"],
  ["products", "/produits", "/products", "/products"],
  ["reglages", "/reglages", "/settings", "/reglages"],
  ["charte", "/charte", "/charte", "/charte"],
  ["vente", "/vente", "/sale", "/vente"],
];

test("chaque écran répond à ses deux adresses et à l'adresse d'origine", () => {
  for (const [view, fr, en, origin] of TABLE) {
    for (const path of [fr, en, origin]) assert.deepEqual(parseRoute(path), { view, id: null }, path);
    assert.equal(pathFor(view, "fr"), fr, view);
    assert.equal(pathFor(view, "en"), en, view);
  }
});

test("vente d'un rendez-vous : son numéro dans l'adresse (sous-projet 5 § 4.1)", () => {
  assert.deepEqual(parseRoute("/vente/12"), { view: "vente", id: "12" });
  assert.equal(pathFor("vente", "en", 12), "/sale/12");
  assert.equal(localizeUrl("/sale/12", "fr"), "/vente/12");
});

test("fiches et rubriques : identifiant gardé, rubriques des Réglages traduites", () => {
  assert.deepEqual(parseRoute("/rendez-vous/12"), { view: "appointments", id: "12" });
  assert.deepEqual(parseRoute("/appointments/12"), { view: "appointments", id: "12" });
  assert.deepEqual(parseRoute("/clientes/3"), { view: "clients", id: "3" });
  assert.deepEqual(parseRoute("/settings/backups"), { view: "reglages", id: "sauvegardes" });
  assert.deepEqual(parseRoute("/reglages/mon-compte"), { view: "reglages", id: "mon-compte" });
  assert.deepEqual(parseRoute("/settings/my-account"), { view: "reglages", id: "mon-compte" });
  assert.equal(pathFor("appointments", "fr", 12), "/rendez-vous/12");
  assert.equal(pathFor("clients", "en", "3"), "/clients/3");
  assert.equal(pathFor("reglages", "en", "mon-compte"), "/settings/my-account");
  assert.equal(pathFor("reglages", "fr", "file-envoi"), "/reglages/file-envoi");
  assert.equal(pathFor("reglages", "en", null), "/settings");
});

test("adresses tapées ou anciennes : barre finale, paramètres, ancres, adresse inconnue (Review Focus 3)", () => {
  assert.deepEqual(parseRoute("/agenda/"), { view: "calendar", id: null });
  assert.deepEqual(parseRoute("/dashboard"), { view: "dashboard", id: null });
  assert.deepEqual(parseRoute("/calendar?agent"), { view: "calendar", id: null });
  assert.deepEqual(parseRoute("/inconnue/5"), { view: "dashboard", id: null });
  assert.equal(localizeUrl("/appointments/12", "fr"), "/rendez-vous/12");
  assert.equal(localizeUrl("/rendez-vous/12?agent", "en"), "/appointments/12?agent");
  assert.equal(localizeUrl("/settings/backups#historique", "fr"), "/reglages/sauvegardes#historique");
  assert.equal(localizeUrl("/agenda/", "en"), "/calendar");
  assert.equal(localizeUrl("/inconnue", "fr"), "/");
  assert.equal(localizeUrl("/?agent", "en"), "/?agent");
});

test("une adresse mal encodée ne fait pas planter parseRoute (M1, relecture finale)", () => {
  assert.deepEqual(parseRoute("/clientes/%"), { view: "clients", id: "%" });
});

test("la bascule remplace l'adresse sans nouvelle entrée d'historique ; navigate suit la langue", () => {
  const hook = readFileSync(new URL("../hooks/use-router.ts", import.meta.url), "utf8");
  assert.match(hook, /replaceState\(/);
  assert.match(hook, /\}, \[lang\]\);/);
  assert.match(hook, /const target = canonicalUrl\(to, langRef\.current\)/);
  assert.match(readFileSync(new URL("../app.tsx", import.meta.url), "utf8"), /useRouter\(lang\)/);
});

test("panneau : l'adresse porte l'élément ouvert, dans les deux langues (sous-projet 4 § 3.3)", () => {
  assert.deepEqual(parsePanel("/agenda?rdv=12"), { kind: "appointment", id: "12" });
  assert.deepEqual(parsePanel("/calendar?appt=12"), { kind: "appointment", id: "12" });
  assert.deepEqual(parsePanel("/clientes?cliente=3#notes"), { kind: "client", id: "3" });
  assert.deepEqual(parsePanel("/staff?agent&member=7"), { kind: "staff", id: "7" });
  assert.deepEqual(parsePanel("/prestations?prestation=4"), { kind: "service", id: "4" });
  assert.deepEqual(parsePanel("/products?product=9"), { kind: "product", id: "9" });
  assert.deepEqual(parsePanel("/reglages/comptes?compte=2"), { kind: "account", id: "2" });
  assert.deepEqual(parsePanel("/settings/devices?device=5"), { kind: "device", id: "5" });
});

test("panneau : identifiant tapé ou abîmé ignoré, l'écran s'ouvre sans panneau (Review Focus 2)", () => {
  for (const url of ["/agenda", "/agenda?rdv", "/agenda?rdv=", "/agenda?rdv=0", "/agenda?rdv=-3", "/agenda?rdv=abc", "/agenda?rdv=12abc",
    "/agenda?rdv=012", "/agenda?rdv=12345678901", "/agenda?inconnu=12", "/agenda#rdv=12"]) {
    assert.equal(parsePanel(url), null, url);
  }
  assert.deepEqual(parsePanel("/agenda?rdv=abc&appt=8"), { kind: "appointment", id: "8" }, "premier paramètre valable");
});

test("panneau : ouvrir, remplacer et fermer gardent les autres paramètres et l'ancre", () => {
  assert.equal(withPanel("/agenda", { kind: "appointment", id: "12" }, "fr"), "/agenda?rdv=12");
  assert.equal(withPanel("/calendar?agent#top", { kind: "appointment", id: "12" }, "en"), "/calendar?agent&appt=12#top");
  assert.equal(withPanel("/agenda?rdv=3", { kind: "appointment", id: "12" }, "fr"), "/agenda?rdv=12", "un seul élément ouvert");
  assert.equal(withPanel("/clientes/3?rdv=4", { kind: "client", id: "3" }, "fr"), "/clientes/3?cliente=3");
  assert.equal(withPanel("/agenda?agent&rdv=3", null, "fr"), "/agenda?agent");
  assert.equal(withoutPanel("/agenda?rdv=12"), "/agenda");
  assert.equal(withoutPanel("/calendar?agent&appt=12#top"), "/calendar?agent#top");
  assert.equal(withoutPanel("/agenda?agent"), "/agenda?agent");
});

test("panneau : la bascule de langue traduit aussi le paramètre", () => {
  assert.equal(localizeUrl("/agenda?rdv=12", "en"), "/calendar?appt=12");
  assert.equal(localizeUrl("/calendar?appt=12", "fr"), "/agenda?rdv=12");
  assert.equal(localizeUrl("/calendar?agent&appt=12", "fr"), "/agenda?agent&rdv=12");
  assert.equal(localizeUrl("/clients?client=3", "fr"), "/clientes?cliente=3");
});

test("panneau : l'ancienne fiche d'un rendez-vous en page s'ouvre dans le panneau au-dessus de la liste", () => {
  assert.equal(canonicalUrl("/rendez-vous/12", "fr"), "/rendez-vous?rdv=12");
  assert.equal(canonicalUrl("/appointments/12", "fr"), "/rendez-vous?rdv=12");
  assert.equal(canonicalUrl("/rendez-vous/12?agent", "en"), "/appointments?agent&appt=12");
  assert.equal(canonicalUrl("/rendez-vous/abc", "fr"), "/rendez-vous/abc", "identifiant illisible : adresse seulement traduite");
  assert.equal(canonicalUrl("/clientes/3", "en"), "/clients?client=3", "fiche cliente dans le panneau depuis la vague 4");
  assert.equal(canonicalUrl("/calendar?appt=5", "fr"), "/agenda?rdv=5");
});

test("ancienne fiche d'une cliente en page (/clientes/12) : ouverte dans le panneau au-dessus de la liste (vague 4)", () => {
  assert.equal(canonicalUrl("/clientes/12", "fr"), "/clientes?cliente=12");
  assert.equal(canonicalUrl("/clients/12", "en"), "/clients?client=12");
  assert.equal(canonicalUrl("/clients/12?agent", "fr"), "/clientes?agent&cliente=12");
  assert.equal(canonicalUrl("/clientes/abc", "fr"), "/clientes/abc", "identifiant illisible : adresse gardée telle quelle");
});

test("panneau : « Précédent » le ferme s'il a été ouvert depuis l'écran, sinon l'adresse est remplacée", () => {
  assert.equal(panelCloseMode(PANEL_STATE), "back");
  assert.equal(panelCloseMode({ panneau: true, autre: 1 }), "back");
  for (const state of [null, undefined, {}, { panneau: "oui" }, "panneau", 1]) assert.equal(panelCloseMode(state), "replace", String(state));
});

test("panneau : ouvrir un élément pousse une entrée d'historique sans panneau ou en changeant de sorte, remplace sur la même sorte (fix round 1)", () => {
  assert.equal(panelOpenMode(null, "appointment"), "push", "aucun panneau ouvert");
  assert.equal(panelOpenMode({ kind: "client", id: "3" }, "client"), "replace", "même sorte : une autre cliente");
  assert.equal(panelOpenMode({ kind: "appointment", id: "3" }, "appointment"), "replace", "même sorte : un autre rendez-vous");
  assert.equal(panelOpenMode({ kind: "client", id: "3" }, "appointment"), "push", "sorte différente : un rendez-vous ouvert depuis la fiche cliente");
  assert.equal(panelOpenMode({ kind: "appointment", id: "3" }, "client"), "push", "sorte différente : une cliente ouverte depuis un rendez-vous");
});

test("routeur : le panneau suit l'adresse ; ouvert depuis l'écran, « Précédent » le ferme ; déjà ouvert, il change d'élément sur place", () => {
  const hook = readFileSync(new URL("../hooks/use-router.ts", import.meta.url), "utf8");
  assert.match(hook, /panel: parsePanel\(url\)/);
  assert.match(hook, /if \(panelOpenMode\(parsePanel\(current\), kind\) === "replace"\) replace\(target\);\s*else navigate\(target, PANEL_STATE\);/);
  assert.match(hook, /if \(panelCloseMode\(window\.history\.state\) === "back"\) window\.history\.back\(\);\s*else replace\(withoutPanel\(here\(\)\)\);/);
  assert.match(hook, /const handler = \(\) => \{\s*setRoute\(read\(here\(\)\)\);/, "« Précédent » relit l'adresse complète, paramètre compris");
  assert.match(hook, /useState\(\(\) => read\(canonicalUrl\(here\(\), lang\)\)\)/, "un lien direct vers une ancienne fiche ouvre le panneau dès le premier rendu");
  assert.match(hook, /if \(!parsePanel\(here\(\)\)\) return;/, "fermer un panneau déjà fermé ne touche pas à l'historique");
});

test("ancienne adresse d'une fiche (/rendez-vous/12, /appointments/12) : la liste s'affiche, le rendez-vous 12 dans le panneau, dès le premier rendu", () => {
  for (const url of ["/rendez-vous/12", "/appointments/12", "/appointments/12?agent"]) {
    for (const lang of ["fr", "en"] as const) {
      const target = canonicalUrl(url, lang);
      assert.deepEqual(parseRoute(target), { view: "appointments", id: null }, `${url} (${lang})`);
      assert.deepEqual(parsePanel(target), { kind: "appointment", id: "12" }, `${url} (${lang})`);
    }
  }
});

test("« Demandes en ligne » : adresse dans chaque langue", () => {
  assert.equal(pathFor("demandes", "fr"), "/demandes-en-ligne");
  assert.equal(pathFor("demandes", "en"), "/online-requests");
  assert.equal(parseRoute("/online-requests").view, "demandes");
});
