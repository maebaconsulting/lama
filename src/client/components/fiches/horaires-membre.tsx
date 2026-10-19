import { useState } from "preact/hooks";
import { useApp } from "../../context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/provider";
import { semaineProblem, type Semaine } from "../../../shared/horaires";
import type { Staff } from "../../types";
import { Erreur } from "../champ";
import { EditeurSemaine } from "../reglages/editeur-semaine";

/** Semaine type d'une praticienne (gérante, spec du 16/10/2026 § 4.1) : comme l'institut, ou horaires propres. */
export function HorairesMembre({ staff, institut, onClose }: { staff: Staff; institut: Semaine; onClose: () => void }) {
  const { updateStaff } = useApp();
  const { t } = useI18n();
  const [propre, setPropre] = useState(staff.horaires !== null);
  const [semaine, setSemaine] = useState<Semaine>(staff.horaires ?? institut);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (propre && semaineProblem(semaine)) { setError(t("horaires.invalides")); return; }
    setSaving(true);
    try {
      await updateStaff(staff.id, { horaires: propre ? semaine : null });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="md:max-w-2xl">
        <DialogHeader><DialogTitle>{t("membre.modifier_horaires")}</DialogTitle></DialogHeader>
        <div className="@container space-y-4">
          <div className="flex flex-wrap gap-4" role="radiogroup" aria-label={t("membre.horaires")}>
            <label className="flex min-h-11 items-center gap-2"><input type="radio" name="hm-mode" checked={!propre} onChange={() => setPropre(false)} />{t("membre.comme_institut")}</label>
            <label className="flex min-h-11 items-center gap-2"><input type="radio" name="hm-mode" checked={propre} onChange={() => setPropre(true)} />{t("membre.horaires_propres")}</label>
          </div>
          {propre && <EditeurSemaine id="membre-horaires" valeur={semaine} onChange={setSemaine} vide="repos" />}
        </div>
        <Erreur message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("commun.annuler")}</Button>
          <Button disabled={saving} onClick={save}>{t("commun.enregistrer")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
