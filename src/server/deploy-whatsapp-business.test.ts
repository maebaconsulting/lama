import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { englishFaults, frenchFaults } from "../client/i18n/typography.ts";
import { GUIDE_META } from "../client/lib/whatsapp-business.ts";

/** Guide du technicien, section « WhatsApp Business » (spec du 21/10/2026, W-14). */

const lire = (nom: string) => readFileSync(new URL(`../../deploy/${nom}`, import.meta.url), "utf8");

/** Section `## WhatsApp Business`, jusqu'au titre suivant de même niveau. */
function section(doc: string): string {
  const debut = doc.indexOf("\n## WhatsApp Business\n");
  assert.ok(debut >= 0, "section « WhatsApp Business » absente");
  const fin = doc.indexOf("\n## ", debut + 1);
  return doc.slice(debut, fin < 0 ? undefined : fin);
}

/** Lignes de texte, hors blocs de code et code en ligne. */
const prose = (texte: string) => texte.split("```").filter((_b, i) => i % 2 === 0).join("\n").split("\n").map((l) => l.replace(/`[^`]*`/g, "x"));

test("guide du technicien, WhatsApp Business (W-14) : étapes chez Meta et dans lama, dans les deux langues, typographie de chaque langue", () => {
  const fr = section(lire("LISEZMOI.md"));
  for (const motif of [
    /entreprise de l'institut/, /coexistence/, /utilisateur système/, /jeton d'accès permanent/, /whatsapp_business_messaging/, /whatsapp_business_management/,
    /Identifiant du numéro de téléphone/, /Identifiant du compte WhatsApp Business/, /Tester la connexion/, /Voir le texte à déposer/,
    /Vérifier les modèles/, /Envoyer un message d'essai/, /fenêtre de 24\u00a0h/, /facturés par Meta/,
  ]) assert.match(fr, motif);
  const en = section(lire("README.md"));
  for (const motif of [
    /business verification/, /coexistence/, /system user/, /permanent access token/, /whatsapp_business_messaging/, /whatsapp_business_management/,
    /Phone number ID/, /WhatsApp Business account ID/, /Test the connection/, /Show the text to register/, /Check templates/, /Send a test message/,
    /24-hour window/, /charged to the institute/,
  ]) assert.match(en, motif);
  assert.deepEqual(prose(fr).flatMap((l) => frenchFaults(l)), []);
  assert.deepEqual(prose(en).flatMap((l) => englishFaults(l)), []);
  for (const doc of [fr, en]) assert.doesNotMatch(doc, /\u2014/);
});

test("le lien de l'écran vise ces sections (W-14)", () => {
  assert.ok(GUIDE_META.fr.endsWith("deploy/LISEZMOI.md#whatsapp-business"));
  assert.ok(GUIDE_META.en.endsWith("deploy/README.md#whatsapp-business"));
  assert.match(lire("LISEZMOI.md"), /\n## WhatsApp Business\n/);
  assert.match(lire("README.md"), /\n## WhatsApp Business\n/);
});
