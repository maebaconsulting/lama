/**
 * Verrou d'envoi (passe V 1.0, vague C) : une action par clé à la fois. Un
 * second appel sur une clé encore occupée est ignoré (rend `false`) au lieu
 * de partir en double ; des clés différentes courent en parallèle (une ligne
 * de la file d'envoi n'en bloque pas une autre). Module pur, testé sous Node ;
 * `useEnvoi` (hooks/use-envoi.ts) le relie à l'écran.
 */
export interface Verrou {
  /** Lance `action` si `cle` est libre et rend `true` ; `false` si elle était occupée. L'erreur de l'action est relancée. */
  lancer: (cle: string, action: () => Promise<unknown>) => Promise<boolean>;
  /** Vrai tant qu'une action de cette clé court. */
  occupe: (cle: string) => boolean;
}

export function creerVerrou(onChange?: (enCours: ReadonlySet<string>) => void): Verrou {
  const enCours = new Set<string>();
  const signaler = () => onChange?.(new Set(enCours));
  return {
    occupe: (cle) => enCours.has(cle),
    lancer: async (cle, action) => {
      if (enCours.has(cle)) return false;
      enCours.add(cle);
      signaler();
      try {
        await action();
        return true;
      } finally {
        enCours.delete(cle);
        signaler();
      }
    },
  };
}
