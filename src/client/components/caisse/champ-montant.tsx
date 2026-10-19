import { useState } from "preact/hooks";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/provider";
import { texteRendu } from "@/lib/saisie-montant";

type Props = Omit<Parameters<typeof Input>[0], "value" | "onInput"> & {
  /** Montant en unités mineures, tenu par le formulaire. */
  amount: number;
  /** Zéro rend un champ vide (champ modifiable) ; sinon « 0 ». */
  blankZero?: boolean;
  /** Appelé à chaque frappe avec le texte affiché avant elle ; doit passer par `typeAmount`, qui réécrit le champ. */
  onInput: (e: Event, texteAvant: string) => void;
};

/**
 * Champ de montant reformaté à la frappe. Il garde le texte écrit par
 * `typeAmount` et le rend tel quel tant qu'il se lit comme le montant : sinon
 * « 15, » deviendrait « 15,00 » au rendu suivant et le curseur sauterait.
 */
export function ChampMontant({ amount, blankZero = true, onInput, ...rest }: Props) {
  const { lang } = useI18n();
  const [saisi, setSaisi] = useState<string | null>(null);
  const texte = texteRendu(saisi, amount, lang, blankZero);
  return (
    <Input
      {...rest}
      value={texte}
      onInput={(e: Event) => {
        onInput(e, texte);
        setSaisi((e.currentTarget as HTMLInputElement).value);
      }}
    />
  );
}
