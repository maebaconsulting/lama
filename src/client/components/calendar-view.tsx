import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { embedded } from "@clawnify/app/client";
import { useApp } from "../context";
import { useAuth } from "../auth-context";
import { ChevronLeft, ChevronRight, Plus, Ban, Download, ShoppingBag, ArrowLeftRight } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { CreateAppointment } from "./create-appointment";
import { BloquerCreneau } from "./agenda/bloquer-creneau";
import { GrilleAgenda } from "./agenda/grille";
import { Pastilles } from "./agenda/pastilles";
import { Succes } from "./champ";
import { TransfertRdv } from "./transfert-rdv";
import { api } from "../api";
import { useLoad } from "../hooks/use-load";
import { useRefresh } from "../hooks/use-refresh";
import { useWide } from "../hooks/use-wide";
import { heuresFermees, type Semaine } from "../../shared/horaires";
import { useI18n } from "@/i18n/provider";
import {
  agendaColumns, countByColumn, defaultColumnKey, neighborColumn, shownColumnKey, swipeStep, type AgendaColumn,
} from "@/lib/agenda";
import { timeAt } from "@/lib/cadre";
import { shiftDay, todayAt } from "@/lib/calendrier";
import { downloadDaySheet } from "@/lib/day-sheet";
import { formatLongDate } from "@/lib/format";
import { appointmentCommands, canSell } from "@/lib/roles";
import { pathFor } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { DemandeAgenda } from "../types";

const MINUTE_MS = 60_000;

/** Nouveau rendez-vous demandé : depuis le bouton (rien de pré-rempli) ou depuis un créneau vide. */
interface CreateRequest {
  staffId: number | null;
  time?: string;
}

/**
 * Agenda (sous-projet 4 § 4.1 et § 4.2). À partir de 768 px : une colonne par
 * praticienne. Sur téléphone : une praticienne à la fois, choisie par les
 * pastilles ou par un glissement latéral ; le « + » du cadre crée le rendez-vous
 * (dans le mode intégré, sans « + », le bouton de la barre reste affiché).
 * Les commandes refusées par le serveur ne sont pas montrées au rôle.
 */
export function CalendarView() {
  const {
    calendarAppointments, calendarBlocked, calendarDate, setCalendarDate,
    staffLookup, agendaStaffId, setAgendaStaffId, navigate,
  } = useApp();
  const { account } = useAuth();
  const { t, lang } = useI18n();
  const commands = appointmentCommands(account.role);
  const wide = useWide();
  const [create, setCreate] = useState<CreateRequest | null>(null);
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [transfer, setTransfer] = useState(false);
  // Avis du dernier transfert, gardé après la fermeture de la fenêtre.
  const [transferNotice, setTransferNotice] = useState<string | null>(null);
  // L'avis porte sur le jour où le transfert a été fait : il disparaît dès qu'on en montre un autre (V1-55).
  useEffect(() => { setTransferNotice(null); }, [calendarDate]);
  // Praticienne choisie à la main sur téléphone (pastille, glissement), gardée d'un jour à l'autre.
  // « Voir son agenda » depuis la fiche d'un membre (vague 4) : sa colonne d'abord, demande consommée.
  const [chosen, setChosen] = useState<string | null>(() => (agendaStaffId !== null ? `s-${agendaStaffId}` : null));
  useEffect(() => { if (agendaStaffId !== null) setAgendaStaffId(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const touch = useRef<{ x: number; y: number } | null>(null);

  // Jour et heure de l'institut (Douala), relus chaque minute pour la ligne « maintenant ».
  const [clock, setClock] = useState(() => ({ day: todayAt(), time: timeAt() }));
  useEffect(() => {
    const timer = setInterval(() => setClock({ day: todayAt(), time: timeAt() }), MINUTE_MS);
    return () => clearInterval(timer);
  }, []);

  const columns = agendaColumns(staffLookup, calendarAppointments, t("commun.non_attribue"));
  // Horaires de l'institut et semaine type (réservation en ligne, § 4.1) : heures fermées grisées par colonne.
  const { data: horaires } = useLoad(() => api<{ institut: Semaine }>("GET", "/api/horaires"), ["settings"]);
  const fermees = (column: AgendaColumn) =>
    horaires ? heuresFermees(staffLookup.find((s) => s.id === column.staffId)?.horaires ?? null, horaires.institut, calendarDate) : [];
  // Demandes en ligne à confirmer du jour (spec § 4.4) : cartes hachurées ; la praticienne n'en reçoit que l'horaire (« Réservé »).
  // Une seule requête par jour affiché ; une réponse arrivée après un changement de jour est ignorée.
  const [enLigne, setEnLigne] = useState<{ date: string; demandes: DemandeAgenda[] } | null>(null);
  const jourAffiche = useRef(calendarDate);
  jourAffiche.current = calendarDate;
  const chargerDemandes = useCallback(async () => {
    const date = jourAffiche.current;
    try {
      const r = await api<{ demandes: DemandeAgenda[] }>("GET", `/api/demandes-en-ligne/agenda?date=${date}`);
      if (date === jourAffiche.current) setEnLigne({ date, demandes: r.demandes });
    } catch {
      // Demandes indisponibles : l'agenda reste lisible sans elles, le prochain signal relira.
    }
  }, []);
  useEffect(() => { void chargerDemandes(); }, [calendarDate, chargerDemandes]);
  useRefresh(["demandes", "calendar"], () => { void chargerDemandes(); });
  const counts = countByColumn(columns, calendarAppointments);
  const shown = shownColumnKey(chosen, columns, defaultColumnKey(account.role, account.staff_id, columns, counts));
  const visible = wide ? columns : columns.filter((c) => c.key === shown);

  const chooseDate = (date: string) => setCalendarDate(date);
  const shiftBy = (delta: number) => chooseDate(shiftDay(calendarDate, delta));

  /** Créneau vide touché : « Nouveau rendez-vous » pré-rempli (praticienne, jour, heure). */
  const onSlot = commands.create ? (column: AgendaColumn, time: string) => setCreate({ staffId: column.staffId, time }) : null;

  // Glissement latéral sur la grille du téléphone : praticienne suivante ou précédente.
  const onTouchStart = (e: TouchEvent) => {
    const point = e.touches[0];
    touch.current = point ? { x: point.clientX, y: point.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    const point = e.changedTouches[0];
    touch.current = null;
    if (!start || !point) return;
    const step = swipeStep(point.clientX - start.x, point.clientY - start.y);
    if (step !== 0) setChosen(neighborColumn(columns, shown, step));
  };

  // Conteneur : la barre du jour suit la largeur réelle de l'agenda (panneau ouvert à côté), pas celle de l'écran.
  return (
    <div className="@container flex h-full min-w-0 flex-col gap-3 p-4 sm:p-6">
      {/* Panneau posé par-dessus (768 à 1279 px) : la barre s'arrête à son bord (hors-panneau, styles.css). */}
      <div className="hors-panneau flex shrink-0 flex-wrap items-center gap-2">
        {/* Au téléphone, l'onglet actif dit déjà « Agenda » : le titre reste pour les lecteurs d'écran. */}
        <h1 className="sr-only font-serif text-3xl leading-tight md:not-sr-only md:mr-auto">{t("menu.agenda")}</h1>
        <div className="flex w-full min-w-0 items-center gap-2 md:w-auto">
          <Button variant="outline" size="icon" aria-label={t("agenda.jour_precedent")} onClick={() => shiftBy(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-0 flex-1 text-center text-sm font-semibold leading-tight @3xl:min-w-[14rem]" aria-live="polite" aria-atomic="true">
            {formatLongDate(calendarDate, lang)}
          </span>
          <Button variant="outline" size="icon" aria-label={t("agenda.jour_suivant")} onClick={() => shiftBy(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={calendarDate === clock.day} onClick={() => chooseDate(clock.day)}>{t("menu.aujourdhui")}</Button>
        </div>
        <div className={cn("grid w-full gap-2 md:flex md:w-auto md:flex-wrap", commands.block ? "grid-cols-2" : "grid-cols-1")}>
          {commands.block && (
            <Button variant="outline" size="sm" className="w-full md:w-auto" onClick={() => setShowBlockForm(true)}>
              <Ban className="h-3.5 w-3.5" /> {t("agenda.bloquer")}
            </Button>
          )}
          <Button variant="outline" size="sm" className="w-full md:w-auto" onClick={() => downloadDaySheet(calendarDate, calendarAppointments, calendarBlocked, lang)}>
            <Download className="h-3.5 w-3.5" /> {t("agenda.feuille_du_jour")}
          </Button>
          {/* Transfert des rendez-vous d'une praticienne absente (spec du 04/10/2026) : au téléphone, sur toute la largeur. */}
          {commands.move && (
            <Button variant="outline" size="sm" className="col-span-2 w-full md:w-auto" onClick={() => setTransfer(true)}>
              <ArrowLeftRight className="h-3.5 w-3.5" /> {t("transfert.ouvrir_agenda")}
            </Button>
          )}
          {/* Vente de comptoir, sans rendez-vous (sous-projet 5 § 4.1) ; au téléphone, sur toute la largeur plutôt qu'en orphelin. */}
          {canSell(account.role) && (
            <Button variant="outline" size="sm" className={cn("w-full md:w-auto", commands.block && "col-span-2")} onClick={() => navigate(pathFor("vente", lang))}>
              <ShoppingBag className="h-3.5 w-3.5" /> {t("caisse.vente")}
            </Button>
          )}
          {/* Sur téléphone, le « + » du cadre crée le rendez-vous (§ 4.2) ; le mode intégré n'a pas de « + ». */}
          {commands.create && (wide || embedded) && (
            <Button size="sm" onClick={() => setCreate({ staffId: null })}>
              <Plus className="h-3.5 w-3.5" /> {t("agenda.nouveau_rdv")}
            </Button>
          )}
        </div>
      </div>

      <Succes message={transferNotice} />

      {commands.block && showBlockForm && <BloquerCreneau day={calendarDate} onClose={() => setShowBlockForm(false)} />}

      {/* Au téléphone, la praticienne de la colonne montrée est présélectionnée ; à partir de 768 px, la réception la choisit. */}
      {commands.move && transfer && (
        <TransfertRdv
          staffId={wide ? null : columns.find((c) => c.key === shown)?.staffId ?? null}
          day={calendarDate}
          onClose={() => setTransfer(false)}
          onDone={setTransferNotice}
        />
      )}

      {create && (
        <CreateAppointment
          onClose={() => setCreate(null)}
          defaultDate={calendarDate}
          defaultStaffId={create.staffId}
          defaultTime={create.time}
        />
      )}

      {!wide && columns.length > 0 && <Pastilles columns={columns} counts={counts} shown={shown} onPick={setChosen} />}

      {columns.length === 0 ? (
        <p className="rounded-sm border border-filet bg-card p-6 text-center text-sm text-muted-foreground">{t("agenda.aucune_praticienne")}</p>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1" onTouchStart={wide ? undefined : onTouchStart} onTouchEnd={wide ? undefined : onTouchEnd}>
          <GrilleAgenda
            columns={visible}
            appointments={calendarAppointments}
            blocked={calendarBlocked}
            day={calendarDate}
            today={clock.day}
            now={clock.time}
            showHeaders={wide}
            onSlot={onSlot}
            canUnblock={commands.block}
            fermees={fermees}
            demandes={enLigne?.date === calendarDate ? enLigne.demandes : []}
            onDemande={account.role === "practitioner" ? null : () => navigate(pathFor("demandes", lang))}
          />
        </div>
      )}
    </div>
  );
}
