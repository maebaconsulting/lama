import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import type { Setting } from "../../lib/api-types";
import { rebase } from "../../lib/reglages";
import { caisseChanges, caisseValues, methodsOf, toggleMethod, type CaisseKey } from "../../lib/reglages-caisse";
import { methodLabel } from "../../lib/caisse-texte";
import { useLoad } from "../../hooks/use-load";
import { useI18n } from "@/i18n/provider";
import type { Key } from "@/i18n/translate";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PAYMENT_METHODS } from "../../../shared/caisse";
import { Champ, Erreur, Succes } from "../champ";
import { useConfirmation } from "../auth/confirmation";
import { useMarque } from "../../marque-context";
import { Bloc, Case, Rubrique } from "./elements";
import { PrefixeFactures } from "./prefixe-factures";
import { useAuth } from "../../auth-context";
import { EtatChargement, EtatErreur } from "../comptoir";

/** Identifiant du champ pour chaque réglage signalé à sa place (retouche R3) : permet le focus au clic sur « Enregistrer ». */
const FIELD_IDS: Partial<Record<CaisseKey, string>> = { "caisse.tva_taux": "caisse-tva-taux", "caisse.remise_plafond": "caisse-plafond" };

/**
 * Rubrique « Caisse » : celle de la gérante, ou, pour l'administrateur, la
 * numérotation des factures seule (distribution D-01).
 */
export function Caisse() {
  const { account } = useAuth();
  return account.role === "admin" ? <CaisseAdministrateur /> : <CaisseGerante />;
}

/** Rubrique « Caisse » de l'administrateur : le préfixe des factures, réglé avant la première vente. */
function CaisseAdministrateur() {
  const { t } = useI18n();
  // « invoices » : la première vente fige le préfixe sans signal « settings » (ruling T2-1).
  const { data, error, reload } = useLoad(() => api<{ settings: Setting[] }>("GET", "/api/settings"), ["settings", "invoices"]);
  return (
    <Rubrique titre={t("reglages.rubrique.caisse")} description={t("reglages_caisse.description_administrateur")}>
      {data
        ? <PrefixeFactures setting={data.settings.find((s) => s.key === "caisse.prefixe")} onSaved={reload} />
        : error ? <EtatErreur message={error} onRetry={() => void reload()} /> : <EtatChargement />}
    </Rubrique>
  );
}

/**
 * Rubrique « Caisse » (sous-projet 5 § 5.2, gérante) : NIU et RCCM, TVA et
 * taux, mentions légales en français et en anglais, fonctions (remises et
 * plafond, pourboires, acomptes, avoirs par la réception), moyens de
 * paiement proposés. Chaque réglage changé est enregistré à part et inscrit
 * au journal par le serveur ; une facture déjà émise garde ses valeurs. Le
 * préfixe des factures s'y lit sans s'y changer (D-01).
 */
function CaisseGerante() {
  const confirm = useConfirmation();
  const { t, lang } = useI18n();
  const marque = useMarque();
  const { data, error: loadError, reload } = useLoad(() => api<{ settings: Setting[] }>("GET", "/api/settings"), ["settings", "invoices"]);
  const [baseline, setBaseline] = useState<Record<CaisseKey, string> | null>(null);
  const [form, setForm] = useState<Record<CaisseKey, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Erreur du taux de TVA ou du plafond de remise : la clé du message (pas le texte traduit, une bascule de langue retraduit) et la clé du champ fautif, dite juste sous lui.
  const [fieldError, setFieldError] = useState<{ key: CaisseKey; message: Key } | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Même règle que la rubrique « Institut » : un rechargement garde les champs en cours de saisie.
  useEffect(() => {
    if (!data) return;
    const fresh = caisseValues(data.settings, lang);
    if (!form || !baseline) {
      setForm(fresh);
      setBaseline(fresh);
      return;
    }
    const merged = rebase(baseline, form, fresh);
    setBaseline(merged.baseline as Record<CaisseKey, string>);
    setForm(merged.form as Record<CaisseKey, string>);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!form || !baseline) {
    return (
      <Rubrique titre={t("reglages.rubrique.caisse")} description={t("reglages_caisse.description")}>
        {loadError ? <EtatErreur message={loadError} onRetry={() => void reload()} /> : <EtatChargement />}
      </Rubrique>
    );
  }
  const set = (key: CaisseKey, value: string) => {
    setOk(null);
    setForm({ ...form, [key]: value });
    if (fieldError?.key === key) setFieldError(null);
  };
  const text = (key: CaisseKey) => (e: Event) => set(key, (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value);
  const flag = (key: CaisseKey) => (on: boolean) => set(key, on ? "oui" : "non");
  const methods = methodsOf(form["caisse.moyens"]);
  const pendingChanges = caisseChanges(baseline, form);
  const dirty = "error" in pendingChanges || pendingChanges.changes.length > 0;
  const tvaError = fieldError?.key === "caisse.tva_taux" ? fieldError : null;
  const plafondError = fieldError?.key === "caisse.remise_plafond" ? fieldError : null;

  const submit = async (e: Event) => {
    e.preventDefault();
    setOk(null);
    setError(null);
    setFieldError(null);
    const result = caisseChanges(baseline, form);
    if ("error" in result) {
      const fieldId = FIELD_IDS[result.key];
      if (fieldId) {
        setFieldError({ key: result.key, message: result.error });
        document.getElementById(fieldId)?.focus();
      } else {
        setError(t(result.error));
      }
      return;
    }
    setPending(true);
    try {
      for (const { key, value } of result.changes) {
        const done = await confirm(() => api("PUT", `/api/settings/${key}`, { value }));
        if (done === null) return;
      }
      setOk(t("reglages_caisse.enregistres"));
      setBaseline(form);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Rubrique titre={t("reglages.rubrique.caisse")} description={t("reglages_caisse.description")}>
      <form className="grid max-w-xl gap-8" onSubmit={submit} noValidate>
        <Bloc titre={t("reglages_caisse.identite")}>
          <p className="max-w-prose text-sm text-encre-grise">{t("reglages_caisse.identite_aide")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ id="caisse-niu" label={t("reglages_caisse.niu")} autoComplete="off" value={form["institut.niu"]} onInput={text("institut.niu")} />
            <Champ id="caisse-rccm" label={t("reglages_caisse.rccm")} autoComplete="off" value={form["institut.rccm"]} onInput={text("institut.rccm")} />
          </div>
        </Bloc>
        <PrefixeFactures setting={data?.settings.find((s) => s.key === "caisse.prefixe")} onSaved={reload} />
        <Bloc titre={t("reglages_caisse.tva")}>
          <Case id="caisse-tva-active" label={t("reglages_caisse.tva_active")} checked={form["caisse.tva_active"] === "oui"} onChange={flag("caisse.tva_active")} />
          <div className="max-w-40">
            <Champ
              id="caisse-tva-taux"
              label={t("reglages_caisse.tva_taux")}
              inputMode="decimal"
              autoComplete="off"
              disabled={form["caisse.tva_active"] !== "oui"}
              value={form["caisse.tva_taux"]}
              onInput={text("caisse.tva_taux")}
              aria-invalid={tvaError ? true : undefined}
              aria-describedby={tvaError ? "caisse-tva-taux-erreur" : undefined}
              className={tvaError ? "border-encre-rouge" : undefined}
            />
            {tvaError && <p id="caisse-tva-taux-erreur" className="text-sm text-encre-rouge">{t(tvaError.message)}</p>}
          </div>
          <p className="max-w-prose text-sm text-encre-grise">{t("reglages_caisse.tva_aide")}</p>
        </Bloc>
        <Bloc titre={t("reglages_caisse.mentions")}>
          <div className="space-y-1.5">
            <Label htmlFor="caisse-mentions-fr">{t("reglages_caisse.mentions_fr")}</Label>
            <Textarea id="caisse-mentions-fr" rows={3} maxLength={500} lang="fr" value={form["caisse.mentions_fr"]} onInput={text("caisse.mentions_fr")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="caisse-mentions-en">{t("reglages_caisse.mentions_en")}</Label>
            <Textarea id="caisse-mentions-en" rows={3} maxLength={500} lang="en" value={form["caisse.mentions_en"]} onInput={text("caisse.mentions_en")} />
          </div>
        </Bloc>
        <Bloc titre={t("reglages_caisse.fonctions")}>
          <Case id="caisse-remises" label={t("reglages_caisse.remises")} checked={form["caisse.remises"] === "oui"} onChange={flag("caisse.remises")} />
          <div className="max-w-xs pl-7">
            <Champ
              id="caisse-plafond"
              label={t("reglages_caisse.plafond")}
              inputMode="numeric"
              autoComplete="off"
              disabled={form["caisse.remises"] !== "oui"}
              value={form["caisse.remise_plafond"]}
              onInput={text("caisse.remise_plafond")}
              aria-invalid={plafondError ? true : undefined}
              aria-describedby={plafondError ? "caisse-plafond-erreur" : undefined}
              className={plafondError ? "border-encre-rouge" : undefined}
            />
            {plafondError && <p id="caisse-plafond-erreur" className="text-sm text-encre-rouge">{t(plafondError.message)}</p>}
          </div>
          <Case id="caisse-pourboires" label={t("reglages_caisse.pourboires")} checked={form["caisse.pourboires"] === "oui"} onChange={flag("caisse.pourboires")} />
          <Case id="caisse-acomptes" label={t("reglages_caisse.acomptes")} checked={form["caisse.acomptes"] === "oui"} onChange={flag("caisse.acomptes")} />
          <Case id="caisse-avoirs-reception" label={t("reglages_caisse.avoirs_reception")} hint={t("reglages_caisse.avoirs_reception_aide")} checked={form["caisse.avoirs_reception"] === "oui"} onChange={flag("caisse.avoirs_reception")} />
          <Case id="caisse-encaissement-praticienne" label={t("reglages_caisse.encaissement_praticienne")} hint={t("reglages_caisse.encaissement_praticienne_aide")} checked={form["caisse.encaissement_praticienne"] === "oui"} onChange={flag("caisse.encaissement_praticienne")} />
        </Bloc>
        <Bloc titre={t("reglages_caisse.moyens")}>
          <div className="grid gap-x-6 sm:grid-cols-2">
            {PAYMENT_METHODS.map((m) => (
              <Case key={m} id={`caisse-moyen-${m}`} label={methodLabel(m, lang)} checked={methods.includes(m)} onChange={(on) => set("caisse.moyens", toggleMethod(form["caisse.moyens"], m, on))} />
            ))}
          </div>
        </Bloc>
        <Bloc titre={t("reglages_caisse.imprimante")}>
          <Champ
            id="caisse-imprimante"
            label={t("reglages_caisse.imprimante_adresse")}
            inputMode="url"
            autoComplete="off"
            spellcheck={false}
            placeholder="192.168.1.100"
            value={form["caisse.imprimante"]}
            onInput={text("caisse.imprimante")}
          />
          <p className="max-w-prose text-sm text-encre-grise">{t("reglages_caisse.imprimante_aide")}</p>
          <Case
            id="caisse-imprimer-logo"
            label={t("reglages_caisse.imprimer_logo")}
            hint={marque.clair === null ? t("reglages_caisse.imprimer_logo_sans") : undefined}
            checked={form["caisse.imprimer_logo"] === "oui"}
            disabled={marque.clair === null}
            onChange={flag("caisse.imprimer_logo")}
          />
          {marque.clair !== null && (
            <figure className="space-y-1">
              <div className="inline-block rounded-sm border border-filet bg-white p-2">
                <img src={`/api/institut/logos/impression?v=${marque.clair}`} alt="" className="block max-w-full [image-rendering:pixelated]" />
              </div>
              <figcaption className="text-xs text-muted-foreground">{t("reglages_caisse.apercu_imprime")}</figcaption>
            </figure>
          )}
          <TestImprimante saved={baseline["caisse.imprimante"]} current={form["caisse.imprimante"]} />
        </Bloc>
        <Erreur message={error ?? loadError} />
        <Succes message={ok} />
        <div><Button type="submit" disabled={pending || !dirty}>{t("commun.enregistrer")}</Button></div>
      </form>
    </Rubrique>
  );
}

/**
 * « Imprimer un test » (impression directe) : ticket court sur l'imprimante
 * enregistrée, pour vérifier l'adresse ; une adresse saisie mais pas encore
 * enregistrée doit l'être d'abord (le serveur imprime l'adresse enregistrée).
 */
function TestImprimante({ saved, current }: { saved: string; current: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  if (!saved.trim() && !current.trim()) return null;
  const unsaved = current.trim() !== saved.trim();
  const run = async () => {
    if (busy || unsaved) return;
    setBusy(true);
    setResult(null);
    try {
      await api("POST", "/api/print/test");
      setResult({ ok: true, text: t("reglages_caisse.test_reussi") });
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" disabled={busy || unsaved} onClick={() => void run()}>{t("reglages_caisse.imprimer_test")}</Button>
      {unsaved && <p className="text-sm text-muted-foreground">{t("reglages_caisse.test_enregistrer")}</p>}
      {result && <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-sm text-muted-foreground" : "text-sm text-encre-rouge"}>{result.text}</p>}
    </div>
  );
}
