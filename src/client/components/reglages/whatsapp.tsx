import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import { useCrm } from "../../auth-context";
import { useFormation } from "../../formation-context";
import type { Setting } from "../../lib/api-types";
import { changedKeysIn, rebase, valuesOf } from "../../lib/reglages";
import type { WhatsappStatus, WhatsappText } from "../../lib/whatsapp";
import { estimateTemplate } from "../../../shared/sms";
import { useLoad } from "../../hooks/use-load";
import { useEnvoi } from "../../hooks/use-envoi";
import { useI18n } from "@/i18n/provider";
import type { Key } from "@/i18n/translate";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Champ, Erreur, Succes } from "../champ";
import { ChampHeure } from "../champ-date";
import { Bloc, Rubrique } from "./elements";
import { Campagnes } from "./campagnes";
import { EtatWhatsapp } from "./etat-whatsapp";
import { Relances } from "./relances";

/** Délai du rappel, fenêtre sans envoi et indicatif par défaut (décision 9 : aussi modifiable par la gérante, comme en Connexions). */
const HOURS_KEYS = ["whatsapp.rappel_heures", "whatsapp.silence_debut", "whatsapp.silence_fin", "whatsapp.indicatif"] as const;
/** Délais du secours SMS : leur propre formulaire, leur propre enregistrement. */
const SMS_KEYS = ["sms.delai_rendez_vous_minutes", "sms.delai_libre_minutes"] as const;
const FORM_KEYS = [...HOURS_KEYS, ...SMS_KEYS] as const;
const NUMBERS = new Set<string>(["whatsapp.rappel_heures", "sms.delai_rendez_vous_minutes", "sms.delai_libre_minutes"]);

/** Un texte de message : « Enregistrer » après un changement, « Rétablir le texte par défaut » s'il en diffère. */
function Texte({ text, onSaved }: { text: WhatsappText; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const [value, setValue] = useState(text.value);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(text.value), [text.value]);
  const save = async (next: string) => {
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      await api("PUT", `/api/settings/${text.key}`, { value: next });
      setValue(next);
      setOk(t("whatsapp.texte_enregistre"));
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const id = `texte-${text.kind}-${text.lang}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t(`whatsapp.texte.${text.kind}.${text.lang}` as Key)}</Label>
      <Textarea id={id} rows={4} value={value} onInput={(e: Event) => setValue((e.currentTarget as HTMLTextAreaElement).value)} />
      {text.kind !== "ticket" && <p className="text-xs text-muted-foreground">{t("sms.compteur", { count: estimateTemplate(value) })}</p>}
      <Erreur message={error} />
      <Succes message={ok} />
      <div className="flex flex-wrap gap-2">
        {value !== text.value && <Button variant="outline" disabled={busy} onClick={() => void save(value)}>{t("commun.enregistrer")}</Button>}
        {text.value !== text.default && <Button variant="ghost" disabled={busy} onClick={() => void save(text.default)}>{t("whatsapp.retablir")}</Button>}
      </div>
    </div>
  );
}

/**
 * Rubrique WhatsApp de la gérante (sous-projet 7 § 3 et § 4) : état de la
 * session et QR code, textes des messages (variables contrôlées par le
 * serveur), délai du rappel et fenêtre sans envoi ; relances et campagnes (mini CRM).
 */
export function Whatsapp() {
  const { t } = useI18n();
  const formation = useFormation();
  // Interrupteur général du mini CRM : désactivé, relances et campagnes cèdent la place à une phrase.
  const crm = useCrm();
  const texts = useLoad(() => api<{ texts: WhatsappText[] }>("GET", "/api/whatsapp/texts"), ["settings"]);
  // WhatsApp Business (W-15) : la cliente reçoit le modèle déposé chez Meta, pas ces textes.
  const status = useLoad(() => api<WhatsappStatus>("GET", "/api/whatsapp/status"), ["settings"]);
  const settings = useLoad(() => api<{ settings: Setting[] }>("GET", "/api/settings"), ["settings"]);
  const [baseline, setBaseline] = useState<Record<string, string> | null>(null);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [smsOk, setSmsOk] = useState<string | null>(null);
  // Vague C (passe V 1.0) : un verrou par groupe ; « Enregistrer » grisé pendant l'envoi, jamais deux lignes au journal.
  const heures = useEnvoi();
  const sms = useEnvoi();

  useEffect(() => {
    if (!settings.data) return;
    const fresh = valuesOf(settings.data.settings, FORM_KEYS);
    if (!form || !baseline) {
      setForm(fresh);
      setBaseline(fresh);
      return;
    }
    const merged = rebase(baseline, form, fresh);
    setBaseline(merged.baseline);
    setForm(merged.form);
  }, [settings.data]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Enregistre les champs modifiés d'un groupe, un par un ; la référence suit chaque écriture réussie. */
  const saveGroup = (envoi: ReturnType<typeof useEnvoi>, group: readonly string[], done: Key, setErr: (m: string | null) => void, setDone: (m: string | null) => void) => async (e: Event) => {
    e.preventDefault();
    if (!form || !baseline) return;
    setErr(null);
    setDone(null);
    try {
      await envoi.lancer("groupe", async () => {
        for (const key of changedKeysIn(baseline, form, group)) {
          await api("PUT", `/api/settings/${key}`, { value: NUMBERS.has(key) ? Number(form[key]) : form[key] });
          setBaseline((b) => (b ? { ...b, [key]: form[key] } : b));
        }
        setDone(t(done));
        await settings.reload();
      });
    } catch (err) {
      setErr((err as Error).message);
    }
  };
  const saveHours = saveGroup(heures, HOURS_KEYS, "whatsapp.heures_enregistrees", setError, setOk);
  const saveSms = saveGroup(sms, SMS_KEYS, "sms.delais_enregistres", setSmsError, setSmsOk);
  const set = (key: string) => (e: Event) => form && setForm({ ...form, [key]: (e.currentTarget as HTMLInputElement).value });

  return (
    <Rubrique titre={t("reglages.rubrique.whatsapp")} description={t("whatsapp.description")}>
      <Bloc titre={t("whatsapp.etat_titre")}>
        {formation && <p className="max-w-prose text-sm text-encre-grise">{t("formation.coupe")}</p>}
        <EtatWhatsapp />
        <p className="text-xs text-muted-foreground">{t("whatsapp.fournisseur_admin")}</p>
      </Bloc>

      <Bloc titre={t("whatsapp.textes")}>
        <p className="max-w-prose text-sm text-encre-grise">{t("whatsapp.textes_aide")}</p>
        {status.data?.provider === "meta" && <p className="max-w-prose text-sm text-encre-grise">{t("whatsapp.textes_meta")}</p>}
        <Erreur message={texts.error} />
        <div className="grid max-w-2xl gap-6">
          {texts.data?.texts.map((text) => <Texte key={text.key} text={text} onSaved={texts.reload} />)}
        </div>
      </Bloc>

      <Bloc titre={t("whatsapp.heures")}>
        {form && (
          <form className="grid max-w-md gap-4" onSubmit={saveHours} noValidate>
            <Champ id="whatsapp-rappel" type="number" min={1} max={72} inputMode="numeric" label={t("whatsapp.rappel_heures")} value={form["whatsapp.rappel_heures"]} onInput={set("whatsapp.rappel_heures")} />
            <Champ id="whatsapp-indicatif-gerante" inputMode="numeric" label={t("whatsapp.indicatif")} value={form["whatsapp.indicatif"]} onInput={set("whatsapp.indicatif")} />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="whatsapp-silence-debut">{t("whatsapp.silence_debut")}</Label>
                <ChampHeure id="whatsapp-silence-debut" borne="fin" value={form["whatsapp.silence_debut"]} onValue={(v: string) => setForm({ ...form, "whatsapp.silence_debut": v })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="whatsapp-silence-fin">{t("whatsapp.silence_fin")}</Label>
                <ChampHeure id="whatsapp-silence-fin" value={form["whatsapp.silence_fin"]} onValue={(v: string) => setForm({ ...form, "whatsapp.silence_fin": v })} />
              </div>
            </div>
            <Erreur message={error ?? settings.error} />
            <Succes message={ok} />
            <div><Button type="submit" variant="outline" disabled={heures.occupe || !baseline || changedKeysIn(baseline, form, HOURS_KEYS).length === 0}>{t("commun.enregistrer")}</Button></div>
          </form>
        )}
      </Bloc>

      <Bloc titre={t("sms.secours")}>
        <p className="max-w-prose text-sm text-encre-grise">{t("sms.secours_aide")}</p>
        {form && (
          <form className="grid max-w-md gap-4" onSubmit={saveSms} noValidate>
            <Champ id="sms-delai-rdv" type="number" min={15} max={1440} inputMode="numeric" label={t("sms.delai_rendez_vous")} value={form["sms.delai_rendez_vous_minutes"]} onInput={set("sms.delai_rendez_vous_minutes")} />
            <Champ id="sms-delai-libre" type="number" min={1} max={240} inputMode="numeric" label={t("sms.delai_libre")} value={form["sms.delai_libre_minutes"]} onInput={set("sms.delai_libre_minutes")} />
            <Erreur message={smsError} />
            <Succes message={smsOk} />
            <div><Button type="submit" variant="outline" disabled={sms.occupe || !baseline || changedKeysIn(baseline, form, SMS_KEYS).length === 0}>{t("commun.enregistrer")}</Button></div>
          </form>
        )}
      </Bloc>

      {crm ? <Relances /> : (
        <Bloc titre={t("relances.titre")}>
          <p className="max-w-prose text-sm text-encre-grise">{t("crm.relances_suspendues")}</p>
        </Bloc>
      )}

      {crm ? <Campagnes /> : (
        <Bloc titre={t("campagnes.titre")}>
          <p className="max-w-prose text-sm text-encre-grise">{t("crm.campagnes_suspendues")}</p>
        </Bloc>
      )}
    </Rubrique>
  );
}
