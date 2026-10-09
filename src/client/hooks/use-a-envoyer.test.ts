import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Restes de la V 1.0, point 3 : la pastille « À envoyer à la main » est montée
 * deux fois (rail et barre du téléphone) ; une seule lecture de
 * `/api/whatsapp/manual` au démarrage, toujours relue au signal « outbox ».
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const hook = read("./use-a-envoyer.ts");

test("pastille « À envoyer à la main » : lecture partagée entre ses deux montages", () => {
  assert.match(hook, /import \{ shareRequests \} from "\.\.\/lib\/partage";/);
  assert.match(hook, /export const getManual = shareRequests\(\(url: string\) => api<\{ items: ManualItem\[\] \}>\("GET", url\), 5_000\);/);
  // Montage : réponse récente reprise ; signal du serveur : toujours au serveur.
  assert.match(hook, /useEffect\(\(\) => \{ load\(true\); \}, \[load\]\);/);
  assert.match(hook, /useRefresh\(\["outbox"\], \(\) => load\(false\)\);/);
  assert.doesNotMatch(hook, /useLoad/, "plus de lecture propre à chaque montage");
});

test("les deux montages de la pastille restent le rail et la barre du téléphone", () => {
  assert.match(read("../components/cadre/rail.tsx"), /<CompteurAEnvoyer \/>/);
  assert.match(read("../components/cadre/telephone.tsx"), /<CompteurAEnvoyer \/>/);
  assert.equal(read("../components/cadre/navigation.tsx").match(/useAEnvoyer\(\)/g)?.length, 1);
});
