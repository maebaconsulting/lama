import type { ComponentProps } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/provider";
import type { Lang } from "@/i18n/translate";

/** Libellé au-dessus d'un champ de 44 px, relié par `id`. */
export function Champ({ id, label, ...props }: { id: string; label: string } & ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
    </div>
  );
}

/**
 * Vrai tant que la langue n'a pas changé depuis l'arrivée du message : un
 * message écrit avant une bascule est dans l'autre langue, il est masqué
 * (spec § 1 : aucun mot de l'autre langue après une bascule).
 */
export function useSameLang(message: string | null): boolean {
  const { lang } = useI18n();
  const origin = useRef<{ message: string | null; lang: Lang }>({ message, lang });
  if (origin.current.message !== message) origin.current = { message, lang };
  return origin.current.lang === lang;
}

/**
 * Amène l'élément à l'écran chaque fois que `trigger` prend une nouvelle valeur
 * non vide : un refus placé en fin de corps d'une fenêtre qui défile (créneau
 * pris, prix illisible) ne reste ni sous le pied ni hors de la vue (V1-11).
 * Le pied d'une fenêtre est rendu hors de la zone qui défile (DialogContent) :
 * « nearest » dans cette zone suffit, aucun décalage du pied à ajouter
 * (mesuré à 390 × 844 : bas du refus au bas de la zone, pied 16 px plus bas).
 */
export function useAmenerALaVue<T extends HTMLElement>(trigger: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (trigger) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [trigger]);
  return ref;
}

/** Erreur à l'encre rouge, annoncée aux lecteurs d'écran et amenée à l'écran. */
export function Erreur({ message }: { message: string | null }) {
  const visible = useSameLang(message);
  const ref = useAmenerALaVue<HTMLParagraphElement>(message && visible ? message : null);
  return message && visible ? <p ref={ref} role="alert" className="text-sm text-encre-rouge">{message}</p> : null;
}

/** Confirmation discrète qu'une action a réussi. */
export function Succes({ message }: { message: string | null }) {
  const visible = useSameLang(message);
  return message && visible ? <p role="status" className="text-sm text-foreground">{message}</p> : null;
}
