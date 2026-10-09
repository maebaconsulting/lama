import { useEffect, useState } from "preact/hooks";
import { X } from "lucide-preact";
import { api } from "../../api";
import type { Setting } from "../../lib/api-types";
import { pointsText } from "../../lib/fidelite";
import { formatPrice } from "../../lib/format";
import {
  addTier, EXAMPLE_AMOUNT, examplePoints, savedMessage, fideliteChanges, fideliteForm, MAX_TIERS, removeTier, setTier, type FideliteField, type FideliteForm,
} from "../../lib/reglages-fidelite";
import { useLoad } from "../../hooks/use-load";
import { useI18n } from "@/i18n/provider";
import type { Key } from "@/i18n/translate";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Champ, Erreur, Succes } from "../champ";
import { useConfirmation } from "../auth/confirmation";
import { Bloc, Case, Rubrique } from "./elements";
import { EtatChargement, EtatErreur } from "../comptoir";

/**
 * Rubrique « Clientes et fidélité » (mini CRM § 2, gérante ; identifiant
 * `fidelite`) : en tête, l'interrupteur général du mini CRM ; puis la
 * fidélité (activation, règle de gain avec un exemple calculé, paliers de
 * récompense, 1 à 5), grisée tant que le mini CRM est désactivé (valeurs
 * gardées). Chaque réglage changé est enregistré à part et inscrit au
 * journal par le serveur.
 */
export function Fidelite() {
  const confirm = useConfirmation();
  const { t, lang } = useI18n();
  const { data, error: loadError, reload } = useLoad(() => api<{ settings: Setting[] }>("GET", "/api/settings"), ["settings"]);
  const [baseline, setBaseline] = useState<FideliteForm | null>(null);
  const [form, setForm] = useState<FideliteForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Clé du message (pas le texte traduit : une bascule de langue retraduit) et champ fautif, dit sous lui.
  const [fieldError, setFieldError] = useState<{ field: FideliteField; message: Key } | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Rechargement : une saisie en cours est gardée ; sans saisie, les valeurs du serveur sont reprises.
  useEffect(() => {
    if (!data) return;
    const fresh = fideliteForm(data.settings);
    if (!form || !baseline || JSON.stringify(form) === JSON.stringify(baseline)) setForm(fresh);
    setBaseline(fresh);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!form || !baseline) {
    return (
      <Rubrique titre={t("reglages.rubrique.fidelite")} description={t("reglages_crm.description")}>
        {loadError ? <EtatErreur message={loadError} onRetry={() => void reload()} /> : <EtatChargement />}
      </Rubrique>
    );
  }
  const change = (next: FideliteForm) => {
    setOk(null);
    setFieldError(null);
    setForm(next);
  };
  const input = (apply: (value: string) => FideliteForm) => (e: Event) => change(apply((e.currentTarget as HTMLInputElement).value));
  const pendingChanges = fideliteChanges(baseline, form);
  const dirty = "error" in pendingChanges || pendingChanges.changes.length > 0;
  const example = examplePoints(form);
  const errorFor = (field: FideliteField) => (fieldError?.field === field ? t(fieldError.message) : null);
  const invalid = (field: FideliteField) => ({
    "aria-invalid": errorFor(field) ? true : undefined,
    "aria-describedby": errorFor(field) ? `fidelite-${field}-erreur` : undefined,
    className: errorFor(field) ? "border-encre-rouge" : undefined,
  });

  const submit = async (e: Event) => {
    e.preventDefault();
    setOk(null);
    setError(null);
    setFieldError(null);
    const result = fideliteChanges(baseline, form);
    if ("error" in result) {
      setFieldError({ field: result.field, message: result.error });
      document.getElementById(`fidelite-${result.field}`)?.focus();
      return;
    }
    setPending(true);
    try {
      for (const { key, value } of result.changes) {
        const done = await confirm(() => api("PUT", `/api/settings/${key}`, { value }));
        if (done === null) return;
      }
      setOk(t(savedMessage(result.changes)));
      setBaseline(form);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Rubrique titre={t("reglages.rubrique.fidelite")} description={t("reglages_crm.description")}>
      <form className="@container grid max-w-xl gap-8" onSubmit={submit} noValidate>
        <Bloc titre={t("reglages_crm.titre")}>
          <Case id="crm-active" label={t("reglages_crm.active")} hint={t("reglages_crm.aide")} checked={form.crm} onChange={(on) => change({ ...form, crm: on })} />
        </Bloc>
        {!form.crm && <p className="max-w-prose text-sm text-encre-grise">{t("reglages_crm.fidelite_suspendue")}</p>}
        {/* Fidélité : grisée et non modifiable tant que le mini CRM est désactivé ; ses valeurs restent enregistrées. */}
        <fieldset disabled={!form.crm} className={cn("grid min-w-0 gap-8", !form.crm && "opacity-60")}>
          <Bloc titre={t("reglages_fidelite.activation")}>
            <p className="max-w-prose text-sm text-encre-grise">{t("reglages_fidelite.description")}</p>
            <Case id="fidelite-active" label={t("reglages_fidelite.active")} checked={form.active} onChange={(on) => change({ ...form, active: on })} />
          </Bloc>
          <Bloc titre={t("reglages_fidelite.regle")}>
            <div className="grid gap-4 @md:grid-cols-2">
              <div className="space-y-1">
                <Champ id="fidelite-points" label={t("reglages_fidelite.points")} inputMode="numeric" autoComplete="off" value={form.points} onInput={input((v) => ({ ...form, points: v }))} {...invalid("points")} />
                {errorFor("points") && <p id="fidelite-points-erreur" className="text-sm text-encre-rouge">{errorFor("points")}</p>}
              </div>
              <div className="space-y-1">
                <Champ id="fidelite-tranche" label={t("reglages_fidelite.tranche")} inputMode="numeric" autoComplete="off" value={form.tranche} onInput={input((v) => ({ ...form, tranche: v }))} {...invalid("tranche")} />
                {errorFor("tranche") && <p id="fidelite-tranche-erreur" className="text-sm text-encre-rouge">{errorFor("tranche")}</p>}
              </div>
            </div>
            <p className="max-w-prose text-sm text-encre-grise">{t("reglages_fidelite.regle_aide")}</p>
            {example !== null && (
              <p className="text-sm" aria-live="polite">{t("reglages_fidelite.exemple", { montant: formatPrice(EXAMPLE_AMOUNT, lang), points: pointsText(example, lang) })}</p>
            )}
          </Bloc>
          <Bloc titre={t("reglages_fidelite.paliers")}>
            <p className="max-w-prose text-sm text-encre-grise">{t("reglages_fidelite.paliers_aide")}</p>
            <ol className="space-y-4">
              {form.tiers.map((tier, i) => (
                <li key={i} className="flex items-end gap-2">
                  <div className="grid min-w-0 flex-1 gap-2 @lg:grid-cols-2">
                    <Champ
                      id={i === 0 ? "fidelite-paliers" : `fidelite-palier-${i}-points`}
                      label={t("reglages_fidelite.palier_points", { numero: i + 1 })}
                      inputMode="numeric"
                      autoComplete="off"
                      value={tier.points}
                      onInput={input((v) => setTier(form, i, { points: v }))}
                    />
                    <Champ
                      id={`fidelite-palier-${i}-montant`}
                      label={t("reglages_fidelite.palier_montant", { numero: i + 1 })}
                      inputMode="numeric"
                      autoComplete="off"
                      value={tier.montant}
                      onInput={input((v) => setTier(form, i, { montant: v }))}
                    />
                  </div>
                  {form.tiers.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" aria-label={t("reglages_fidelite.retirer_palier", { numero: i + 1 })} onClick={() => change(removeTier(form, i))}>
                      <X aria-hidden="true" />
                    </Button>
                  )}
                </li>
              ))}
            </ol>
            {errorFor("paliers") && <p id="fidelite-paliers-erreur" role="alert" className="text-sm text-encre-rouge">{errorFor("paliers")}</p>}
            {form.tiers.length < MAX_TIERS && (
              <div><Button type="button" variant="outline" onClick={() => change(addTier(form))}>{t("reglages_fidelite.ajouter_palier")}</Button></div>
            )}
          </Bloc>
        </fieldset>
        <Erreur message={error ?? loadError} />
        <Succes message={ok} />
        <div><Button type="submit" disabled={pending || !dirty}>{t("commun.enregistrer")}</Button></div>
      </form>
    </Rubrique>
  );
}
