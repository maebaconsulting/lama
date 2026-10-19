import { routesLama } from "../routes-lama.ts";
import { services } from "../services.ts";
import type { Base } from "../stockage/base.ts";

/** Base jamais interrogée : la description se calcule sans aucun appel. */
const SANS_BASE: Base = { tous: async () => [], premier: async () => null, executer: async () => ({ changements: 0 }) };

/** Description OpenAPI du contrat v1, produite par les schémas qui valident les appels (routes d'essai comprises). */
export function documentOpenAPI() {
  const app = routesLama(services({ base: SANS_BASE, config: { cleMaitre: "", motDePasseGestion: "", demandesParHeureParIp: 10, turnstile: null } }));
  for (const nom of ["X-Lama-Institut", "X-Lama-Horodatage", "X-Lama-Signature"]) {
    app.openAPIRegistry.registerComponent("securitySchemes", nom, { type: "apiKey", in: "header", name: nom });
  }
  return app.getOpenAPIDocument({
    openapi: "3.0.0",
    info: {
      title: "Contrat lama v1\u00a0: réservation en ligne",
      version: "1.0.0",
      description: "Contrat entre lama et une application de réservation, salon par salon (X-Lama-Institut). La signature, le découpage des plages et la capacité «\u00a0Sans préférence\u00a0» sont décrits dans contrat-v1.md.",
    },
    servers: [{ url: "https://reserver.exemple.com/lama/v1" }],
    security: [{ "X-Lama-Institut": [], "X-Lama-Horodatage": [], "X-Lama-Signature": [] }],
  });
}
