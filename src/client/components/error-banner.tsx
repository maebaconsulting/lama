import { useApp } from "../context";
import { useAuth } from "../auth-context";
import { X } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { defaultPrimaryAction } from "@/lib/cadre";
import { useSameLang } from "./champ";

/**
 * Erreur de l'app en bas à droite (au-dessus de la barre d'onglets et, pour
 * les rôles qui en ont un, du « + » sur téléphone, absent des Réglages :
 * `withPlus`) ; une erreur arrivée avant une bascule de langue est masquée.
 */
export function ErrorBanner({ withPlus }: { withPlus: boolean }) {
  const { error, setError } = useApp();
  const { account } = useAuth();
  const { t } = useI18n();
  const visible = useSameLang(error);
  if (!error || !visible) return null;
  const hasPrimaryAction = withPlus && defaultPrimaryAction(account.role) !== null;
  const bottom = hasPrimaryAction ? "bottom-[calc(8.5rem+env(safe-area-inset-bottom))]" : "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]";
  return (
    <div className={`fixed inset-x-4 ${bottom} z-50 mx-auto flex max-w-md items-center gap-3 rounded-sm border border-encre-rouge bg-card px-4 py-3 text-sm text-encre-rouge md:inset-x-auto md:bottom-[calc(1rem+env(safe-area-inset-bottom))] md:right-4`}>
      <span className="min-w-0 flex-1">{error}</span>
      <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={t("commun.fermer")} onClick={() => setError(null)}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
