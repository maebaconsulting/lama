import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Couverture } from "./couverture";

export function Chargement() {
  const { t } = useI18n();
  return <Couverture titre={t("etat.ouverture")} />;
}

/** Serveur injoignable ; si le serveur a répondu par un refus d'écran périmé, son message remplace le texte. */
export function Injoignable({ onRetry, refus = null }: { onRetry: () => Promise<void>; refus?: string | null }) {
  const { t } = useI18n();
  return (
    <Couverture titre={refus ? t("etat.ecran_perime.titre") : t("etat.injoignable.titre")} sousTitre={refus ?? t("etat.injoignable.texte")}>
      <Button className="w-full" onClick={() => void onRetry()}>{t("etat.reessayer")}</Button>
    </Couverture>
  );
}

export function Maintenance() {
  const { t } = useI18n();
  return <Couverture titre={t("etat.maintenance.titre")} sousTitre={t("etat.maintenance.texte")} />;
}
