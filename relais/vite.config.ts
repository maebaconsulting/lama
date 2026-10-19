import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

const ici = (chemin: string) => fileURLToPath(new URL(chemin, import.meta.url));

/**
 * Pages du relais (réservation et suivi, gestion des salons) : construites dans relais/dist, servies par le relais.
 * Le relais ne sert que `/assets/*` et `/integrer.js` : tout le reste du dossier construit est celui des deux pages HTML.
 */
export default defineConfig({
  root: ici("./public"),
  publicDir: ici("./public/statique"),
  plugins: [preact()],
  build: {
    outDir: ici("./dist"),
    emptyOutDir: true,
    rollupOptions: { input: { index: ici("./public/index.html"), gestion: ici("./public/gestion.html") } },
  },
  server: { port: 5174, proxy: { "/api": "http://127.0.0.1:8790" } },
});
