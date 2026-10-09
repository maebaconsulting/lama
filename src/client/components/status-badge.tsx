import { useI18n } from "@/i18n/provider";
import { encreVars, statusInk } from "@/lib/inks";
import { statusLabel } from "@/lib/statuses";

/** Statut écrit à l'encre : libellé en capitales espacées, filet de la même encre. */
export function StatusBadge({ status }: { status: string }) {
  const { lang } = useI18n();
  const ink = statusInk(status);
  return (
    <span
      className="encre etiquette inline-flex items-center rounded-sm border px-2 py-0.5"
      style={encreVars(ink)}
    >
      {statusLabel(lang, status)}
    </span>
  );
}

/** « Payé » (sous-projet 5 § 3.4) : une facture cite le rendez-vous ; vu aussi par la praticienne. */
export function PayeBadge() {
  const { t } = useI18n();
  return <span className="etiquette inline-flex items-center rounded-sm border border-foreground px-2 py-0.5">{t("caisse.paye")}</span>;
}

/** « En retard » (cliente attendue, règle `awaitingArrival`) : même badge que les statuts, écrit en cuir comme dans l'agenda. */
export function RetardBadge() {
  const { t } = useI18n();
  return <span className="etiquette inline-flex items-center rounded-sm border border-primary px-2 py-0.5 font-medium text-primary">{t("agenda.en_retard")}</span>;
}
