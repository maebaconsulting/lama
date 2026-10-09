import { useEffect, useRef } from "preact/hooks";
import { useI18n } from "@/i18n/provider";
import type { AgendaColumn } from "@/lib/agenda";
import { encreVars, toInk } from "@/lib/inks";
import { cn } from "@/lib/utils";

/**
 * Pastilles de l'agenda sur téléphone (sous-projet 4 § 4.2) : une par
 * praticienne, avec son nombre de rendez-vous du jour ; la pastille choisie
 * est en cuir et reste en vue quand on glisse d'une praticienne à l'autre.
 */
export function Pastilles({ columns, counts, shown, onPick }: {
  columns: AgendaColumn[];
  counts: Record<string, number>;
  shown: string | null;
  onPick: (key: string) => void;
}) {
  const { t, tn } = useI18n();
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [shown]);

  return (
    <div ref={list} role="group" aria-label={t("agenda.praticiennes")} className="-mx-4 flex shrink-0 gap-2 overflow-x-auto px-4 pb-1">
      {columns.map((column) => {
        const active = column.key === shown;
        const count = counts[column.key] ?? 0;
        return (
          <button
            key={column.key}
            type="button"
            aria-pressed={active}
            aria-label={`${column.name}, ${tn("commun.nb_rdv", count)}`}
            onClick={() => onPick(column.key)}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-2 rounded-sm border px-3 text-sm transition-colors duration-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring",
              active ? "border-primary bg-primary text-primary-foreground" : "border-filet bg-card text-foreground hover:bg-muted",
            )}
          >
            <span
              className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-sm", column.color ? "encre-fond" : "bg-encre-grise")}
              style={column.color ? encreVars(toInk(column.color)) : undefined}
              aria-hidden="true"
            />
            <span className="max-w-[9rem] truncate">{column.name}</span>
            <span className="chiffres text-xs opacity-80" aria-hidden="true">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
