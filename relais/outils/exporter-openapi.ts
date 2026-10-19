import { mkdirSync, writeFileSync } from "node:fs";
import { documentOpenAPI } from "./openapi.ts";

/** Écrit docs/reservation-en-ligne/contrat-v1.openapi.json (pnpm relais:openapi). */
const dossier = new URL("../../docs/reservation-en-ligne/", import.meta.url);
mkdirSync(dossier, { recursive: true });
const cible = new URL("contrat-v1.openapi.json", dossier);
writeFileSync(cible, `${JSON.stringify(documentOpenAPI(), null, 2)}\n`, "utf8");
console.log(`Description OpenAPI écrite dans ${cible.pathname}`);
