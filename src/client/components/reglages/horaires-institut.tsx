import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import { useLoad } from "../../hooks/use-load";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { semaineProblem, type Semaine } from "../../../shared/horaires";
import { Erreur, Succes } from "../champ";
import { useConfirmation } from "../auth/confirmation";
import { EtatChargement, EtatErreur } from "../comptoir";
import { EditeurSemaine } from "./editeur-semaine";

/** Horaires d'ouverture de l'institut (gérante, spec du 16/10/2026 § 4.1), dans la rubrique Institut. */
export function HorairesInstitut() {
  const confirm = useConfirmation();
  const { t } = useI18n();
  const { data, error: loadError, reload } = useLoad(() => api<{ institut: Semaine }>("GET", "/api/horaires"), ["settings"]);
  const [semaine, setSemaine] = useState<Semaine | null>(null);
  const [baseline, setBaseline] = useState<Semaine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Un signal « settings » recharge la semaine : la saisie en cours est gardée
  // tant qu'elle diffère de la base, sinon elle prend la nouvelle valeur.
  useEffect(() => {
    if (!data) return;
    const fresh = data.institut;
    if (!semaine || !baseline || JSON.stringify(semaine) === JSON.stringify(baseline)) setSemaine(fresh);
    setBaseline(fresh);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!semaine) return loadError ? <EtatErreur message={loadError} onRetry={() => void reload()} /> : <EtatChargement />;

  const submit = async (e: Event) => {
    e.preventDefault();
    setOk(null);
    setError(null);
    if (semaineProblem(semaine)) { setError(t("horaires.invalides")); return; }
    setPending(true);
    try {
      const done = await confirm(() => api("PUT", "/api/settings/institut.horaires", { value: semaine }));
      if (done === null) return;
      setBaseline(semaine);
      setOk(t("horaires.enregistres"));
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="@container max-w-2xl space-y-4 border-t border-filet pt-6" onSubmit={submit} noValidate>
      <header className="space-y-1">
        <h3 className="text-base font-medium">{t("horaires.titre")}</h3>
        <p className="text-sm text-muted-foreground">{t("horaires.aide")}</p>
      </header>
      <EditeurSemaine id="institut-horaires" valeur={semaine} onChange={setSemaine} vide="ferme" />
      <Erreur message={error} />
      <Succes message={ok} />
      <Button type="submit" disabled={pending}>{t("commun.enregistrer")}</Button>
    </form>
  );
}
