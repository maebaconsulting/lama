import { useId } from "preact/hooks";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/provider";
import { STAFF_INKS } from "@/lib/inks";

/**
 * Sélecteur de couleur d'encre, partagé par les fiches d'une prestation et
 * d'un membre de l'équipe (décision du contrôleur, tâches 11-12 : bloc
 * auparavant dupliqué entre `create-staff.tsx` et `create-service.tsx`).
 */
export function InkPicker({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="space-y-1.5">
      <Label id={id}>{t("commun.couleur")}</Label>
      <div className="flex flex-wrap gap-2">
        {STAFF_INKS.map((ink) => (
          <button
            key={ink.hex}
            type="button"
            title={t(ink.labelKey)}
            aria-label={t("encre.nom", { nom: t(ink.labelKey) })}
            aria-pressed={color === ink.hex}
            className={`h-11 w-11 rounded-sm transition-colors duration-200 ${color === ink.hex ? "outline outline-1 outline-offset-2 outline-foreground" : ""}`}
            style={{ backgroundColor: ink.hex }}
            onClick={() => onChange(ink.hex)}
          />
        ))}
      </div>
    </div>
  );
}
