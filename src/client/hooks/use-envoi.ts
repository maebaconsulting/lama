import { useRef, useState } from "preact/hooks";
import { creerVerrou, type Verrou } from "../lib/verrou";

/**
 * Envois d'un écran sans double départ (passe V 1.0, vague C) : `lancer(cle,
 * action)` ignore un second appui tant que la même clé court ; le verrou est
 * synchrone, il tient même entre deux appuis plus rapides que le rendu.
 * `enCours(cle)` et `occupe` (une clé au moins) grisent les boutons.
 */
export function useEnvoi(): { lancer: Verrou["lancer"]; enCours: (cle: string) => boolean; occupe: boolean } {
  const [actives, setActives] = useState<ReadonlySet<string>>(() => new Set());
  const verrou = useRef<Verrou | null>(null);
  if (verrou.current === null) verrou.current = creerVerrou(setActives);
  return { lancer: verrou.current.lancer, enCours: (cle) => actives.has(cle), occupe: actives.size > 0 };
}
