import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import type { Setting } from "../../lib/api-types";
import { changedKeys, rebase, valuesOf } from "../../lib/reglages";
import { useLoad } from "../../hooks/use-load";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Champ, Erreur, Succes } from "../champ";
import { useConfirmation } from "../auth/confirmation";
import { SELECT } from "./elements";
import { EtatChargement, EtatErreur } from "../comptoir";
import { AideMeta, WhatsappBusiness } from "./whatsapp-business";

const KEYS = ["whatsapp.fournisseur", "waha.adresse", "waha.session", "whatsapp.meta.numero", "whatsapp.meta.compte", "whatsapp.indicatif"] as const;

/**
 * Choix du fournisseur WhatsApp (administrateur, sous-projet 7 § 4 ; WhatsApp Business, spec du
 * 21/10/2026, W-9, W-10) : passerelle WAHA ou compte WhatsApp Business ; seul le bloc du fournisseur
 * choisi s'affiche, l'autre garde ses réglages. Le risque de WAHA est rappelé en une phrase. La clé de
 * WAHA et le jeton de Meta, secrets, ne sont jamais relus : champ vide = valeur gardée.
 */
export function FournisseurWhatsapp() {
  const confirm = useConfirmation();
  const { t } = useI18n();
  const { data, error: loadError, reload } = useLoad(() => api<{ settings: Setting[] }>("GET", "/api/settings"), ["settings"]);
  const [baseline, setBaseline] = useState<Record<string, string> | null>(null);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [cle, setCle] = useState("");
  const [jeton, setJeton] = useState("");
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
  const cleEnregistree = data?.settings.find((s) => s.key === "waha.cle")?.set ?? false;
  const jetonEnregistre = data?.settings.find((s) => s.key === "whatsapp.jeton_acces")?.set ?? false;
  const waha = form["whatsapp.fournisseur"] === "waha";
  const meta = form["whatsapp.fournisseur"] === "meta";

  const submit = async (e: Event) => {
    e.preventDefault();
    setOk(null);
    setError(null);
    setPending(true);
    try {
      const writes: [string, string][] = changedKeys(baseline, form).map((key) => [key, form[key].trim()]);
      if (cle.trim()) writes.push(["waha.cle", cle.trim()]);
      if (jeton.trim()) writes.push(["whatsapp.jeton_acces", jeton.trim()]);
      for (const [key, value] of writes) {
        const done = await confirm(() => api("PUT", `/api/settings/${key}`, { value }));
        if (done === null) return;
      }
      setOk(t("whatsapp.enregistres"));
      setBaseline(form);
      setCle("");
      setJeton("");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <form className="grid max-w-lg gap-4" onSubmit={submit} noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="whatsapp-fournisseur">{t("whatsapp.fournisseur")}</Label>
          <select id="whatsapp-fournisseur" className={SELECT} value={form["whatsapp.fournisseur"]} onChange={set("whatsapp.fournisseur")} aria-describedby={waha ? "whatsapp-risque" : undefined}>
            <option value="aucun">{t("whatsapp.fournisseur.aucun")}</option>
            <option value="waha">{t("whatsapp.fournisseur.waha")}</option>
            <option value="meta">{t("whatsapp.fournisseur.meta")}</option>
          </select>
          {waha && <p id="whatsapp-risque" className="text-xs text-muted-foreground">{t("whatsapp.risque")}</p>}
        </div>
        {waha && (
          <>
            <Champ id="waha-adresse" type="url" label={t("whatsapp.adresse")} autoComplete="off" spellcheck={false} value={form["waha.adresse"]} onInput={set("waha.adresse")} />
            <Champ id="waha-cle" type="password" label={t("whatsapp.cle")} autoComplete="new-password" placeholder={cleEnregistree ? t("whatsapp.cle_enregistree") : ""} value={cle} onInput={(e: Event) => setCle((e.currentTarget as HTMLInputElement).value)} />
            <Champ id="waha-session" label={t("whatsapp.session")} autoComplete="off" spellcheck={false} value={form["waha.session"]} onInput={set("waha.session")} />
          </>
        )}
        {meta && (
          <>
            <AideMeta />
            <Champ id="meta-numero" inputMode="numeric" label={t("whatsapp.meta.numero")} autoComplete="off" spellcheck={false} value={form["whatsapp.meta.numero"]} onInput={set("whatsapp.meta.numero")} />
            <Champ id="meta-compte" inputMode="numeric" label={t("whatsapp.meta.compte")} autoComplete="off" spellcheck={false} value={form["whatsapp.meta.compte"]} onInput={set("whatsapp.meta.compte")} />
            <Champ id="meta-jeton" type="password" label={t("whatsapp.meta.jeton")} autoComplete="new-password" placeholder={jetonEnregistre ? t("whatsapp.meta.jeton_enregistre") : ""} value={jeton} onInput={(e: Event) => setJeton((e.currentTarget as HTMLInputElement).value)} />
          </>
        )}
        <Champ id="whatsapp-indicatif" inputMode="numeric" label={t("whatsapp.indicatif")} value={form["whatsapp.indicatif"]} onInput={set("whatsapp.indicatif")} />
        <Erreur message={error ?? loadError} />
        <Succes message={ok} />
        <div><Button type="submit" variant="outline" disabled={pending || (changedKeys(baseline, form).length === 0 && !cle.trim() && !jeton.trim())}>{t("commun.enregistrer")}</Button></div>
      </form>
      {baseline["whatsapp.fournisseur"] === "meta" && <WhatsappBusiness />}
    </>
  );
}
