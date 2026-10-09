import { ApiError } from "./http.ts";

/** Le serveur exige d'avoir retapé son mot de passe depuis moins de 5 minutes (spec § 3.3). */
export function isConfirmationRequired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.code === "confirmation";
}

/**
 * Exécute une action sensible. Si le serveur demande une confirmation, obtient
 * le mot de passe (`obtain` renvoie faux si la personne annule), puis rejoue
 * l'action une seule fois. Renvoie `null` en cas d'annulation.
 */
export async function withConfirmation<T>(action: () => Promise<T>, obtain: () => Promise<boolean>): Promise<T | null> {
  try {
    return await action();
  } catch (error) {
    if (!isConfirmationRequired(error)) throw error;
  }
  if (!(await obtain())) return null;
  return action();
}

/**
 * Partage une seule demande de confirmation entre plusieurs actions
 * simultanées : si une demande est déjà en cours, `request()` renvoie la même
 * promesse au lieu d'en ouvrir une seconde (la boîte de dialogue ne s'ouvre
 * qu'une fois, et toutes les actions en attente sont rejouées après une seule
 * saisie). `settle` tranche la demande en cours pour tout le monde à la fois ;
 * sans demande en cours, elle ne fait rien.
 */
export function createSharedRequest(open: () => void): { request(): Promise<boolean>; settle(ok: boolean): void } {
  let pending: { promise: Promise<boolean>; resolve: (ok: boolean) => void } | null = null;
  return {
    request(): Promise<boolean> {
      if (pending) return pending.promise;
      let resolve!: (ok: boolean) => void;
      const promise = new Promise<boolean>((res) => { resolve = res; });
      pending = { promise, resolve };
      open();
      return promise;
    },
    settle(ok: boolean): void {
      if (!pending) return;
      const { resolve } = pending;
      pending = null;
      resolve(ok);
    },
  };
}
