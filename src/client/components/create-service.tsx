import { useState } from "preact/hooks";
import { useApp } from "../context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/provider";
import { modeSaisieMontant, parseAmount, texteSaisie } from "@/lib/format";
import { amountProblem, nameProblem } from "@/lib/forms";
import { STAFF_INKS } from "@/lib/inks";
import { InkPicker } from "./ink-picker";
import type { Service } from "../types";
import { Erreur } from "./champ";

const COLORS = STAFF_INKS.map((ink) => ink.hex);

/** Prestation : création, ou modification de `service`. Chaque texte a sa version anglaise facultative juste en dessous (spec § 5.2). */
export function CreateService({ onClose, service }: { onClose: () => void; service?: Service }) {
  const { addService, updateService } = useApp();
  const { t, lang } = useI18n();
  const [name, setName] = useState(service?.name ?? "");
  const [nameEn, setNameEn] = useState(service?.name_en ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [descriptionEn, setDescriptionEn] = useState(service?.description_en ?? "");
  const [duration, setDuration] = useState(String(service?.duration ?? 60));
  const [price, setPrice] = useState(texteSaisie(service ? service.price : 0, lang));
  const [category, setCategory] = useState(service?.category ?? "");
  const [categoryEn, setCategoryEn] = useState(service?.category_en ?? "");
  const [color, setColor] = useState(service?.color ?? COLORS[0]);
  const [enLigne, setEnLigne] = useState(Boolean(service?.en_ligne));
  const [seulement, setSeulement] = useState(Boolean(service?.supplement_seulement));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    const problem = nameProblem(name) ?? amountProblem(price, "prix");
    if (problem) { setError(t(problem)); return; }
    // Durée de 5 à 720 minutes ; 0 permis pour un « supplément seulement » (spec du 18/10/2026 § 3.1).
    const parsed = parseInt(duration);
    const dureeLue = Number.isNaN(parsed) ? 60 : parsed;
    if (!seulement && (dureeLue < 5 || dureeLue > 720)) { setError(t("prestation.duree_bornes")); return; }
    const data = {
      name: name.trim(), name_en: nameEn.trim(), description, description_en: descriptionEn,
      duration: dureeLue, price: parseAmount(price), category: category.trim(), category_en: categoryEn.trim(), color,
      en_ligne: enLigne ? 1 : 0,
      supplement_seulement: seulement ? 1 : 0,
    };
    setSaving(true);
    try {
      if (service) await updateService(service.id, data);
      else await addService(data);
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
          <DialogTitle>{service ? t("prestation.modifier_titre") : t("prestation.ajouter")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fp-nom">{t("donnee.nom_fr")}</Label>
            <Input id="fp-nom" lang="fr" value={name} onChange={(e: Event) => setName((e.target as HTMLInputElement).value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fp-nom-en">{t("donnee.nom_en")}</Label>
            <Input id="fp-nom-en" lang="en" value={nameEn} onChange={(e: Event) => setNameEn((e.target as HTMLInputElement).value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fp-description">{t("donnee.description_fr")}</Label>
            <Textarea id="fp-description" lang="fr" rows={2} value={description} onChange={(e: Event) => setDescription((e.target as HTMLTextAreaElement).value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fp-description-en">{t("donnee.description_en")}</Label>
            <Textarea id="fp-description-en" lang="en" rows={2} value={descriptionEn} onChange={(e: Event) => setDescriptionEn((e.target as HTMLTextAreaElement).value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fp-duree">{t("prestation.duree_min")}</Label>
              <Input id="fp-duree" type="number" min={seulement ? "0" : "5"} step="5" value={duration} onChange={(e: Event) => setDuration((e.target as HTMLInputElement).value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fp-prix">{t("prestation.prix")}</Label>
              {/* Champ de texte, non "number" : un "number" ne transmet jamais une saisie avec espace ("15 000"), la valeur arrive vide (décision du contrôleur, écart 1). */}
              <Input id="fp-prix" type="text" inputMode={modeSaisieMontant()} value={price} onChange={(e: Event) => setPrice((e.target as HTMLInputElement).value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fp-categorie">{t("donnee.categorie_fr")}</Label>
            <Input id="fp-categorie" lang="fr" value={category} onChange={(e: Event) => setCategory((e.target as HTMLInputElement).value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fp-categorie-en">{t("donnee.categorie_en")}</Label>
            <Input id="fp-categorie-en" lang="en" value={categoryEn} onChange={(e: Event) => setCategoryEn((e.target as HTMLInputElement).value)} />
          </div>
          <div className="space-y-1">
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={seulement} onChange={() => { if (!seulement) setEnLigne(false); setSeulement(!seulement); }} />
              {t("prestation.supplement_seulement")}
            </label>
            <p className="text-xs text-muted-foreground">{t("prestation.supplement_seulement_aide")}</p>
          </div>
          {!seulement && (
            <div className="space-y-1">
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={enLigne} onChange={() => setEnLigne(!enLigne)} />
                {t("prestation.en_ligne")}
              </label>
              <p className="text-xs text-muted-foreground">{t("prestation.en_ligne_aide")}</p>
            </div>
          )}
          <InkPicker color={color} onChange={setColor} />
        </div>
        <Erreur message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("commun.annuler")}</Button>
          <Button disabled={saving} onClick={handleSubmit}>
            {saving ? t("commun.enregistrement") : service ? t("commun.enregistrer_modifications") : t("prestation.ajouter")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
