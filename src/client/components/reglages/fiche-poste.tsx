import { useState } from "preact/hooks";
import { api } from "../../api";
import { useAuth } from "../../auth-context";
import type { DeviceRow } from "../../lib/api-types";
import { dateHeure } from "../../lib/libelles";
import { useLoad } from "../../hooks/use-load";
import { useI18n } from "@/i18n/provider";
import { Erreur, Succes } from "../champ";
import { BoutonDestructif, EtatChargement, EtatErreur } from "../comptoir";
import { useConfirmation } from "../auth/confirmation";
import { EnTeteFiche, LigneDetail } from "../fiches/corps-fiche";

/**
 * Fiche d'un poste partagé dans le panneau (sous-projet 4 § 7.1) : déclaré
 * le, dernière activité, état ; « Révoquer », au trait rouge avec question,
 * puis confirmation du mot de passe (`useConfirmation`) comme toute action
 * sensible. Un poste révoqué reste lisible, sans action.
 */
export function FichePoste({ id }: { id: number }) {
  const { device, reload: reloadAuth } = useAuth();
  const { t, lang } = useI18n();
  const confirm = useConfirmation();
  const postes = useLoad(() => api<{ devices: DeviceRow[] }>("GET", "/api/devices"), ["accounts"]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (postes.error) return <div className="p-4"><EtatErreur message={postes.error} onRetry={() => void postes.reload()} /></div>;
  if (!postes.data) return <EtatChargement />;
  const poste = postes.data.devices.find((d) => d.id === id);
  if (!poste) return <div className="p-4"><EtatErreur message={t("fiche.introuvable")} /></div>;

  const revoquer = async () => {
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      const done = await confirm(() => api("DELETE", `/api/devices/${poste.id}`));
      if (done !== null) {
        setOk(t("postes.revoque"));
        await postes.reload();
        await reloadAuth();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 p-4">
      <EnTeteFiche titre={poste.name} sousTitre={device?.id === poste.id ? t("postes.cet_appareil") : undefined} />
      <dl className="grid gap-4">
        <LigneDetail libelle={t("colonne.declare_le")}><span className="chiffres-tabulaires">{dateHeure(poste.created_at, lang)}</span></LigneDetail>
        <LigneDetail libelle={t("colonne.derniere_activite")}>
          {/* « jamais » (retouche 10) : texte courant Jost, pas les chiffres de registre réservés aux vraies dates. */}
          {poste.last_seen_at
            ? <span className="chiffres-tabulaires">{dateHeure(poste.last_seen_at, lang)}</span>
            : <span className="text-encre-grise">{t("commun.jamais")}</span>}
        </LigneDetail>
        <LigneDetail libelle={t("colonne.etat")}>{poste.revoked ? t("postes.etat.revoque") : t("compte.etat.actif")}</LigneDetail>
      </dl>
      <Erreur message={error} />
      <Succes message={ok} />
      {!poste.revoked && (
        <div className="space-y-3 border-t border-filet pt-4">
          <BoutonDestructif libelle={t("postes.revoquer")} question={t("postes.question_revocation")} disabled={busy} onConfirm={revoquer} />
        </div>
      )}
    </div>
  );
}
