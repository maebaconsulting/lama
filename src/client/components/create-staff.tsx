import { useState } from "preact/hooks";
import { useApp } from "../context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/provider";
import { nameProblem } from "@/lib/forms";
import { STAFF_INKS } from "@/lib/inks";
import { InkPicker } from "./ink-picker";
import type { Staff } from "../types";
import { Erreur } from "./champ";

const COLORS = STAFF_INKS.map((ink) => ink.hex);

/** Fiche d'un membre de l'équipe : création, ou modification de `staff`. Fonction en anglais facultative (spec § 5.2). */
export function CreateStaff({ onClose, staff }: { onClose: () => void; staff?: Staff }) {
  const { addStaff, updateStaff } = useApp();
  const { t } = useI18n();
  const [name, setName] = useState(staff?.name ?? "");
  const [email, setEmail] = useState(staff?.email ?? "");
  const [phone, setPhone] = useState(staff?.phone ?? "");
  const [title, setTitle] = useState(staff?.title ?? "");
  const [titleEn, setTitleEn] = useState(staff?.title_en ?? "");
  const [color, setColor] = useState(staff?.color ?? COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    const problem = nameProblem(name);
    if (problem) { setError(t(problem)); return; }
    const data = { name: name.trim(), email, phone, title: title.trim(), title_en: titleEn.trim(), color };
    setSaving(true);
    try {
      if (staff) await updateStaff(staff.id, data);
      else await addStaff(data);
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
        <DialogHeader>
          <DialogTitle>{staff ? t("commun.modifier_nom", { nom: staff.name }) : t("equipe.ajouter_titre")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fe-nom">{t("commun.nom_obligatoire")}</Label>
            <Input id="fe-nom" value={name} onChange={(e: Event) => setName((e.target as HTMLInputElement).value)} placeholder={t("commun.nom_complet")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fe-fonction">{t("donnee.fonction_fr")}</Label>
            <Input id="fe-fonction" value={title} onChange={(e: Event) => setTitle((e.target as HTMLInputElement).value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fe-fonction-en">{t("donnee.fonction_en")}</Label>
            <Input id="fe-fonction-en" lang="en" value={titleEn} onChange={(e: Event) => setTitleEn((e.target as HTMLInputElement).value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fe-email">{t("colonne.email")}</Label>
              <Input id="fe-email" type="email" value={email} onChange={(e: Event) => setEmail((e.target as HTMLInputElement).value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fe-tel">{t("colonne.telephone")}</Label>
              <Input id="fe-tel" type="tel" value={phone} onChange={(e: Event) => setPhone((e.target as HTMLInputElement).value)} />
            </div>
          </div>
          <InkPicker color={color} onChange={setColor} />
        </div>
        <Erreur message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("commun.annuler")}</Button>
          <Button disabled={saving} onClick={handleSubmit}>
            {saving ? t("commun.enregistrement") : staff ? t("commun.enregistrer_modifications") : t("equipe.ajouter")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
