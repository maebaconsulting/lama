import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import { readInstallBannerClosed, writeInstallBannerClosed } from "../i18n/device-lang.ts";
import {
  capterInstallation, doitProposerBandeau, estInstallee, estTactile, etatInvite, lancerInvite, modeInstallation, onInstallation,
  oublierInstallationPourEssai, plateformeDe,
} from "./installation.ts";

/** Invitation à installer lama sur l'écran d'accueil (PWA, P-06). */
beforeEach(() => oublierInstallationPourEssai());

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_RECENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

test("plateforme : iPhone et iPad (même présenté comme un Mac tactile) ; un vrai Mac et Android ne le sont pas", () => {
  assert.equal(plateformeDe(IPHONE, 5), "ios");
  assert.equal(plateformeDe(IPAD_RECENT, 5), "ios");
  assert.equal(plateformeDe(IPAD_RECENT, 0), "autre", "Mac à souris");
  assert.equal(plateformeDe(ANDROID, 5), "autre");
});

test("installé : ouvert depuis l'écran d'accueil (display-mode standalone, ou navigator.standalone sur iOS)", () => {
  assert.equal(estInstallee({ standalone: true, iosStandalone: undefined }), true);
  assert.equal(estInstallee({ standalone: false, iosStandalone: true }), true);
  assert.equal(estInstallee({ standalone: false, iosStandalone: false }), false);
  assert.equal(estInstallee({ standalone: false, iosStandalone: undefined }), false);
});

test("entrée « Installer » : dialogue du navigateur si invité, gestes sur iOS, masquée si installé, en http ou sans moyen d'installer", () => {
  const base = { securise: true, installee: false, plateforme: "autre" as const, invite: false };
  assert.equal(modeInstallation({ ...base, invite: true }), "invite", "Android, Chrome ou Edge sur ordinateur");
  assert.equal(modeInstallation({ ...base, plateforme: "ios" }), "ios");
  assert.equal(modeInstallation({ ...base, plateforme: "ios", invite: true }), "invite");
  assert.equal(modeInstallation(base), "aucun", "Firefox sur ordinateur : rien à proposer");
  assert.equal(modeInstallation({ ...base, invite: true, installee: true }), "aucun");
  assert.equal(modeInstallation({ ...base, plateforme: "ios", installee: true }), "aucun");
  assert.equal(modeInstallation({ ...base, invite: true, securise: false }), "aucun", "http://lama.local avant l'autorité");
  assert.equal(modeInstallation({ ...base, plateforme: "ios", securise: false }), "aucun");
});

test("bandeau unique : téléphone ou tablette non installé, jamais sur ordinateur, jamais une fois fermé", () => {
  assert.equal(estTactile({ pointeurGrossier: true, plateforme: "autre" }), true);
  assert.equal(estTactile({ pointeurGrossier: false, plateforme: "ios" }), true);
  assert.equal(estTactile({ pointeurGrossier: false, plateforme: "autre" }), false);
  assert.equal(doitProposerBandeau({ mode: "invite", tactile: true, ferme: false }), true);
  assert.equal(doitProposerBandeau({ mode: "ios", tactile: true, ferme: false }), true);
  assert.equal(doitProposerBandeau({ mode: "invite", tactile: false, ferme: false }), false);
  assert.equal(doitProposerBandeau({ mode: "ios", tactile: true, ferme: true }), false);
  assert.equal(doitProposerBandeau({ mode: "aucun", tactile: true, ferme: false }), false);
});

test("bandeau fermé : retenu par l'appareil ; stockage refusé ou absent, ni erreur ni bandeau perdu à tort", () => {
  const valeurs = new Map<string, string>();
  const store = { getItem: (k: string) => valeurs.get(k) ?? null, setItem: (k: string, v: string) => { valeurs.set(k, v); } };
  assert.equal(readInstallBannerClosed(store), false);
  writeInstallBannerClosed(store);
  assert.equal(valeurs.get("lama.installation"), "ferme");
  assert.equal(readInstallBannerClosed(store), true);
  const refuse = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); } };
  assert.doesNotThrow(() => writeInstallBannerClosed(refuse));
  assert.equal(readInstallBannerClosed(refuse), false);
  assert.equal(readInstallBannerClosed(null), false);
  assert.doesNotThrow(() => writeInstallBannerClosed(null));
});

test("invitation du navigateur : captée sans mini-barre de Chrome, servie une fois, oubliée une fois lama installé", async () => {
  const ecouteurs: Record<string, (e: Event) => void> = {};
  capterInstallation({ addEventListener: (type, ecouteur) => { ecouteurs[type] = ecouteur; } });
  let changements = 0;
  onInstallation(() => { changements++; });
  assert.equal(await lancerInvite(), "indisponible");
  let empeche = 0;
  let ouverte = 0;
  const evenement = { preventDefault: () => { empeche++; }, prompt: async () => { ouverte++; }, userChoice: Promise.resolve({ outcome: "accepted" as const }) };
  ecouteurs.beforeinstallprompt(evenement as unknown as Event);
  assert.equal(empeche, 1);
  assert.deepEqual(etatInvite(), { invite: true, installeeIci: false });
  assert.equal(await lancerInvite(), "accepted");
  assert.equal(ouverte, 1);
  assert.equal(await lancerInvite(), "indisponible", "une invitation ne sert qu'une fois");
  ecouteurs.appinstalled(new Event("appinstalled"));
  assert.deepEqual(etatInvite(), { invite: false, installeeIci: true });
  assert.equal(changements, 3);
});

test("écran : entrée dans le rail et la feuille « Plus » (tous les rôles), bandeau en tête, invitation captée au démarrage", () => {
  const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
  const rail = lire("../components/cadre/rail.tsx");
  assert.match(rail, /\{installation\.visible && \(\s*<RailButton\s*label=\{t\("installation\.entree"\)\}\s*icon=\{Download\}/);
  assert.match(rail, /\{installation\.fenetre\}/);
  const telephone = lire("../components/cadre/telephone.tsx");
  assert.match(telephone, /<Plus currentView=\{currentView\} installer=\{installation\.visible \? installation\.installer : null\} \/>/);
  assert.match(telephone, /onClick=\{\(\) => \{ setOpen\(false\); installer\(\); \}\}/);
  const composant = lire("../components/installer-lama.tsx");
  for (const cle of ["installation.ios.partager", "installation.ios.ecran_accueil", "installation.ios.ajouter"]) assert.ok(composant.includes(`t("${cle}")`), cle);
  assert.match(lire("../components/bandeaux.tsx"), /<BandeauInstallation \/>/);
  assert.match(lire("../main.tsx"), /capterInstallation\(window\);[\s\S]*render\(/);
});

test("invitation refusée par le navigateur (prompt ou userChoice rejeté) : « indisponible », invitation consommée, pas de boucle", async () => {
  oublierInstallationPourEssai();
  const ecouteurs: Record<string, (e: Event) => void> = {};
  capterInstallation({ addEventListener: (type, ecouteur) => { ecouteurs[type] = ecouteur; } });
  let changements = 0;
  onInstallation(() => { changements++; });
  const rejetPrompt = { preventDefault: () => undefined, prompt: async () => { throw new Error("déjà utilisée"); }, userChoice: new Promise<never>(() => undefined) };
  ecouteurs.beforeinstallprompt(rejetPrompt as unknown as Event);
  assert.equal(etatInvite().invite, true);
  assert.equal(await lancerInvite(), "indisponible");
  assert.equal(etatInvite().invite, false, "l'invitation reste consommée");
  assert.ok(changements >= 2, "les abonnés relisent l'état");
  assert.equal(await lancerInvite(), "indisponible");
  const userChoice = Promise.reject(new Error("geste perdu"));
  userChoice.catch(() => undefined);
  ecouteurs.beforeinstallprompt({ preventDefault: () => undefined, prompt: async () => undefined, userChoice } as unknown as Event);
  assert.equal(await lancerInvite(), "indisponible");
  assert.equal(etatInvite().invite, false);
});
