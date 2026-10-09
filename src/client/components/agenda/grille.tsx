import { useEffect, useRef, useState } from "preact/hooks";
import { X } from "lucide-preact";
import { useApp } from "../../context";
import type { Appointment, BlockedSlot } from "../../types";
import { useI18n } from "@/i18n/provider";
import { blockLabelKey, blockLines, blockTone, gridHeight, HOUR_HEIGHT_PX, inColumn, initialScrollTop, minutesOf, nowLineTop, slotAt, type AgendaColumn } from "@/lib/agenda";
import { pickText } from "@/lib/bilingual";
import { DAY_END_HOUR, DAY_START_HOUR } from "@/lib/creneaux";
import { formatRange, hourLabel } from "@/lib/format";
import { encreVars, statusInk, toInk } from "@/lib/inks";
import { packLanes } from "@/lib/overlap";
import { statusLabel } from "@/lib/statuses";
import { cn } from "@/lib/utils";
import { ConfirmerSuppression } from "../confirmer-suppression";

// Graduation de 07:00 à 20:00, journée de 07:00 à 21:00 (bornes partagées avec les créneaux de ChampHeure).
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => i + DAY_START_HOUR);
const DAY_START = DAY_START_HOUR * 60;

/**
 * Rendez-vous et créneaux bloqués d'une colonne, côte à côte quand ils se
 * chevauchent : un blocage (pause déjeuner) n'est jamais caché sous un rendez-vous.
 */
function layOutColumn(appointments: Appointment[], blocked: BlockedSlot[]) {
  return packLanes([
    ...blocked.map((b) => ({
      key: `b-${b.id}`, block: b, appointment: null as Appointment | null,
      start: minutesOf(b.start_time) - DAY_START,
      end: minutesOf(b.end_time) - DAY_START,
    })),
    ...appointments.map((a) => ({
      key: `a-${a.id}`, block: null as BlockedSlot | null, appointment: a,
      start: minutesOf(a.start_time) - DAY_START,
      end: minutesOf(a.end_time) - DAY_START,
    })),
  ]);
}

/** Place d'un élément dans la largeur de sa colonne. */
function laneStyle(lane: number, lanes: number) {
  const width = 100 / lanes;
  return { left: `calc(${lane * width}% + 4px)`, width: `calc(${width}% - 8px)` };
}

const px = (minutes: number) => (minutes / 60) * HOUR_HEIGHT_PX;

/**
 * Grille de l'agenda (sous-projet 4 § 4.1 et § 4.2) : une colonne par
 * praticienne, noms collés en haut et heures collées à gauche pendant le
 * défilement, ligne « maintenant » à l'heure de Douala le jour même,
 * défilement jusqu'à l'heure courante à l'ouverture du jour. Toucher un
 * créneau vide propose un nouveau rendez-vous (`onSlot`, rôles qui peuvent
 * en créer) ; toucher un rendez-vous ouvre sa fiche dans le panneau.
 */
export function GrilleAgenda({ columns, appointments, blocked, day, today, now, showHeaders, onSlot, canUnblock }: {
  columns: AgendaColumn[];
  appointments: Appointment[];
  blocked: BlockedSlot[];
  day: string;
  today: string;
  now: string;
  showHeaders: boolean;
  onSlot: ((column: AgendaColumn, time: string) => void) | null;
  canUnblock: boolean;
}) {
  const { openPanel, deleteBlockedSlot, setError, selectedAppointment } = useApp();
  const { t, lang } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  // Décision 5 (passe V 1.0) : la croix ouvre une confirmation ; elle reste grisée tant que la fenêtre est ouverte.
  const [aRetirer, setARetirer] = useState<BlockedSlot | null>(null);
  const height = gridHeight();
  const nowTop = day === today ? nowLineTop(now) : null;

  // À l'ouverture d'un jour : l'heure courante en vue le jour même (et le début du
  // premier soin encore en cours dans les colonnes montrées), le haut sinon.
  // Pas à chaque minute : la personne garde sa place pendant qu'elle lit.
  useEffect(() => {
    const ongoing = appointments
      .filter((a) => a.scheduled_date === day && a.status === "in_progress" && columns.some((c) => inColumn(c, a.staff_id)))
      .map((a) => a.start_time.slice(0, 5))
      .sort()[0];
    if (scroller.current) scroller.current.scrollTop = initialScrollTop(day, today, now, HOUR_HEIGHT_PX, ongoing);
  }, [day]); // eslint-disable-line react-hooks/exhaustive-deps

  const serviceNames = (apt: Appointment) =>
    apt.appointment_services?.map((s) => pickText(lang, s.service_name, s.service_name_en)).filter(Boolean).join(", ") ?? "";

  const pickSlot = (column: AgendaColumn) => onSlot && ((e: MouseEvent) => {
    // Seul le fond de la colonne est un créneau vide (pas un rendez-vous, pas un blocage).
    if (e.target !== e.currentTarget) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onSlot(column, slotAt(e.clientY - rect.top));
  });

  return (
    <div
      ref={scroller}
      className="isolate min-h-80 min-w-0 flex-1 overflow-auto rounded-sm border border-filet bg-card"
      role="region"
      aria-label={t("agenda.planning")}
      tabIndex={0}
    >
      <div className="flex min-w-full">
        {/* Heures, collées à gauche pendant le défilement horizontal, au-dessus des noms (z-40),
            des blocs (z-20) et de la ligne « maintenant » (z-30). */}
        <div className="sticky left-0 z-50 w-14 shrink-0 border-r border-filet bg-card">
          {showHeaders && <div className="sticky top-0 z-10 h-11 border-b border-filet bg-card" />}
          <div className="relative" style={{ height }}>
            {HOURS.map((h) => (
              <div key={h} className="chiffres absolute right-2 text-xs text-encre-grise" style={{ top: px(h * 60 - DAY_START) + 2 }}>
                {hourLabel(h)}
              </div>
            ))}
          </div>
        </div>

        {columns.map((column) => {
          const items = layOutColumn(
            appointments.filter((a) => inColumn(column, a.staff_id)),
            blocked.filter((b) => inColumn(column, b.staff_id)),
          );
          const ink = column.color ? encreVars(toInk(column.color)) : {};
          const onClick = pickSlot(column);
          return (
            <div key={column.key} className={cn("flex min-w-0 flex-1 flex-col border-r border-filet last:border-r-0", showHeaders && "min-w-[11rem]")}>
              {/* Noms collés en haut : au-dessus des blocs (z-20) et de la ligne « maintenant » (z-30). */}
              {showHeaders && (
                <div className="sticky top-0 z-40 flex h-11 items-center justify-center gap-2 border-b border-filet bg-card px-3">
                  <span className={cn("inline-block h-3 w-3 shrink-0 rounded-sm", column.color ? "encre-fond" : "bg-encre-grise")} style={ink} aria-hidden="true" />
                  <span className="truncate text-sm font-medium">{column.name}</span>
                </div>
              )}
              <div
                className={cn("relative", onClick && "cursor-pointer")}
                style={{ height }}
                onClick={onClick ?? undefined}
                title={onClick ? t("agenda.creneau_libre") : undefined}
              >
                {HOURS.map((h) => (
                  <div key={h} className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-border" style={{ top: px(h * 60 - DAY_START) }} />
                ))}

                {items.map((item) => {
                  const top = px(item.start);
                  const size = px(item.end - item.start);
                  const lane = laneStyle(item.lane, item.lanes);

                  if (item.block) {
                    const block = item.block;
                    return (
                      <div
                        key={item.key}
                        className="absolute z-10 flex items-center justify-between gap-1 rounded-sm bg-muted px-2 text-xs text-muted-foreground"
                        style={{ ...lane, top, height: Math.max(size, 20) }}
                      >
                        <span className="truncate">{block.reason || t("agenda.bloque")}</span>
                        {/* Croix : 44 px de large, toute la hauteur du bloc, sans déborder sur les blocs voisins. */}
                        {canUnblock && (
                          <button
                            type="button"
                            className="-mr-2 flex h-full w-11 shrink-0 items-center justify-center rounded-sm hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                            aria-label={t("agenda.retirer_blocage")}
                            disabled={aRetirer !== null}
                            onClick={(e: Event) => { e.stopPropagation(); setARetirer(block); }}
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    );
                  }

                  const apt = item.appointment!;
                  const services = serviceNames(apt);
                  const plage = formatRange(apt.start_time, apt.end_time);
                  const statut = statusLabel(lang, apt.status);
                  const height = Math.max(size, 28);
                  const lines = blockLines(height);
                  // Passé (terminé, absente) : estompé sur l'ivoire ; cliente attendue : « En retard » en cuir.
                  const tone = blockTone(apt, today, now);
                  const open = selectedAppointment?.id === apt.id;
                  const etat = tone === "retard"
                    ? <span className="font-medium text-foreground">{t("agenda.en_retard")}</span>
                    : <span className="encre" style={encreVars(statusInk(apt.status))}>{statut}</span>;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      aria-current={open ? "true" : undefined}
                      className={cn(
                        "@container absolute z-20 overflow-hidden rounded-sm border border-l-[3px] px-2 py-1 text-left transition-colors duration-200 hover:border-foreground focus-visible:z-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                        tone === "passe" ? "border-filet bg-muted text-muted-foreground" : "border-filet bg-card",
                        // Bloc dont la fiche est ouverte dans le panneau : filet cuir tout autour.
                        open && "z-30 border-foreground outline outline-1 outline-foreground",
                        column.color ? "encre-lisere" : "border-l-encre-grise",
                      )}
                      style={{ ...lane, top, height, ...ink }}
                      aria-label={t(blockLabelKey(tone === "retard", apt.client_name), { plage, cliente: apt.client_name ?? "", statut })}
                      onClick={() => openPanel("appointment", apt.id)}
                    >
                      {lines === 1 ? (
                        // Rendez-vous court, une seule ligne : la cliente d'abord, l'état (§ 4.1) jamais
                        // coupé, l'heure seulement si le bloc a la place pour les trois.
                        <span className="flex min-w-0 items-baseline gap-1 text-xs">
                          <span className="chiffres hidden shrink-0 text-muted-foreground @[12rem]:inline">{apt.start_time.slice(0, 5)}</span>
                          <span className={cn("min-w-0 truncate", tone !== "passe" && "font-semibold")}>{apt.client_name}</span>
                          <span className="shrink-0 whitespace-nowrap">· {etat}</span>
                        </span>
                      ) : (
                        <>
                          <span className="block truncate text-xs"><span className="chiffres text-muted-foreground">{plage}</span> · {etat}</span>
                          <span className={cn("block truncate text-xs", tone !== "passe" && "font-semibold")}>{apt.client_name}</span>
                        </>
                      )}
                      {services && lines === 3 && <span className="block truncate text-xs text-muted-foreground">{services}</span>}
                    </button>
                  );
                })}

                {nowTop !== null && (
                  // Ligne « maintenant » au trait cuir (ivoire en sombre), repère carré : le rouge reste
                  // réservé à la perte, au refus et au conflit (règle de l'encre rouge).
                  <div className="pointer-events-none absolute left-0 right-0 z-30 border-t border-foreground" style={{ top: nowTop }} aria-hidden="true">
                    <span className="absolute -left-[3px] -top-[4px] h-[7px] w-[7px] bg-foreground" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {aRetirer && (
        <ConfirmerSuppression
          titre={t("agenda.retirer_blocage_question")}
          detail={t("agenda.retirer_blocage_detail", { motif: aRetirer.reason || t("agenda.bloque"), plage: formatRange(aRetirer.start_time, aRetirer.end_time) })}
          action={t("agenda.retirer_blocage_bouton")}
          onConfirm={() => deleteBlockedSlot(aRetirer.id).catch((err: Error) => setError(err.message))}
          onClose={() => setARetirer(null)}
        />
      )}
    </div>
  );
}
