import type { ComponentChildren } from "preact";
import { cn } from "@/lib/utils";

/** En-tête d'une rubrique des Réglages. */
export function Rubrique({ titre, description, children }: { titre: string; description?: string; children: ComponentChildren }) {
  return (
    <div className="space-y-8">
      <header>
        <h2 className="font-serif text-2xl">{titre}</h2>
        {description && <p className="mt-1 max-w-prose text-sm text-encre-grise">{description}</p>}
      </header>
      {children}
    </div>
  );
}

/** Partie d'une rubrique, séparée par un filet. */
export function Bloc({ titre, children }: { titre: string; children: ComponentChildren }) {
  return (
    <section className="space-y-4 border-t border-filet pt-6">
      <h3 className="etiquette text-encre-grise">{titre}</h3>
      {children}
    </section>
  );
}

/**
 * Case à cocher de 44 px de haut, libellé cliquable ; `hint` (retouche P1,
 * critique.md du 1er octobre 2026) : petite aide sous le libellé, pour les
 * réglages dont la conséquence n'est pas évidente sans elle.
 */
export function Case({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label htmlFor={id} className={cn("flex min-h-11 cursor-pointer gap-3 text-sm", hint ? "items-start py-1" : "items-center")}>
      <input id={id} type="checkbox" className={cn("h-4 w-4 shrink-0 accent-primary", hint && "mt-0.5")} checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
      {hint ? (
        <span className="flex flex-col gap-0.5">
          <span>{label}</span>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </span>
      ) : label}
    </label>
  );
}

/** Classe d'une liste déroulante native, alignée sur les champs de saisie (44 px, papier, filet). */
export const SELECT = "flex h-11 w-full rounded-sm border border-input bg-card px-3 text-base focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring md:text-sm";
