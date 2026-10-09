/**
 * Lance le faux WAHA sur un port (vérification au navigateur, jamais en
 * production) : `node --experimental-strip-types src/server/whatsapp/faux-waha-serveur.ts 3099 cle-essai`.
 */
import { createFakeWaha, serveFakeWaha } from "./faux-waha.ts";

const port = Number(process.argv[2] ?? 3099);
const key = process.argv[3] ?? "cle-essai";
await serveFakeWaha(createFakeWaha(key), port);
console.log(`Faux WAHA à l'écoute sur 127.0.0.1:${port}`);
