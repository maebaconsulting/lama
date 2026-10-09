import { useState } from "preact/hooks";
import { TriangleAlert } from "lucide-preact";
import { useApp } from "../../context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAmenerALaVue } from "../champ";
import { ChampHeure } from "../champ-date";
import { SELECT } from "../reglages/elements";
import { useI18n } from "@/i18n/provider";
import { conflictsFrom, describeConflict, type Conflict } from "@/lib/conflicts";
import { formatLongDate } from "@/lib/format";

/**
 * Fenêtre « Bloquer un créneau » (revue impeccable, G6) : praticienne, début,
 * fin et motif pour le jour affiché. Un conflit avec un rendez-vous est dit
 * dans la fenêtre, avec « Bloquer quand même » ; rien ne s'insère plus dans
 * l'agenda, qui ne bouge pas sous le doigt.
 */
export function BloquerCreneau({ day, onClose }: { day: string; onClose: () => void }) {
  const { staffLookup, addBlockedSlot, setError } = useApp();
  const { t, lang } = useI18n();
  const [staff, setStaff] = useState("");
  const [start, setStart] = useState("12:00");
  const [end, setEnd] = useState("13:00");
  const [reason, setReason] = useState("");
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const conflictRef = useAmenerALaVue<HTMLDivElement>(conflicts);
  const [saving, setSaving] = useState(false);

  const submit = async (allowConflict = false) => {
    if (!staff) return;
    if (!start || !end) { setError(t("saisie.heure_invalide")); return; }
    setConflicts(null);
    setSaving(true);
    try {
      await addBlockedSlot({
        staff_id: parseInt(staff),
        blocked_date: day,
        start_time: start,
        end_time: end,
        reason,
        ...(allowConflict ? { allow_conflict: true } : {}),
      });
      setError(null);
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
    <Dialog open onOpenChange={(o: boolean) => { if (!o && !saving) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("agenda.bloquer")}</DialogTitle>
          <DialogDescription>{formatLongDate(day, lang)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="block-staff">{t("colonne.membre")}</Label>
          <select id="block-staff" className={SELECT} value={staff} onChange={(e) => { setStaff((e.target as HTMLSelectElement).value); setConflicts(null); }}>
            <option value="">{t("agenda.choisir_membre")}</option>
            {staffLookup.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="block-start">{t("agenda.debut")}</Label>
            <ChampHeure id="block-start" className="h-11 w-full min-w-0" value={start} onValue={(v: string) => { setStart(v); setConflicts(null); }} />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="block-end">{t("agenda.fin")}</Label>
            <ChampHeure id="block-end" borne="fin" className="h-11 w-full min-w-0" value={end} onValue={(v: string) => { setEnd(v); setConflicts(null); }} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="block-reason">{t("agenda.motif")}</Label>
          <Input id="block-reason" placeholder={t("agenda.motif_exemple")} value={reason} onInput={(e: Event) => setReason((e.target as HTMLInputElement).value)} />
        </div>
        {conflicts && (
          <div ref={conflictRef} role="alert" className="flex min-w-0 gap-2.5 rounded-sm border border-encre-rouge bg-card p-3 text-sm text-encre-rouge">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-encre-rouge" aria-hidden="true" />
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{t("conflit.pas_libre", { qui: staffLookup.find((s) => String(s.id) === staff)?.name ?? t("conflit.ce_membre") })}</p>
              <ul className="text-muted-foreground">
                {conflicts.map((conflict, index) => <li key={index}>{describeConflict(conflict, lang)}</li>)}
              </ul>
              <p className="text-muted-foreground">{t("conflit.conseil_bloquer")}</p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>{t("commun.annuler")}</Button>
          {conflicts && <Button variant="outline" disabled={saving} onClick={() => submit(true)}>{t("agenda.bloquer_quand_meme")}</Button>}
          <Button disabled={saving || !staff} onClick={() => submit()}>{t("agenda.ajouter_blocage")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
