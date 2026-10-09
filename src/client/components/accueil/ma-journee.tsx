import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { Check } from "lucide-preact";
import { api } from "../../api";
import { useApp } from "../../context";
import { useAuth } from "../../auth-context";
import { useCalendarRange, useDoualaClock } from "../../hooks/use-journee";
import { useI18n } from "@/i18n/provider";
import { journee, prochainesNotes, type EtatJournee, type NoteDuJour } from "@/lib/accueil";
import { minutesOf } from "@/lib/agenda";
import { pickText } from "@/lib/bilingual";
import { formatLongDate, formatRange, formatTimestamp } from "@/lib/format";
import { onRefresh } from "@/lib/refresh-bus";
import { pathFor } from "@/lib/routes";
import { statusLabel } from "@/lib/statuses";
import { cn } from "@/lib/utils";
import type { Appointment, AppointmentNote, Client } from "../../types";
import { EtatChargement, EtatErreur, EtatVide } from "../comptoir";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Prestations d'un rendez-vous, dans la langue de l'écran. */
function serviceNames(apt: Appointment, lang: "fr" | "en"): string {
  return apt.appointment_services?.map((s) => pickText(lang, s.service_name, s.service_name_en)).filter(Boolean).join(", ") ?? "";
}

/** Durée d'un rendez-vous en minutes, lue sur ses heures. */
function durationOf(apt: Appointment): number {
  return Math.max(0, minutesOf(apt.end_time) - minutesOf(apt.start_time));
}

interface NotesDuProchain {
  notes: NoteDuJour[] | null;
  /** Message du dernier échec (réseau coupé), effacé à la réponse suivante. */
  error: string | null;
  retry: () => void;
}

/**
 * Notes du prochain rendez-vous (§ 5.1) : celles du rendez-vous et de sa
 * réservation (`/api/appointments/:id`), la note sur la cliente
 * (`/api/clients/:id`). Rechargées quand le prochain change ou qu'un signal
 * touche les rendez-vous ou les clientes ; seule la dernière réponse compte.
 * Relecture finale (constat 1, important) : un échec (Wi-Fi de l'institut qui
 * hoquette) garde les notes déjà reçues pour ce rendez-vous, jamais remplacées
 * par une liste vide (une note comme « Peau sensible » peut être vitale).
 */
function useNotesDuProchain(next: Appointment | null): NotesDuProchain {
  const [state, setState] = useState<{ notes: NoteDuJour[] | null; error: string | null }>({ notes: null, error: null });
  const last = useRef(0);
  const id = next?.id ?? null;
  const clientId = next?.client_id ?? null;

  const load = useCallback(() => {
    if (id === null || clientId === null) return;
    const ticket = ++last.current;
    Promise.all([
      api<{ appointment: Appointment & { appointment_notes?: AppointmentNote[] } }>("GET", `/api/appointments/${id}`),
      api<{ client: Client }>("GET", `/api/clients/${clientId}`),
    ]).then(
      ([detail, fiche]) => {
        if (ticket !== last.current) return;
        setState({ notes: prochainesNotes({ notes: detail.appointment.appointment_notes, bookingNote: detail.appointment.notes, clientNotes: fiche.client.notes }), error: null });
      },
      // Échec passager (Wi-Fi de l'institut) : les notes déjà reçues pour ce rendez-vous restent affichées.
      (err: Error) => { if (ticket === last.current) setState((s) => ({ ...s, error: err.message })); },
    );
  }, [id, clientId]);

  useEffect(() => {
    setState({ notes: null, error: null });
    if (id === null || clientId === null) return;
    load();
    const stop = onRefresh((keys) => { if (keys.includes("appointments") || keys.includes("clients")) load(); });
    return () => { last.current++; stop(); };
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, retry: load };
}

/** Le prochain rendez-vous (ou celui en cours), sur fond ivoire : heure, cliente, prestations, durée, notes. */
function Prochain({ apt, onOpen }: { apt: Appointment; onOpen: () => void }) {
  const { t, lang } = useI18n();
  const { notes, error, retry } = useNotesDuProchain(apt);
  const services = serviceNames(apt, lang);
  const libelle = apt.status === "in_progress" ? t("journee.en_ce_moment") : t("journee.prochain");
  return (
    <section aria-label={libelle} className="rounded-sm bg-muted">
      <button type="button" onClick={onOpen} className={cn("block w-full space-y-2 p-5 text-left", FOCUS)}>
        <p className="etiquette text-encre-grise">{libelle}</p>
        <p className="chiffres text-3xl leading-none">{formatRange(apt.start_time, apt.end_time)}</p>
        <p className="font-serif text-2xl leading-tight">{apt.client_name}</p>
        <p className="text-sm text-muted-foreground">
          {services && <>{services} · </>}
          <span className="whitespace-nowrap">{t("commun.minutes", { min: durationOf(apt) })}</span>
        </p>
      </button>
      <div className="space-y-2 border-t border-filet px-5 pb-5 pt-4">
        <p className="etiquette text-encre-grise">{t("journee.notes")}</p>
        {notes === null ? (
          error ? <EtatErreur message={error} onRetry={retry} /> : <EtatChargement />
        ) : (
          <>
            {error && <p role="alert" className="text-sm text-encre-rouge">{error}</p>}
            {notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("journee.aucune_note")}</p>
            ) : (
              <ul className="space-y-2">
                {notes.map((note, index) => (
                  <li key={index} className="text-sm">
                    {note.source !== "rendez-vous" && (
                      <span className="etiquette mr-2 text-encre-grise">{note.source === "cliente" ? t("journee.note_cliente") : t("rdv.note_reservation")}</span>
                    )}
                    <span className="break-words">{note.text}</span>
                    {note.at && <span className="block text-xs text-muted-foreground">{formatTimestamp(note.at, lang)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Une ligne de la journée : heure, cliente et prestations, état ; passé grisé, terminé marqué. */
function Ligne({ apt, etat, onOpen }: { apt: Appointment; etat: EtatJournee; onOpen: () => void }) {
  const { lang } = useI18n();
  const done = etat === "termine" || etat === "absente" || etat === "passe";
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn("flex min-h-12 w-full items-center gap-4 px-4 py-3 text-left transition-colors duration-200 hover:bg-accent", FOCUS, done && "text-muted-foreground")}
      >
        <span className="chiffres-tabulaires w-24 shrink-0 text-sm">{formatRange(apt.start_time, apt.end_time)}</span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate", !done && "font-medium")}>{apt.client_name}</span>
          <span className="block truncate text-sm text-muted-foreground">{serviceNames(apt, lang)}</span>
        </span>
        {etat !== "a-venir" && etat !== "passe" && (
          <span className={cn("flex shrink-0 items-center gap-1 text-xs", etat === "en-cours" && "font-medium text-foreground")}>
            {etat === "termine" && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            {statusLabel(lang, apt.status)}
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * « Ma journée » de la praticienne (sous-projet 4 § 5.1) : la date, le
 * prochain rendez-vous sur fond ivoire avec ce qu'il faut savoir, puis toute
 * la journée en lignes. Toucher un rendez-vous ouvre sa fiche (lecture et
 * note) ; le « + » du cadre ajoute une note au prochain. Jour et heure de
 * Douala ; annulés exclus.
 */
export function MaJournee() {
  const { account } = useAuth();
  const { openPanel, navigate, setCalendarDate } = useApp();
  const { t, lang } = useI18n();
  const clock = useDoualaClock();
  const staffId = account.staff_id;
  const range = useCalendarRange(staffId === null ? null : { start: clock.day, end: clock.day });
  const { rows, next } = journee(range.appointments, staffId, clock.day, clock.time);
  const open = (apt: Appointment) => openPanel("appointment", apt.id);

  const body = () => {
    if (staffId === null) return <EtatVide message={t("journee.sans_fiche")} />;
    if (range.error && !range.loaded) return <EtatErreur message={range.error} onRetry={range.reload} />;
    if (!range.loaded) return <EtatChargement />;
    return (
      <>
        {range.error && <EtatErreur message={range.error} onRetry={range.reload} />}
        {rows.length === 0 ? (
          <EtatVide message={t("journee.vide")} action={{ libelle: t("journee.voir_agenda"), onClick: () => { setCalendarDate(clock.day); navigate(pathFor("calendar", lang)); } }} />
        ) : (
          <>
            {next ? <Prochain apt={next} onOpen={() => open(next)} /> : <p className="rounded-sm bg-muted p-5 font-serif text-xl">{t("journee.finie")}</p>}
            <section className="space-y-2">
              <h2 className="etiquette text-encre-grise">{t("journee.toute_la_journee")}</h2>
              <ul className="divide-y divide-border rounded-sm border border-filet bg-card">
                {rows.map((row) => <Ligne key={row.appointment.id} apt={row.appointment} etat={row.etat} onOpen={() => open(row.appointment)} />)}
              </ul>
            </section>
          </>
        )}
      </>
    );
  };

  return (
    <div className="hors-panneau mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl leading-tight">{t("cadre.ma_journee")}</h1>
        <p className="text-sm text-muted-foreground">{formatLongDate(clock.day, lang)}</p>
      </header>
      {body()}
    </div>
  );
}
