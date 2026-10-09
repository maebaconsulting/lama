import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("fenêtre de campagne : aperçu des destinataires, modèle des Réglages, confirmation avant l'envoi (décision 27)", () => {
  const fenetre = read("./fenetre-campagne.tsx");
  assert.match(fenetre, /campaignOffer\(account\.role, tag\)/, "bouton réservé à la gérante, étiquette choisie");
  assert.match(fenetre, /api<CampaignPreview>\("GET", `\/api\/campaigns\/preview\?tag=\$\{encodeURIComponent\(tag\)\}`\)/);
  assert.match(fenetre, /const drafts = campaignDrafts\(texts\);/, "textes de départ : le modèle « campagne » français, l'anglais vide");
  assert.match(fenetre, /setTextEn\(drafts\.en\);/);
  assert.doesNotMatch(fenetre, /x\.lang === "en"/, "plus de modèle anglais prérempli");
  assert.match(fenetre, /onClick=\{\(\) => setTextEn\(enModel\)\}>\{t\("campagne\.proposer_anglais"\)\}/, "modèle anglais proposé à la demande");
  assert.match(fenetre, /onClick=\{\(\) => setConfirming\(true\)\}/, "« Envoyer à N clientes » demande d'abord une confirmation");
  assert.match(fenetre, /api<\{ recipients: number \}>\("POST", "\/api\/campaigns", \{ tag, text_fr: textFr, text_en: textEn \}\)/);
  assert.match(fenetre, /if \(sending\.current \|\| !ready\) return;/, "garde contre le double clic (201 ou 200 : succès)");
  assert.match(fenetre, /campaignSms\(/, "coût en SMS affiché");
});

test("liste des clientes : « Écrire à ces clientes » quand une étiquette est choisie", () => {
  const liste = read("../client-list.tsx");
  assert.match(liste, /import \{ BoutonCampagne \} from "\.\/campagnes\/fenetre-campagne";/);
  assert.match(liste, /<BoutonCampagne tag=\{clientsTag\} \/>/);
});
