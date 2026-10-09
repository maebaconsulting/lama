/**
 * Étape de `pnpm run build` : copie les polices du ticket dans
 * `dist-server/ticket/`, pour que le paquet livré à l'institut (sans
 * `node_modules`) puisse fabriquer les PDF.
 */
import { copyResources } from "./ressources.ts";

const dest = process.argv[2] ?? "dist-server/ticket";
const names = copyResources(dest);
console.log(`Ticket\u00a0: ${names.length} ressources copiées dans ${dest}`);
