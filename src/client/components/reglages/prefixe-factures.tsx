import { useState } from "preact/hooks";
import { api } from "../../api";
import type { Setting } from "../../lib/api-types";
import { prefixeEtat, prefixeSaisi } from "../../lib/reglages-caisse";
import { useI18n } from "@/i18n/provider";
import type { Key } from "@/i18n/translate";
import { Button } from "@/components/ui/button";
import { DEFAULT_INVOICE_PREFIX, documentNumber, isInvoicePrefix, normalizeInvoicePrefix, yearAt } from "../../../shared/caisse";
import { Champ, Erreur, Succes } from "../champ";
import { useConfirmation } from "../auth/confirmation";
import { Bloc } from "./elements";

/**
 * Préfixe des factures (distribution D-01). L'administrateur le règle tant
 * qu'aucune facture n'existe (mot de passe confirmé) ; ensuite, comme pour la
 * gérante qui le lit seulement, il s'affiche figé avec la facture qui le fige.
 * Dans la rubrique de la gérante, ce bloc n'ouvre jamais de second formulaire :
 * il n'en a que pour l'administrateur.
 */
export function PrefixeFactures({ setting, onSaved }: { setting: Setting | undefined; onSaved: () => unknown }) {
  const confirm = useConfirmation();
  const { t } = useI18n();
  const etat = prefixeEtat(setting);
  const [saisie, setSaisie] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Key | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!etat) return null;

  if (!etat.modifiable) {
    return (
      <Bloc titre={t("reglages_caisse.numerotation")}>
        <p className="text-sm">{t("reglages_caisse.prefixe_valeur", { prefixe: etat.valeur })}</p>
        <p className="max-w-prose text-sm text-encre-grise">
          {etat.fige ? t("reglages_caisse.prefixe_fige", { numero: etat.fige }) : t("reglages_caisse.prefixe_administrateur")}
        </p>
      </Bloc>
    );
  }

  const valeur = saisie ?? etat.valeur;
  const apercu = normalizeInvoicePrefix(valeur);
  const exemple = documentNumber(isInvoicePrefix(apercu) ? apercu : DEFAULT_INVOICE_PREFIX, yearAt(Date.now()), 1);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (pending) return;
    setOk(null);
    setError(null);
    const result = prefixeSaisi(valeur);
    if ("error" in result) {
      setFieldError(result.error);
      document.getElementById("caisse-prefixe")?.focus();
      return;
    }
    setPending(true);
    try {
      const done = await confirm(() => api("PUT", "/api/settings/caisse.prefixe", { value: result.value }));
      if (done === null) return;
      setSaisie(null);
      setOk(t("reglages_caisse.prefixe_enregistre"));
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Bloc titre={t("reglages_caisse.numerotation")}>
      <form className="grid max-w-xs gap-3" onSubmit={submit} noValidate>
        <div>
          <Champ
            id="caisse-prefixe"
            label={t("reglages_caisse.prefixe")}
            autoComplete="off"
            autoCapitalize="characters"
            spellcheck={false}
            maxLength={6}
            value={valeur}
            onInput={(e: Event) => { setSaisie((e.currentTarget as HTMLInputElement).value); setFieldError(null); setOk(null); }}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "caisse-prefixe-erreur" : "caisse-prefixe-aide"}
            className={fieldError ? "border-encre-rouge" : undefined}
          />
          {fieldError && <p id="caisse-prefixe-erreur" className="text-sm text-encre-rouge">{t(fieldError)}</p>}
        </div>
        <p id="caisse-prefixe-aide" className="text-sm text-encre-grise">{t("reglages_caisse.prefixe_aide", { numero: exemple })}</p>
        <Erreur message={error} />
        <Succes message={ok} />
        <div><Button type="submit" disabled={pending || normalizeInvoicePrefix(valeur) === etat.valeur}>{t("commun.enregistrer")}</Button></div>
      </form>
    </Bloc>
  );
}
