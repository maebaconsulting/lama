import { useEffect, useState } from "preact/hooks";
import { api, ApiError } from "../../api";
import type { Setting } from "../../lib/api-types";
import { changedKeys, rebase, valuesOf } from "../../lib/reglages";
import { smsStatusText, type SmsStatus } from "../../lib/sms";
import { useLoad } from "../../hooks/use-load";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Champ, Erreur, Succes } from "../champ";
import { useConfirmation } from "../auth/confirmation";
import { SELECT } from "./elements";
import { EtatChargement, EtatErreur } from "../comptoir";

const KEYS = ["sms.fournisseur", "sms.adresse", "sms.identifiant"] as const;

/**
 * Passerelle SMS (administrateur, spec du 04/10/2026, § 3) : téléphone
 * Android de l'institut avec SMS Gateway for Android en mode local. Le mot de
 * passe, secret, n'est jamais relu : champ vide = mot de passe gardé. État lu
 * à l'ouverture, SMS d'essai vers un numéro saisi.
 */
export function FournisseurSms() {
  const confirm = useConfirmation();
  const { t, lang } = useI18n();
  const { data, error: loadError, reload } = useLoad(() => api<{ settings: Setting[] }>("GET", "/api/settings"), ["settings"]);
  const status = useLoad(() => api<SmsStatus>("GET", "/api/sms/status"), ["settings"]);
  const [baseline, setBaseline] = useState<Record<string, string> | null>(null);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [password, setPassword] = useState("");
  const [testTo, setTestTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

  if (!form || !baseline) return loadError ? <EtatErreur message={loadError} onRetry={() => void reload()} /> : <EtatChargement />;
  const set = (key: string) => (e: Event) => setForm({ ...form, [key]: (e.currentTarget as HTMLInputElement).value });
  const passwordSaved = data?.settings.find((s) => s.key === "sms.mot_de_passe")?.set ?? false;
  const gateway = form["sms.fournisseur"] === "passerelle";

  const submit = async (e: Event) => {
    e.preventDefault();
    setOk(null);
    setError(null);
    setPending(true);
    try {
      const writes: [string, string][] = changedKeys(baseline, form).map((key) => [key, form[key].trim()]);
      if (password.trim()) writes.push(["sms.mot_de_passe", password.trim()]);
      for (const [key, value] of writes) {
        const done = await confirm(() => api("PUT", `/api/settings/${key}`, { value }));
        if (done === null) return;
      }
      setOk(t("sms.enregistres"));
      setBaseline(form);
      setPassword("");
      await Promise.all([reload(), status.reload()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const sendTest = async () => {
    setOk(null);
    setError(null);
    setPending(true);
    try {
      await api("POST", "/api/sms/test", { to: testTo });
      setOk(t("sms.essai_envoye"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("erreur.reseau"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid max-w-lg gap-4">
      {status.data && <p className="text-sm">{smsStatusText(status.data, lang)}</p>}
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="sms-fournisseur">{t("sms.fournisseur")}</Label>
          <select id="sms-fournisseur" className={SELECT} value={form["sms.fournisseur"]} onChange={set("sms.fournisseur")} aria-describedby="sms-aide">
            <option value="aucun">{t("sms.fournisseur.aucun")}</option>
            <option value="passerelle">{t("sms.fournisseur.passerelle")}</option>
          </select>
          <p id="sms-aide" className="text-xs text-muted-foreground">{t("sms.aide")}</p>
        </div>
        {gateway && (
          <>
            <Champ id="sms-adresse" inputMode="url" label={t("sms.adresse")} autoComplete="off" spellcheck={false} placeholder="192.168.1.60" value={form["sms.adresse"]} onInput={set("sms.adresse")} />
            <Champ id="sms-identifiant" label={t("sms.identifiant")} autoComplete="off" spellcheck={false} value={form["sms.identifiant"]} onInput={set("sms.identifiant")} />
            <Champ id="sms-mot-de-passe" type="password" label={t("sms.mot_de_passe")} autoComplete="new-password" placeholder={passwordSaved ? t("sms.mot_de_passe_enregistre") : ""} value={password} onInput={(e: Event) => setPassword((e.currentTarget as HTMLInputElement).value)} />
          </>
        )}
        <div><Button type="submit" variant="outline" disabled={pending || (changedKeys(baseline, form).length === 0 && !password.trim())}>{t("commun.enregistrer")}</Button></div>
      </form>
      {status.data?.provider === "passerelle" && (
        <div className="grid gap-2">
          <Champ id="sms-essai" type="tel" inputMode="tel" label={t("sms.essai_numero")} value={testTo} onInput={(e: Event) => setTestTo((e.currentTarget as HTMLInputElement).value)} />
          <div><Button type="button" variant="outline" disabled={pending || !testTo.trim()} onClick={() => void sendTest()}>{t("sms.essai")}</Button></div>
        </div>
      )}
      <Erreur message={error ?? loadError ?? status.error} />
      <Succes message={ok} />
    </div>
  );
}
