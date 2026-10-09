import { readFileSync } from "fs";
import path from "path";
import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { fabriquerServiceWorker } from "./src/sw/fabrication.ts";

/** Service worker de lama (PWA, P-03) : écrit dans dist/sw.js à la fin de chaque fabrication, d'après le manifeste de Vite. */
function serviceWorker(): Plugin {
  let dist = "";
  return {
    name: "lama-service-worker",
    apply: "build",
    configResolved(config) {
      dist = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const version = (JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as { version: string }).version;
      const { cache, fichiers } = await fabriquerServiceWorker(dist, version);
      console.log(`Service worker\u00a0: ${cache}, ${fichiers.length} fichiers d'enveloppe`);
    },
  };
}

export default defineConfig({
  plugins: [preact(), tailwindcss(), serviceWorker()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Liste des fichiers produits, lue par le greffon du service worker (retirée ensuite de dist).
    manifest: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/client"),
      react: "preact/compat",
      "react-dom": "preact/compat",
      "react/jsx-runtime": "preact/jsx-runtime",
      "react-dom/test-utils": "preact/test-utils",
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
      // Manifeste de l'application installable (PWA, P-01) : servi par le serveur, comme l'API.
      "/manifest.webmanifest": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
