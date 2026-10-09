import { useState } from "preact/hooks";
import { useApp } from "../context";
import { Check, TriangleAlert } from "lucide-preact";
import { conflictsFrom, describeConflict, type Conflict } from "@/lib/conflicts";
import { offeredStaffId } from "@/lib/agenda";
import { Button } from "@/components/ui/button";
import { ChampDate, ChampHeure } from "./champ-date";
import { SELECT } from "./reglages/elements";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/provider";
import { pickText } from "@/lib/bilingual";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { todayAt } from "@/lib/calendrier";
import { byCategory } from "@/lib/prestations";
import { Erreur, useAmenerALaVue } from "./champ";

interface Props {
  onClose: () => void;
  defaultDate?: string;
  defaultClientId?: number;
  /** Praticienne du créneau touché dans l'agenda (§ 4.1). */
  defaultStaffId?: number | null;
  /** Heure du créneau touché, `HH:MM` sur la grille de 15 minutes. */
  defaultTime?: string;
}

export function CreateAppointment({ onClose, defaultDate, defaultClientId, defaultStaffId, defaultTime }: Props) {
  const { addAppointment, clientLookup, staffLookup, services } = useApp();
  const { t, lang } = useI18n();
  const [clientId, setClientId] = useState(defaultClientId ? String(defaultClientId) : "");
  const [staffId, setStaffId] = useState(() => offeredStaffId(defaultStaffId, staffLookup));
  const [date, setDate] = useState(defaultDate || todayAt());
  const [startTime, setStartTime] = useState(defaultTime || "09:00");
  const [selectedServices, setSelectedServices] = useState<number[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const conflictRef = useAmenerALaVue<HTMLDivElement>(conflicts);

  const toggleService = (id: number) => {
    setConflicts(null);
    setSelectedServices((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const totalPrice = services
    .filter((s) => selectedServices.includes(s.id))
    .reduce((sum, s) => sum + s.price, 0);

  const totalDuration = services
    .filter((s) => selectedServices.includes(s.id))
    .reduce((sum, s) => sum + s.duration, 0);

  const handleSubmit = async (allowConflict = false) => {
    setError(null);
    if (!clientId) { setError(t("rdv.cliente_manquante")); return; }
    if (!date || !startTime) { setError(t("saisie.date_heure_manquantes")); return; }
    setSaving(true);
    setConflicts(null);
    try {
      await addAppointment({
        client_id: parseInt(clientId),
        staff_id: staffId ? parseInt(staffId) : null,
        scheduled_date: date,
        start_time: startTime,
        notes,
        service_ids: selectedServices,
        ...(allowConflict ? { allow_conflict: true } : {}),
      });
      onClose();
    } catch (err) {
      // A clash is answered in the form, next to the time that caused it, rather
      // than thrown at the page as a failure: the booking is one field away.
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
          <DialogTitle>{t("agenda.nouveau_rdv")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nr-cliente">{t("rdv.cliente_obligatoire")}</Label>
              <select id="nr-cliente" className={SELECT} value={clientId} onChange={(e) => setClientId((e.target as HTMLSelectElement).value)}>
                <option value="">{t("rdv.choisir_cliente")}</option>
                {clientLookup.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nr-membre">{t("rdv.praticienne")}</Label>
              <select id="nr-membre" className={SELECT} value={staffId} onChange={(e) => { setStaffId((e.target as HTMLSelectElement).value); setConflicts(null); }}>
                <option value="">{t("commun.non_attribue")}</option>
                {staffLookup.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nr-date">{t("colonne.date")}</Label>
              <ChampDate id="nr-date" value={date} onValue={(v: string) => { setDate(v); setConflicts(null); }} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nr-heure">{t("rdv.heure_debut")}</Label>
              <ChampHeure id="nr-heure" value={startTime} onValue={(v: string) => { setStartTime(v); setConflicts(null); }} />
            </div>
          </div>

          {/* Revue impeccable (G4) : liste pleine largeur par catégorie, nom à gauche, durée et prix alignés à droite. */}
          <fieldset className="min-w-0 space-y-3">
            <legend className="etiquette mb-1.5 text-encre-grise">{t("menu.prestations")}</legend>
            {byCategory(services, lang).map((group) => (
              <div key={group.category} className="space-y-1">
                {group.category && <p className="font-serif text-base leading-tight">{group.category}</p>}
                <ul className="divide-y divide-border rounded-sm border border-filet">
                  {group.services.map((svc) => {
                    const on = selectedServices.includes(svc.id);
                    return (
                      <li key={svc.id}>
                        <button
                          type="button"
                          aria-pressed={on}
                          className={cn(
                            "flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors duration-200 hover:bg-accent focus-visible:relative focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                            on && "bg-accent",
                          )}
                          onClick={() => toggleService(svc.id)}
                        >
                          <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border", on ? "border-foreground bg-foreground text-background" : "border-encre-grise")} aria-hidden="true">
                            {on && <Check className="h-3 w-3" />}
                          </span>
                          <span className={cn("min-w-0 flex-1 break-words", on && "font-medium")}>{pickText(lang, svc.name, svc.name_en)}</span>
                          <span className="chiffres-tabulaires shrink-0 text-right text-muted-foreground">
                            {t("commun.minutes", { min: svc.duration })} · {formatPrice(svc.price, lang)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {selectedServices.length > 0 && (
              <p className="text-sm font-medium" aria-live="polite">
                {t("rdv.total_ligne", { duree: t("commun.minutes", { min: totalDuration }), prix: formatPrice(totalPrice, lang) })}
              </p>
            )}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="nr-notes">{t("rdv.notes")}</Label>
            <Textarea id="nr-notes" rows={3} placeholder={t("rdv.notes_exemple")} value={notes} onChange={(e: Event) => setNotes((e.target as HTMLTextAreaElement).value)} />
          </div>
        </div>
        {conflicts && (
          <div ref={conflictRef} role="alert" className="flex gap-2.5 rounded-sm border border-encre-rouge bg-card p-3 text-sm text-encre-rouge">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-encre-rouge" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium">
                {t("conflit.pas_libre", { qui: staffLookup.find((s) => String(s.id) === staffId)?.name ?? t("conflit.ce_membre") })}
              </p>
              <ul className="text-muted-foreground">
                {conflicts.map((c) => (
                  <li key={`${c.start_time}-${c.label}`}>{describeConflict(c, lang)}</li>
                ))}
              </ul>
              <p className="text-muted-foreground">{t("conflit.conseil_reserver")}</p>
            </div>
          </div>
        )}
        <Erreur message={error} />
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>{t("commun.annuler")}</Button>
          {conflicts && (
            <Button variant="outline" disabled={saving} onClick={() => handleSubmit(true)}>
              {t("rdv.reserver_quand_meme")}
            </Button>
          )}
          <Button disabled={saving} onClick={() => handleSubmit()}>
            {saving ? t("rdv.reservation_en_cours") : t("rdv.creer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
