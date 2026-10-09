import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** Image Docker et fichier pour Dokploy de la démonstration publique (démo publique DP-08, DP-09). */

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

test("Dockerfile : fabrication par pnpm d'après le verrou, exécution en Node 24 léger, seul le résultat fabriqué, compte node, port 8080, Douala, santé", () => {
  const dockerfile = read("Dockerfile");
  const etapes = dockerfile.split(/^FROM /m).slice(1);
  assert.equal(etapes.length, 2, "deux étapes");
  assert.match(etapes[0], /^node:24-alpine AS fabrication\n/);
  assert.match(etapes[0], /RUN npm install --global pnpm@10\.23\.0\n/);
  assert.match(etapes[0], /RUN pnpm install --frozen-lockfile\n/);
  assert.match(etapes[0], /RUN pnpm build\n/);
  const execution = etapes[1];
  assert.match(execution, /^node:24-alpine\n/);
  assert.deepEqual(execution.match(/^COPY .*$/gm), ["COPY --from=fabrication /lama/dist ./dist", "COPY --from=fabrication /lama/dist-server ./dist-server"], "seul le résultat fabriqué");
  assert.match(execution, /^USER node$/m);
  assert.match(execution, /^EXPOSE 8080$/m);
  assert.match(execution, /^VOLUME \/data$/m);
  assert.match(execution, /TZ=Africa\/Douala/);
  assert.match(execution, /LAMA_DATA_DIR=\/data/);
  assert.match(execution, /HEALTHCHECK [^\n]*\\\n\s+CMD \["node", "-e", "fetch\('http:\/\/127\.0\.0\.1:8080\/api\/auth\/state'\)/);
  assert.match(execution, /^CMD \["node", "dist-server\/main\.mjs"\]$/m);
  assert.doesNotMatch(dockerfile, /LAMA_DEMO_MDP_ADMIN|master\.key|ARG /, "aucun secret dans l'image");
});

test(".dockerignore : ni données locales (même dans un sous-dossier), ni clé, ni secret, ni dépôt git, ni documents internes dans le contexte", () => {
  const lignes = read(".dockerignore").split("\n").filter((l) => l && !l.startsWith("#"));
  for (const attendu of [".git", "node_modules", "dist", "dist-server", "data", "**/*.db", "**/*.db-wal", "**/*.db-shm", "**/*.log", "**/.env*", "**/*.key", "**/*.pem", "**/*.age", ".superpowers", "docs", "outils", "deploy"]) {
    assert.ok(lignes.includes(attendu), attendu);
  }
  // Bases, journaux et .env : motifs récursifs, jamais limités à la racine du contexte.
  for (const racine of ["*.db", "*.db-wal", "*.db-shm", "*.log", ".env", ".env.*"]) assert.ok(!lignes.includes(racine), `${racine} : motif récursif attendu`);
});

test("compose pour Dokploy : un service, relance toujours, variables de la démonstration, aucun port publié sur l'hôte, volume nommé pour /data", () => {
  const compose = read("deploy/docker/compose.demo.yml");
  assert.match(compose, /^services:\n {2}lama:\n/m);
  assert.equal(compose.match(/^ {2}[a-z-]+:$/gm)?.filter((l) => l !== "  lama:" && l !== "  lama-demo-donnees:" && l !== "  dokploy-network:").length, 0, "un seul service");
  assert.match(compose, /^ {6}context: \.\.\/\.\.$/m);
  assert.match(compose, /^ {4}restart: always$/m);
  assert.match(compose, /^ {6}LAMA_DEMO_PUBLIQUE: "1"$/m);
  assert.match(compose, /^ {6}LAMA_PROXY_HTTPS: "1"$/m);
  assert.match(compose, /^ {6}LAMA_DEMO_MDP_ADMIN: \$\{LAMA_DEMO_MDP_ADMIN\}$/m, "secret de Dokploy, jamais de valeur dans le dépôt");
  assert.doesNotMatch(compose, /^\s*ports:/m, "port 8080 jamais publié : seul le proxy de Dokploy joint lama");
  assert.match(compose, /^ {6}- "8080"$/m);
  assert.match(compose, /^ {6}- lama-demo-donnees:\/data$/m);
  assert.match(compose, /^networks:\n {2}dokploy-network:\n {4}external: true$/m);
});
