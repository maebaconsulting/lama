import { useId, useState } from "preact/hooks";
import { Plus } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";
import { modeSaisieMontant, parseAmount } from "@/lib/format";
import { amountProblem } from "@/lib/forms";
import { libreProblem } from "../../../shared/supplements";
import { Erreur } from "../champ";

/**
 * Supplément libre (spec du 18/10/2026 § 3.2) : libellé, prix et, sur un rendez-vous, minutes
 * ajoutées ; contrôlé comme le serveur (`libreProblem`). Rien n'est enregistré au catalogue.
 */
export function ChampsLibre({ minutes, onAdd }: { minutes: boolean; onAdd: (libre: { label: string; price: number; minutes: number }) => void }) {
  const { t } = useI18n();
  const id = useId();
  const [label, setLabel] = useState("");
  const [price, setPrice] = useState("");
  const [mins, setMins] = useState("0");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const value = { label: label.trim(), price: parseAmount(price), minutes: minutes ? Number(mins) : 0 };
    const problem = amountProblem(price, "prix") ? "supplement.libre_prix" : libreProblem(value);
    if (problem) { setError(t(problem)); return; }
    setError(null);
    onAdd(value);
    setLabel("");
    setPrice("");
    setMins("0");
  };

  return (
    <fieldset className="min-w-0 space-y-3 rounded-sm border border-filet p-3">
      <legend className="etiquette px-1 text-encre-grise">{t("supplement.libre")}</legend>
      <p className="text-xs text-muted-foreground">{t("supplement.libre_aide")}</p>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-libelle`}>{t("supplement.libelle")}</Label>
        <Input id={`${id}-libelle`} maxLength={80} value={label} onInput={(e: Event) => setLabel((e.currentTarget as HTMLInputElement).value)} />
      </div>
      <div className={cn("grid gap-3", minutes && "grid-cols-2")}>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-prix`}>{t("supplement.prix")}</Label>
          <Input id={`${id}-prix`} type="text" inputMode={modeSaisieMontant()} value={price} onInput={(e: Event) => setPrice((e.currentTarget as HTMLInputElement).value)} />
        </div>
        {minutes && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-minutes`}>{t("supplement.minutes")}</Label>
            <Input id={`${id}-minutes`} type="number" min="0" max="240" step="5" value={mins} onInput={(e: Event) => setMins((e.currentTarget as HTMLInputElement).value)} />
          </div>
        )}
      </div>
      <Erreur message={error} />
      <Button variant="outline" className="h-11 w-full" onClick={add}><Plus aria-hidden="true" />{t("supplement.ajouter_libre")}</Button>
    </fieldset>
  );
}
