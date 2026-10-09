import { useState } from "preact/hooks";
import { useApp } from "../context";
import { useAuth } from "../auth-context";
import { appointmentCommands } from "@/lib/roles";
import { Plus, Search, Trash2 } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n/provider";
import { EMPTY, formatPrice, formatRange, formatShortDate } from "@/lib/format";
import { STATUSES, statusLabel } from "@/lib/statuses";
import { StatusBadge } from "./status-badge";
import { Pagination } from "./pagination";
import { CreateAppointment } from "./create-appointment";
import { encreVars, toInk } from "@/lib/inks";
import { cn } from "@/lib/utils";
import { SELECT } from "./reglages/elements";
import { ConfirmerSuppression } from "./confirmer-suppression";
import type { Appointment } from "../types";

export function AppointmentList() {
  const {
    appointments, appointmentsPag, setAppointmentsPage,
    appointmentsSearch, setAppointmentsSearch,
    appointmentsStatusFilter, setAppointmentsStatusFilter,
    deleteAppointment, openPanel, setError,
  } = useApp();
  const { t, lang } = useI18n();
  const { account } = useAuth();
  // Créer et supprimer : refusés par le serveur à la praticienne, donc masqués (source unique : appointmentCommands).
  const commands = appointmentCommands(account.role);
  const [showCreate, setShowCreate] = useState(false);
  // Décision 5 (passe V 1.0) : la corbeille ouvre une confirmation compacte ; le refus de l'API (V1-14) s'affiche.
  const [aSupprimer, setASupprimer] = useState<Appointment | null>(null);
  const supprimer = (id: number) => deleteAppointment(id).catch((err: Error) => setError(err.message));
  const price = (value: number | null | undefined) => (value == null ? EMPTY : formatPrice(value, lang));

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl leading-tight">{t("menu.rendez_vous")}</h1>
        {commands.create && (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> {t("agenda.nouveau_rdv")}
          </Button>
        )}
      </div>

      {showCreate && <CreateAppointment onClose={() => setShowCreate(false)} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("rdv.rechercher")}
            className="h-11 pl-9"
            placeholder={t("rdv.rechercher")}
            value={appointmentsSearch}
            onInput={(e: Event) => setAppointmentsSearch((e.target as HTMLInputElement).value)}
          />
        </div>
        <select
          aria-label={t("rdv.filtrer")}
          className={cn(SELECT, "sm:w-auto")}
          value={appointmentsStatusFilter}
          onChange={(e) => setAppointmentsStatusFilter((e.target as HTMLSelectElement).value)}
        >
          <option value="">{t("statut.tous")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(lang, s)}</option>)}
        </select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y lg:hidden">
            {appointments.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("rdv.aucun")}</p>
            )}
            {appointments.map((apt) => (
              <div key={apt.id} className="flex items-stretch">
                <button
                  type="button"
                  className="min-w-0 flex-1 p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => openPanel("appointment", apt.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{t("rdv.date_heure", { date: formatShortDate(apt.scheduled_date, lang), heure: apt.start_time })}</p>
                      <p className="break-words font-medium">{apt.client_name || EMPTY}</p>
                      <span className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                        {apt.staff_name && <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm encre-fond" style={encreVars(toInk(apt.staff_color))} />}
                        <span className="truncate">{apt.staff_name || EMPTY}</span>
                      </span>
                    </div>
                    <StatusBadge status={apt.status} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                    <span className="text-primary">{apt.identifier}</span>
                    <span className="font-medium">{price(apt.total_price)}</span>
                  </div>
                </button>
                {commands.remove && !apt.invoiced && <button
                  type="button"
                  aria-label={t("rdv.supprimer", { ref: apt.identifier })}
                  className="flex w-12 shrink-0 items-center justify-center border-l text-muted-foreground transition-colors hover:bg-muted/50 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => setASupprimer(apt)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>}
              </div>
            ))}
          </div>
          <div className="hidden lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">{t("colonne.numero")}</TableHead>
                <TableHead className="w-24">{t("colonne.date")}</TableHead>
                <TableHead className="w-16">{t("colonne.heure")}</TableHead>
                <TableHead>{t("colonne.cliente")}</TableHead>
                <TableHead className="w-36">{t("colonne.membre")}</TableHead>
                <TableHead className="w-24">{t("colonne.statut")}</TableHead>
                <TableHead className="w-28 text-right">{t("colonne.prix")}</TableHead>
                {commands.remove && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {appointments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={commands.remove ? 8 : 7} className="py-8 text-center text-muted-foreground">{t("rdv.aucun")}</TableCell>
                </TableRow>
              )}
              {appointments.map((apt) => (
                <TableRow key={apt.id} className="cursor-pointer" onClick={() => openPanel("appointment", apt.id)}>
                  {/* Vrai bouton : la ligne s'atteint au clavier (Tab) et s'ouvre par Entrée ou Espace, le clic sur la ligne reste pour la souris. */}
                  <TableCell className="font-medium text-primary">
                    <button
                      type="button"
                      aria-label={t("rdv.ouvrir", { ref: apt.identifier, cliente: apt.client_name ?? "" })}
                      className="-mx-2 flex min-h-11 items-center rounded-sm px-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      onClick={(e: Event) => { e.stopPropagation(); openPanel("appointment", apt.id); }}
                    >
                      {apt.identifier}
                    </button>
                  </TableCell>
                  <TableCell className="text-xs">{formatShortDate(apt.scheduled_date, lang)}</TableCell>
                  <TableCell className="text-xs">{apt.start_time}</TableCell>
                  <TableCell>{apt.client_name}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      {apt.staff_name && <span className="inline-block h-2.5 w-2.5 rounded-sm encre-fond" style={encreVars(toInk(apt.staff_color))} />}
                      <span className="text-sm">{apt.staff_name || EMPTY}</span>
                    </span>
                  </TableCell>
                  <TableCell><StatusBadge status={apt.status} /></TableCell>
                  <TableCell className="text-right">{price(apt.total_price)}</TableCell>
                  {commands.remove && <TableCell>
                    {!apt.invoiced && <Button aria-label={t("rdv.supprimer", { ref: apt.identifier })} variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={(e: Event) => { e.stopPropagation(); setASupprimer(apt); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>}
                  </TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
      {commands.remove && aSupprimer && (
        <ConfirmerSuppression
          titre={t("rdv.supprimer_question")}
          detail={t("rdv.supprimer_detail", {
            cliente: aSupprimer.client_name ?? "",
            date: t("rdv.date_plage", { date: formatShortDate(aSupprimer.scheduled_date, lang), plage: formatRange(aSupprimer.start_time, aSupprimer.end_time) }),
          })}
          action={t("rdv.supprimer_rdv")}
          onConfirm={() => supprimer(aSupprimer.id)}
          onClose={() => setASupprimer(null)}
        />
      )}
      <Pagination pag={appointmentsPag} setPage={setAppointmentsPage} />
    </div>
  );
}
