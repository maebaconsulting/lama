import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import type { Setting } from "../../lib/api-types";
import { changedKeys, rebase, valuesOf } from "../../lib/reglages";
import { useLoad } from "../../hooks/use-load";
import { useAuth } from "../../auth-context";
import { AFFICHAGES_MARQUE } from "../../lib/marque";
import { useI18n } from "@/i18n/provider";
import { LANGS } from "@/i18n/translate";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Champ, Erreur, Succes } from "../champ";
import { useConfirmation } from "../auth/confirmation";
import { Rubrique, SELECT } from "./elements";
import { EtatChargement, EtatErreur } from "../comptoir";
import { LogosInstitut } from "./logos-institut";

const KEYS = ["institut.nom", "institut.adresse", "institut.telephone", "institut.langue", "marque.ecran", "marque.documents"] as const;

/**
 * Nom, adresse, téléphone et langue par défaut des tickets et des messages aux
 * clientes (gérante, spec 2 § 4). Cette langue n'est pas celle de l'écran,
 * qui suit chaque compte (spec § 3). Affichage de la marque à l'écran : logo
 * et nom, ou logo seul (renommage lama).
 */
export function Institut() {
  const confirm = useConfirmation();
  const auth = useAuth();
  const { t } = useI18n();
  const { data, error: loadError, reload } = useLoad(() => api<{ settings: Setting[] }>("GET", "/api/settings"), ["settings"]);
  const [baseline, setBaseline] = useState<Record<string, string> | null>(null);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Un signal « settings » recharge les valeurs : les champs non modifiés
  // prennent la nouvelle valeur, ceux en cours de saisie gardent leur brouillon
  // (sinon `changedKeys` y verrait à tort un champ « à enregistrer »).
  useEffect(() => {
    if (!data) return;
    const fresh = valuesOf(data.settings, KEYS);
    if (!form || !baseline) {
      setForm(fresh);
      setBaseline(fresh);
      return;
    }
    const merged = rebase(baseline, form, fresh);
    setBaseline(merged.baseline);
    setForm(merged.form);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!form || !baseline) {
    return (
      <Rubrique titre={t("reglages.rubrique.institut")} description={t("institut.description")}>
        {loadError ? <EtatErreur message={loadError} onRetry={() => void reload()} /> : <EtatChargement />}
      </Rubrique>
    );
  }
  const set = (key: string) => (e: Event) => setForm({ ...form, [key]: (e.currentTarget as HTMLInputElement).value });

  const submit = async (e: Event) => {
    e.preventDefault();
    setOk(null);
    setError(null);
    setPending(true);
    try {
      const changed = changedKeys(baseline, form);
      for (const key of changed) {
        const done = await confirm(() => api("PUT", `/api/settings/${key}`, { value: form[key] }));
        if (done === null) return;
      }
      setOk(t("institut.enregistres"));
      setBaseline(form);
      await reload();
      if (changed.includes("marque.ecran") || changed.includes("institut.nom")) await auth.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Rubrique titre={t("reglages.rubrique.institut")} description={t("institut.description")}>
      <form className="grid max-w-md gap-4" onSubmit={submit} noValidate>
        <Champ id="institut-nom" label={t("institut.nom")} value={form["institut.nom"]} onInput={set("institut.nom")} />
        <Champ id="institut-adresse" label={t("institut.adresse")} autoComplete="street-address" value={form["institut.adresse"]} onInput={set("institut.adresse")} />
        <Champ id="institut-telephone" type="tel" label={t("colonne.telephone")} autoComplete="tel" value={form["institut.telephone"]} onInput={set("institut.telephone")} />
        <div className="space-y-1.5">
          <Label htmlFor="institut-langue">{t("institut.langue")}</Label>
          <select id="institut-langue" className={SELECT} value={form["institut.langue"]} onChange={set("institut.langue")}>
            {LANGS.map((code) => <option key={code} value={code}>{t(code === "fr" ? "langue.nom.fr" : "langue.nom.en")}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="marque-ecran">{t("institut.marque_ecran")}</Label>
          <select id="marque-ecran" className={SELECT} value={form["marque.ecran"]} onChange={set("marque.ecran")} aria-describedby="marque-ecran-aide">
            {AFFICHAGES_MARQUE.map((choix) => <option key={choix} value={choix}>{t(`marque.affichage.${choix}`)}</option>)}
          </select>
          <p id="marque-ecran-aide" className="text-xs text-muted-foreground">{t("institut.marque_ecran_aide")}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="marque-documents">{t("institut.marque_documents")}</Label>
          <select id="marque-documents" className={SELECT} value={form["marque.documents"]} onChange={set("marque.documents")} aria-describedby="marque-documents-aide">
            {AFFICHAGES_MARQUE.map((choix) => <option key={choix} value={choix}>{t(`marque.affichage.${choix}`)}</option>)}
          </select>
          <p id="marque-documents-aide" className="text-xs text-muted-foreground">{t("institut.marque_documents_aide")}</p>
        </div>
        <Erreur message={error ?? loadError} />
        <Succes message={ok} />
        <div><Button type="submit" disabled={pending || changedKeys(baseline, form).length === 0}>{t("commun.enregistrer")}</Button></div>
      </form>
      <div className="max-w-2xl"><LogosInstitut /></div>
    </Rubrique>
  );
}
