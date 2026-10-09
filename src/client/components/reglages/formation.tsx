import { useState } from "preact/hooks";
import { api } from "../../api";
import { emitSessionSignal } from "../../lib/session-bus";
import { useI18n } from "@/i18n/provider";
import { useDemo } from "../../demo-context";
import { Button } from "@/components/ui/button";
import { Erreur } from "../champ";
import { useConfirmation } from "../auth/confirmation";
import { Bloc, Case, Rubrique } from "./elements";

/**
 * Base de formation (distribution D-19), administrateur de la formation :
 * remise à zéro, case cochée puis mot de passe retapé. Le serveur passe en
 * maintenance et redémarre ; tous les écrans l'affichent, puis se rechargent
 * sur la démonstration recréée.
 */
export function Formation() {
  const { t } = useI18n();
  const confirm = useConfirmation();
  // Démonstration publique (DP-05) : remise de chaque nuit, et celle-ci, proposée à l'administration seulement.
  const demo = useDemo() !== null;
  const [compris, setCompris] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const remettre = async () => {
    if (!compris) {
      setError(t("formation.remise.cocher"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const fait = await confirm(() => api("POST", "/api/formation/remise-a-zero"));
      if (fait !== null) emitSessionSignal("maintenance");
      else setError(t("formation.remise.annulee"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Rubrique titre={t("reglages.rubrique.formation")} description={t(demo ? "demo.description" : "formation.description")}>
      <Bloc titre={t("formation.remise.titre")}>
        <p className="max-w-prose text-sm text-encre-grise">{t(demo ? "demo.remise.texte" : "formation.remise.texte")}</p>
        <Case id="formation-compris" label={t("formation.remise.compris")} checked={compris} onChange={setCompris} />
        <Erreur message={error} />
        <div><Button variant="destructive" disabled={pending} onClick={() => void remettre()}>{t("formation.remise.bouton")}</Button></div>
      </Bloc>
    </Rubrique>
  );
}
