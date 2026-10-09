import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import type { Setting } from "../../lib/api-types";
import { rebase } from "../../lib/reglages";
import { relanceChanges, relanceValues, type RelanceKey } from "../../lib/relances";
import { useLoad } from "../../hooks/use-load";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Champ, Erreur, Succes } from "../champ";
import { ChampHeure } from "../champ-date";
import { Bloc, Case } from "./elements";

/**
 * Bloc « Relances » de la rubrique Messages (mini CRM, décisions 23 à 25),
 * gérante : anniversaire et « vous nous manquez », chacun par sa case,
 * désactivés par défaut ; seuil d'absence et heure d'envoi. Chaque réglage
 * changé est enregistré à part et inscrit au journal par le serveur.
 */
export function Relances() {
  const { t } = useI18n();
  const { data, error: loadError, reload } = useLoad(() => api<{ settings: Setting[] }>("GET", "/api/settings"), ["settings"]);
  const [baseline, setBaseline] = useState<Record<RelanceKey, string> | null>(null);
  const [form, setForm] = useState<Record<RelanceKey, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Même règle que les autres rubriques : un rechargement garde les champs en cours de saisie.
  useEffect(() => {
    if (!data) return;
    const fresh = relanceValues(data.settings);
    if (!form || !baseline) {
      setForm(fresh);
      setBaseline(fresh);
      return;
    }
    const merged = rebase(baseline, form, fresh);
    setBaseline(merged.baseline as Record<RelanceKey, string>);
    setForm(merged.form as Record<RelanceKey, string>);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!form || !baseline) {
    return (
      <Bloc titre={t("relances.titre")}>
        <Erreur message={loadError} />
      </Bloc>
    );
  }
  const set = (key: RelanceKey, value: string) => {
    setOk(null);
    setError(null);
    setForm({ ...form, [key]: value });
  };
  const checked = relanceChanges(baseline, form);
  const dirty = "error" in checked || checked.changes.length > 0;

  const submit = async (e: Event) => {
    e.preventDefault();
    setOk(null);
    setError(null);
    const result = relanceChanges(baseline, form);
    if ("error" in result) {
      setError(t(result.error));
      return;
    }
    setPending(true);
    try {
      for (const { key, value } of result.changes) {
        await api("PUT", `/api/settings/${key}`, { value });
        setBaseline((b) => (b ? { ...b, [key]: form[key] } : b));
      }
      setOk(t("relances.enregistrees"));
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Bloc titre={t("relances.titre")}>
      <p className="max-w-prose text-sm text-encre-grise">{t("relances.aide")}</p>
      <form className="grid max-w-md gap-4" onSubmit={submit} noValidate>
        <Case id="relances-anniversaire" label={t("relances.anniversaire")} hint={t("relances.anniversaire_aide")} checked={form["relances.anniversaire"] === "oui"} onChange={(on) => set("relances.anniversaire", on ? "oui" : "non")} />
        <Case id="relances-absence" label={t("relances.absence")} hint={t("relances.absence_aide")} checked={form["relances.absence"] === "oui"} onChange={(on) => set("relances.absence", on ? "oui" : "non")} />
        <Champ
          id="relances-absence-jours"
          type="number"
          min={15}
          max={365}
          inputMode="numeric"
          label={t("relances.absence_jours")}
          value={form["relances.absence_jours"]}
          onInput={(e: Event) => set("relances.absence_jours", (e.currentTarget as HTMLInputElement).value)}
        />
        <div className="space-y-1.5">
          <Label htmlFor="relances-heure">{t("relances.heure")}</Label>
          <ChampHeure id="relances-heure" value={form["relances.heure"]} onValue={(v: string) => set("relances.heure", v)} />
        </div>
        <Erreur message={error} />
        <Succes message={ok} />
        <div><Button type="submit" variant="outline" disabled={pending || !dirty}>{t("commun.enregistrer")}</Button></div>
      </form>
    </Bloc>
  );
}
