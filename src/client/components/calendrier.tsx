import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { ChevronLeft, ChevronRight } from "lucide-preact";
import { useI18n } from "@/i18n/provider";
import { clampDay, inBounds, monthGrid, monthOf, monthTitle, shiftDay, shiftMonth, todayAt, weekdayInitials, weekdayNames } from "@/lib/calendrier";
import { formatLongDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  id: string;
  /** Jour choisi `aaaa-mm-jj`, ou vide. */
  value: string;
  min?: string;
  max?: string;
  /** Élément sous lequel le panneau se place (le champ et son icône). */
  anchor: HTMLElement;
  /** Vrai : le focus passe dans la grille à l'ouverture (clavier, icône). */
  focusGrid: boolean;
  onPick: (day: string) => void;
  /** `refocus` : rendre le focus au champ (Échap), faux après un clic dehors. */
  onClose: (refocus: boolean) => void;
}

const GAP = 4;
const MARGIN = 8;

/**
 * Place le panneau en `position: fixed`, sous le champ, au-dessus s'il ne
 * tient pas dessous, sinon en feuille du bas. Dans une fenêtre, le contenu
 * (DialogContent) est transformé : il devient le bloc conteneur des éléments
 * fixes. Le panneau échappe ainsi au corps qui défile (qui le couperait), et
 * l'origine de ce bloc est mesurée pour viser des coordonnées de l'écran.
 */
function place(panel: HTMLElement, anchor: HTMLElement) {
  const s = panel.style;
  s.position = "fixed";
  s.top = "0px";
  s.left = "0px";
  s.width = "";
  s.paddingBottom = "";
  panel.removeAttribute("data-feuille");
  const origin = panel.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;
  let top: number;
  let left = Math.min(Math.max(MARGIN, a.left), vw - w - MARGIN);
  if (a.bottom + GAP + h <= vh - MARGIN) top = a.bottom + GAP;
  else if (a.top - GAP - h >= MARGIN) top = a.top - GAP - h;
  else {
    // Feuille du bas : toute la largeur, au-dessus de l'indicateur d'accueil.
    panel.setAttribute("data-feuille", "");
    s.width = `${vw}px`;
    s.paddingBottom = "max(0.75rem, env(safe-area-inset-bottom))";
    left = 0;
    top = vh - panel.offsetHeight;
  }
  s.top = `${top - origin.top}px`;
  s.left = `${left - origin.left}px`;
}

/**
 * Calendrier maison bilingue (fiche selecteurs-date) : mois et jours tirés
 * d'Intl dans la langue du compte, semaine commençant le lundi dans les deux
 * langues, aujourd'hui à Douala marqué d'un filet, date choisie en cuir.
 * Clavier : flèches, Page précédente et suivante (mois), Début et Fin
 * (semaine), Entrée pour choisir, Échap pour fermer.
 */
export function Calendrier({ id, value, min, max, anchor, focusGrid, onPick, onClose }: Props) {
  const { t, lang } = useI18n();
  const today = todayAt();
  const [active, setActive] = useState(() => clampDay(monthOf(value) ? value : today, min, max));
  const [view, setView] = useState(() => monthOf(active)!);
  const panel = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const wantFocus = useRef(focusGrid);

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const again = () => place(el, anchor);
    again();
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, true);
    return () => {
      window.removeEventListener("resize", again);
      window.removeEventListener("scroll", again, true);
    };
  }, [anchor, view.year, view.month]);

  // Clic ou toucher en dehors du champ et du panneau : fermeture.
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.contains(target) && !panel.current?.contains(target)) onClose(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [anchor, onClose]);

  // Date tapée au clavier pendant que le panneau est ouvert : la grille suit.
  useEffect(() => {
    const month = monthOf(value);
    if (!month) return;
    setActive(clampDay(value, min, max));
    setView(month);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!wantFocus.current) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-jour="${active}"]`)?.focus();
  }, [active, view.year, view.month]);

  const moveTo = (day: string) => {
    const next = clampDay(day, min, max);
    wantFocus.current = true;
    setActive(next);
    setView(monthOf(next)!);
  };
  const moveMonth = (delta: number) => {
    const target = shiftMonth(view.year, view.month, delta);
    setView(target);
    const last = new Date(Date.UTC(target.year, target.month, 0)).getUTCDate();
    const day = Math.min(Number(active.slice(8, 10)), last);
    setActive(clampDay(`${target.year}-${String(target.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, min, max));
  };
  const pick = (day: string) => {
    if (inBounds(day, min, max)) onPick(day);
  };

  const onGridKey = (event: KeyboardEvent) => {
    const weekday = (Date.UTC(+active.slice(0, 4), +active.slice(5, 7) - 1, +active.slice(8, 10)) / 86_400_000 + 3) % 7; // lundi = 0
    const moves: Record<string, () => void> = {
      "ArrowLeft": () => moveTo(shiftDay(active, -1)),
      "ArrowRight": () => moveTo(shiftDay(active, 1)),
      "ArrowUp": () => moveTo(shiftDay(active, -7)),
      "ArrowDown": () => moveTo(shiftDay(active, 7)),
      "Home": () => moveTo(shiftDay(active, -weekday)),
      "End": () => moveTo(shiftDay(active, 6 - weekday)),
      "PageUp": () => { wantFocus.current = true; moveMonth(-1); },
      "PageDown": () => { wantFocus.current = true; moveMonth(1); },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  };

  const initials = weekdayInitials(lang);
  const names = weekdayNames(lang);
  const titleId = `${id}-titre`;
  const todayOk = inBounds(today, min, max);

  return (
    <div
      ref={panel}
      id={id}
      role="dialog"
      aria-modal="false"
      aria-label={t("calendrier.titre")}
      style={{ position: "fixed", top: 0, left: 0 }}
      className="z-50 w-[20.5rem] max-w-[calc(100vw-1rem)] rounded-sm border border-filet bg-card p-2.5 text-foreground shadow-md data-[feuille]:max-w-none data-[feuille]:rounded-none data-[feuille]:border-x-0 data-[feuille]:border-b-0"
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose(true);
      }}
    >
      <div className="flex items-center justify-between">
        <button type="button" className="flex h-11 w-11 items-center justify-center rounded-sm hover:bg-muted focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring" aria-label={t("calendrier.mois_precedent")} onClick={() => moveMonth(-1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <p id={titleId} className="font-serif text-lg" aria-live="polite">{monthTitle(view.year, view.month, lang)}</p>
        <button type="button" className="flex h-11 w-11 items-center justify-center rounded-sm hover:bg-muted focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring" aria-label={t("calendrier.mois_suivant")} onClick={() => moveMonth(1)}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div ref={grid} role="grid" aria-labelledby={titleId} className="mx-auto w-fit" onKeyDown={onGridKey}>
        <div role="row" className="grid grid-cols-7">
          {initials.map((initial, i) => (
            <div key={i} role="columnheader" aria-label={names[i]} className="flex h-8 w-11 items-center justify-center text-xs text-encre-grise">{initial}</div>
          ))}
        </div>
        {monthGrid(view.year, view.month).map((weekDays, w) => (
          <div key={w} role="row" className="grid grid-cols-7">
            {weekDays.map((day, i) => {
              if (!day) return <div key={i} role="gridcell" className="h-11 w-11" />;
              const chosen = day === value;
              const allowed = inBounds(day, min, max);
              return (
                <div key={day} role="gridcell" aria-selected={chosen}>
                  <button
                    type="button"
                    data-jour={day}
                    tabIndex={day === active ? 0 : -1}
                    aria-label={formatLongDate(day, lang)}
                    aria-current={day === today ? "date" : undefined}
                    aria-disabled={allowed ? undefined : true}
                    className={cn(
                      "chiffres-tabulaires flex h-11 w-11 items-center justify-center rounded-sm text-base md:text-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                      day === today && "border border-encre-grise",
                      chosen ? "bg-primary text-primary-foreground" : allowed ? "hover:bg-muted" : "cursor-not-allowed text-encre-grise opacity-40",
                    )}
                    onClick={() => pick(day)}
                  >
                    {Number(day.slice(8, 10))}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-end">
        <button type="button" disabled={!todayOk} className="flex h-11 items-center rounded-sm px-3 text-sm font-medium hover:bg-muted focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring disabled:opacity-40" onClick={() => pick(today)}>
          {t("calendrier.aujourdhui")}
        </button>
      </div>
    </div>
  );
}
