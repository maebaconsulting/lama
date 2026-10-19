import { useState } from "preact/hooks";
import { TriangleAlert } from "lucide-preact";
import { api } from "../../api";
import { useApp } from "../../context";
import { useLoad } from "../../hooks/use-load";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/provider";
import { pickText } from "@/lib/bilingual";
import { conflictsFrom, describeConflict, type Conflict } from "@/lib/conflicts";
import { draftOf, supplementPayload, type DraftSupplement } from "@/lib/supplements";
import { afterSaveError } from "@/lib/supplements-rdv";
import type { Appointment, Product } from "../../types";
import { Erreur } from "../champ";
import { ChoixSupplements } from "./choix";

/**
 * Modifier les suppléments d'un rendez-vous (spec du 18/10/2026 § 3.3), tant qu'il n'est pas
 * encaissé : chaque prestation avec ses suppléments ; la liste complète part au serveur, qui
 * recalcule la fin et le total et contrôle le chevauchement (« Enregistrer quand même » ensuite).
 */
export function EditeurSupplements({ apt, onClose }: { apt: Appointment; onClose: () => void }) {
  const { services, staffLookup, saveAppointmentSupplements, selectAppointment } = useApp();
  const { t, lang } = useI18n();
  const charge = useLoad(() => api<{ products: Product[] }>("GET", "/api/products?limit=1000"), ["products"]);
  const catalog = { services, products: charge.data?.products ?? [] };
  const rows = apt.appointment_services ?? [];
  const [drafts, setDrafts] = useState<Record<number, DraftSupplement[]>>(() => Object.fromEntries(rows.map((r) => [r.id, draftOf(r, lang)])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);

  const save = async (allowConflict = false) => {
    setError(null);
    setSaving(true);
    try {
      const body = rows.flatMap((r) => (drafts[r.id] ?? []).map((d) => ({ appointment_service_id: r.id, ...supplementPayload(d) })));
      await saveAppointmentSupplements(apt.id, body, allowConflict);
      onClose();
    } catch (err) {
      // Un 409 sans conflits (rendez-vous encaissé entre-temps) se dit comme une erreur, et la fiche est relue.
      const next = afterSaveError(conflictsFrom(err), (err as Error).message);
      setConflicts(next.conflicts);
      setError(next.error);
      if (next.reload) void selectAppointment(apt.id);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o: boolean) => { if (!o && !saving) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("rdv.supplements_titre")}</DialogTitle>
          <DialogDescription>{t("rdv.supplements_aide")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {rows.map((r) => (
            <ChoixSupplements
              key={r.id}
              serviceId={r.service_id}
              nom={pickText(lang, r.service_name, r.service_name_en)}
              list={drafts[r.id] ?? []}
              catalog={catalog}
              onChange={(next) => { setConflicts(null); setError(null); setDrafts({ ...drafts, [r.id]: next }); }}
            />
          ))}
        </div>
        {conflicts && (
          <div role="alert" className="flex gap-2.5 rounded-sm border border-encre-rouge bg-card p-3 text-sm text-encre-rouge">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-encre-rouge" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium">{t("conflit.pas_libre", { qui: staffLookup.find((s) => s.id === apt.staff_id)?.name ?? t("conflit.ce_membre") })}</p>
              <ul className="text-muted-foreground">
                {conflicts.map((c) => <li key={`${c.start_time}-${c.label}`}>{describeConflict(c, lang)}</li>)}
              </ul>
            </div>
          </div>
        )}
        <Erreur message={error} />
        <Erreur message={charge.error} />
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>{t("commun.annuler")}</Button>
          {conflicts && <Button variant="outline" disabled={saving || !charge.data} onClick={() => save(true)}>{t("rdv.enregistrer_quand_meme")}</Button>}
          <Button disabled={saving || !charge.data} onClick={() => save()}>{saving ? t("commun.enregistrement") : t("commun.enregistrer")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
