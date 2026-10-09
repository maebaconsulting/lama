import { useState } from "preact/hooks";
import { useApp } from "../context";
import type { Appointment } from "../types";
import { conflictsFrom, describeConflict, type Conflict } from "@/lib/conflicts";
import { Button } from "@/components/ui/button";
import { Erreur, useAmenerALaVue } from "./champ";
import { ChampDate, ChampHeure } from "./champ-date";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/provider";
import { formatRange, formatShortDate } from "@/lib/format";
import { offersTransferNotice, reschedulePatch } from "@/lib/fiche-rdv";
import { Case, SELECT } from "./reglages/elements";

export function RescheduleAppointment({ appointment, onClose }: { appointment: Appointment; onClose: () => void }) {
  const { updateAppointment, staffLookup } = useApp();
  const { t, lang } = useI18n();
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  const [date, setDate] = useState(appointment.scheduled_date);
  const [startTime, setStartTime] = useState(appointment.start_time);
  const [staffId, setStaffId] = useState(appointment.staff_id ? String(appointment.staff_id) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const conflictRef = useAmenerALaVue<HTMLDivElement>(conflicts);
  // Autre praticienne choisie (spec du 04/10/2026, décision 5) : « Prévenir la cliente », cochée par défaut.
  const [notify, setNotify] = useState(true);
  const notice = offersTransferNotice(appointment.staff_id, staffId ? Number(staffId) : null);
  const patch = reschedulePatch(appointment, { date, time: startTime, staffId: staffId ? Number(staffId) : null });
  const unchanged = patch === null;
  // Nom de la praticienne choisie, pour dire qui n'est pas libre en cas de conflit.
  const chosenName = staffId ? staffLookup.find((s) => String(s.id) === staffId)?.name ?? appointment.staff_name : null;
  const actuel = {
    date: formatShortDate(appointment.scheduled_date, lang),
    plage: formatRange(appointment.start_time, appointment.end_time),
  };

  const clearFeedback = () => { setError(null); setConflicts(null); };
  const close = () => { if (!saving) onClose(); };
  const submit = async (allowConflict: boolean) => {
    if (saving || !patch || !date || !startTime) return;
    setSaving(true);
    clearFeedback();
    try {
      await updateAppointment(appointment.id, {
        ...patch,
        ...(notice ? { notify_transfer: notify } : {}),
        ...(allowConflict ? { allow_conflict: true } : {}),
      });
      onClose();
    } catch (err) {
      const clashes = conflictsFrom(err);
      if (clashes) setConflicts(clashes);
      else setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={close}>
      <DialogContent onCloseAutoFocus={(event: Event) => {
        event.preventDefault();
        opener?.focus();
      }}>
        <DialogHeader>
          <DialogTitle>{t("rdv.deplacer_titre")}</DialogTitle>
          <DialogDescription>
            {t("rdv.deplacer_aide", { cliente: appointment.client_name ?? "", ref: appointment.identifier })}
          </DialogDescription>
        </DialogHeader>
        {/*
          DialogHeader, le corps et DialogFooter sont des enfants DIRECTS de DialogContent :
          la détection de dialog.tsx (en-tête / corps / pied) ne regarde que les enfants
          directs. Un <form> qui engloberait aussi DialogFooter le ferait partir dans le
          corps qui défile avec le reste (relecture 2 : le bouton « Enregistrer les
          modifications » pouvait sortir de l'écran). Le <form> a un id, et les boutons du
          pied lui sont reliés par l'attribut form=, ce qui préserve la validation
          (reportValidity, Entrée pour valider) sans qu'il ait besoin d'envelopper le pied.
        */}
        <form id="reschedule-form" className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          submit(false);
        }}>
          <p className="text-sm text-muted-foreground">
            {appointment.staff_name
              ? t("rdv.actuellement_avec", { ...actuel, nom: appointment.staff_name })
              : t("rdv.actuellement_sans", actuel)}
          </p>
          <fieldset disabled={saving} className="grid min-w-0 grid-cols-2 gap-3">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="reschedule-date">{t("rdv.nouvelle_date")}</Label>
              <ChampDate id="reschedule-date" required value={date} onValue={(v: string) => {
                setDate(v); clearFeedback();
              }} />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="reschedule-time">{t("rdv.heure_debut")}</Label>
              <ChampHeure id="reschedule-time" required value={startTime} onValue={(v: string) => {
                setStartTime(v); clearFeedback();
              }} />
            </div>
            <div className="col-span-2 min-w-0 space-y-1.5">
              <Label htmlFor="reschedule-staff">{t("rdv.praticienne")}</Label>
              <select id="reschedule-staff" className={SELECT} value={staffId} onChange={(e) => {
                setStaffId((e.target as HTMLSelectElement).value); setNotify(true); clearFeedback();
              }}>
                <option value="">{t("commun.non_attribue")}</option>
                {staffLookup.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                {appointment.staff_id && !staffLookup.some((s) => s.id === appointment.staff_id) && (
                  <option value={appointment.staff_id}>{appointment.staff_name ?? t("commun.non_attribue")}</option>
                )}
              </select>
            </div>
            {notice && (
              <div className="col-span-2 min-w-0">
                <Case id="reschedule-notify" label={t("rdv.prevenir_cliente")} hint={notify ? t("rdv.prevenir_cliente_aide", { nom: chosenName ?? "" }) : undefined} checked={notify} onChange={setNotify} />
              </div>
            )}
          </fieldset>
          <Erreur message={error} />
          {conflicts && (
            <div ref={conflictRef} role="alert" className="space-y-1 rounded-sm border border-encre-rouge bg-card p-3 text-sm text-encre-rouge">
              <p className="font-medium">{t("conflit.pas_libre", { qui: chosenName || t("conflit.ce_membre") })}</p>
              <ul className="text-muted-foreground">
                {conflicts.map((conflict, index) => <li key={index}>{describeConflict(conflict, lang)}</li>)}
              </ul>
              <p>{t("conflit.conseil_deplacer")}</p>
            </div>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={close}>{t("commun.annuler")}</Button>
          {conflicts && <Button type="button" variant="outline" disabled={saving} form="reschedule-form" onClick={(event: MouseEvent) => {
            if ((event.currentTarget as HTMLButtonElement).form?.reportValidity()) submit(true);
          }}>{t("rdv.deplacer_quand_meme")}</Button>}
          <Button type="submit" form="reschedule-form" disabled={saving || unchanged}>{saving ? t("commun.enregistrement") : t("commun.enregistrer_modifications")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
