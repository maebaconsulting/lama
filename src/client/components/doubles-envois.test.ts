import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Vague C de la passe V 1.0 : un double appui ne part qu'une fois, et une
 * fenêtre ne se ferme pas pendant son envoi. Vérifié par la source (pas de
 * DOM) ; le verrou lui-même est testé en exécution dans `lib/verrou.test.ts`.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("V1-25 : Postes, « Déclarer cet appareil » et « Enregistrer le délai » passent par le verrou et se grisent", () => {
  const postes = read("./reglages/postes.tsx");
  assert.match(postes, /const envoi = useEnvoi\(\);/);
  assert.match(postes, /await envoi\.lancer\(cle, async \(\) => \{/);
  assert.match(postes, /void agir\("declarer", /);
  assert.match(postes, /void agir\(\s*"delai",/);
  assert.match(postes, /disabled=\{envoi\.enCours\("declarer"\) \|\| !nom\.trim\(\)\}/);
  assert.match(postes, /disabled=\{envoi\.enCours\("delai"\) \|\| !delaiForm\?\.\[DELAI_KEY\]\}/);
});

test("V1-26 : Échap, la croix, le clic dehors et « Annuler » ne ferment pas une fenêtre pendant son envoi", () => {
  for (const [file, flag] of [
    ["./create-appointment.tsx", "saving"],
    ["./agenda/bloquer-creneau.tsx", "saving"],
    ["./campagnes/fenetre-campagne.tsx", "busy"],
  ] as const) {
    const src = read(file);
    assert.doesNotMatch(src, /onOpenChange=\{onClose\}/, `${file} : fermeture directe`);
    assert.match(src, new RegExp(`onOpenChange=\\{\\(o: boolean\\) => \\{ if \\(!o && !${flag}\\) onClose\\(\\); \\}\\}`), `${file} : fermeture ignorée pendant l'envoi`);
    assert.match(src, new RegExp(`<Button (?:type="button" )?variant="outline" disabled=\\{${flag}\\} onClick=\\{onClose\\}>\\{t\\("commun\\.annuler"\\)\\}`), `${file} : « Annuler » grisé pendant l'envoi`);
  }
});

test("V1-27 : fiche cliente, canal et langue des messages grisés pendant l'enregistrement, un seul envoi", () => {
  const bloc = read("./fiches/whatsapp-cliente.tsx");
  assert.match(bloc, /const preference = useEnvoi\(\);/);
  assert.match(bloc, /await preference\.lancer\("preference", \(\) => updateClient\(client\.id, data\)\);/);
  assert.match(bloc, /aria-pressed=\{client\.channel === value\} disabled=\{preference\.occupe\}/);
  assert.match(bloc, /<select id=\{`whatsapp-langue-\$\{client\.id\}`\} className=\{SELECT\} disabled=\{preference\.occupe\}/);
  assert.match(bloc, /change\(\{ channel: value \}\)/, "l'essai des écrans WhatsApp reste vrai");
});

test("V1-28 : Messages, Connexions et File d'envoi : un verrou par groupe ou par ligne, boutons grisés", () => {
  const whatsapp = read("./reglages/whatsapp.tsx");
  assert.match(whatsapp, /const heures = useEnvoi\(\);\s*const sms = useEnvoi\(\);/);
  assert.match(whatsapp, /await envoi\.lancer\("groupe", async \(\) => \{/);
  assert.match(whatsapp, /const saveHours = saveGroup\(heures, HOURS_KEYS,/);
  assert.match(whatsapp, /const saveSms = saveGroup\(sms, SMS_KEYS,/);
  assert.match(whatsapp, /disabled=\{heures\.occupe \|\| !baseline \|\| changedKeysIn\(baseline, form, HOURS_KEYS\)\.length === 0\}/);
  assert.match(whatsapp, /disabled=\{sms\.occupe \|\| !baseline \|\| changedKeysIn\(baseline, form, SMS_KEYS\)\.length === 0\}/);

  const connexions = read("./reglages/connexions.tsx");
  assert.match(connexions, /const envoi = useEnvoi\(\);/);
  assert.match(connexions, /await envoi\.lancer\(key, async \(\) => \{/);
  assert.match(connexions, /<Button type="submit" variant="outline" disabled=\{envoi\.enCours\(TEST\)\}>\{t\("connexions\.enregistrer_test"\)\}/);
  assert.match(connexions, /<Button type="submit" variant="outline" disabled=\{envoi\.enCours\(DRIVE\)\}>\{t\("connexions\.enregistrer_destination"\)\}/);

  const file = read("./reglages/file-envoi.tsx");
  assert.match(file, /const envoi = useEnvoi\(\);/);
  assert.match(file, /await envoi\.lancer\(String\(id\), async \(\) => \{/);
  assert.match(file, /disabled=\{envoi\.enCours\(String\(i\.id\)\)\} onClick=\{\(\) => void relancer\(i\.id\)\}/);
});
