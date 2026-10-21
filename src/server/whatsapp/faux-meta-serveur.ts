/**
 * Lance le faux Meta sur un port (vérification au navigateur, jamais en production), modèles de lama déposés
 * et approuvés : `node --experimental-strip-types src/server/whatsapp/faux-meta-serveur.ts 3098 jeton-essai`,
 * puis lama avec `LAMA_META_BASE=http://127.0.0.1:3098`.
 */
import { createFakeMeta, registerLamaTemplates, serveFakeMeta } from "./faux-meta.ts";

const port = Number(process.argv[2] ?? 3098);
const fake = createFakeMeta({ token: process.argv[3] ?? "jeton-essai" });
registerLamaTemplates(fake);
await serveFakeMeta(fake, port);
console.log(`Faux Meta à l'écoute sur 127.0.0.1:${port}, numéro ${fake.phoneId}, compte ${fake.wabaId}`);
