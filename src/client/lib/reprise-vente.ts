/**
 * Reprise d'une vente dont la réponse s'est perdue (sous-projet 5 § 7, report
 * de la vague 2), sans dépendance au navigateur : adresse de la vérification
 * et lecture de sa réponse. Seule une réponse « absente » explicite du
 * serveur permet de dégeler le ticket ; tout le reste (réseau, panne, ancien
 * serveur) laisse l'issue inconnue, donc le ticket gelé.
 */

/** Adresse de la vérification : la facture émise pour cette vente, s'il y en a une. */
export function saleLookupPath(requestId: string): string {
  return `/api/sales/${encodeURIComponent(requestId)}`;
}

/** Issue d'une vente perdue : facture trouvée, jamais émise, ou toujours inconnue. */
export type LostSaleVerdict = "emise" | "absente" | "inconnue";

/** Lit le refus de la vérification : 404 au code « absente » seulement, sinon l'issue reste inconnue. */
export function lostSaleVerdict(error: unknown): Exclude<LostSaleVerdict, "emise"> {
  const e = (error && typeof error === "object" ? error : {}) as { status?: unknown; code?: unknown };
  return e.status === 404 && e.code === "absente" ? "absente" : "inconnue";
}
