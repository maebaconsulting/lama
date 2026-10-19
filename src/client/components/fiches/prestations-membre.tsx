import { useState } from "preact/hooks";
import { useApp } from "../../context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/provider";
import { pickText } from "@/lib/bilingual";
import type { Staff } from "../../types";
import { Erreur } from "../champ";

/** Prestations pratiquées par une praticienne (gérante, spec § 4.1) : règle en ligne, simple suggestion au comptoir. */
export function PrestationsMembre({ staff, onClose }: { staff: Staff; onClose: () => void }) {
  const { updateStaff, services } = useApp();
  const { t, lang } = useI18n();
  const [choisies, setChoisies] = useState(() => new Set(staff.service_ids));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actives = services.filter((s) => s.active || choisies.has(s.id));

  const basculer = (id: number) => {
    const next = new Set(choisies);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChoisies(next);
  };
  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await updateStaff(staff.id, { service_ids: [...choisies] });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="md:max-w-md">
        <DialogHeader><DialogTitle>{t("membre.prestations_pratiquees")}</DialogTitle></DialogHeader>
        <ul className="max-h-[60vh] space-y-1 overflow-auto">
          {actives.map((s) => (
            <li key={s.id}>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={choisies.has(s.id)} onChange={() => basculer(s.id)} />
                <span>{pickText(lang, s.name, s.name_en)}</span>
              </label>
            </li>
          ))}
        </ul>
        <Erreur message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("commun.annuler")}</Button>
          <Button disabled={saving} onClick={save}>{t("commun.enregistrer")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
