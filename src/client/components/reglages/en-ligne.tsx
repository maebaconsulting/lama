import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import { useAuth } from "../../auth-context";
import { useEnvoi } from "../../hooks/use-envoi";
import { useLoad } from "../../hooks/use-load";
import type { Setting } from "../../lib/api-types";
import { changedKeys, rebase, valuesOf } from "../../lib/reglages";
import { useI18n } from "@/i18n/provider";
import type { Key } from "@/i18n/translate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatInstant } from "@/lib/format";
import { CLES_GERANTE, peutEnregistrerTheme, problemeAffiche, rapport, THEME_DEPART, valeurReglage } from "@/lib/reglages-en-ligne";
import { COULEUR, POLICES, texteSur, type Police, type ThemeEnLigne } from "../../../shared/en-ligne";
import { useConfirmation } from "../auth/confirmation";
import { Champ, Erreur, Succes } from "../champ";
import { EtatChargement, EtatErreur } from "../comptoir";
import { ApercuTheme } from "./apercu-theme";
import { Bloc, Case, Rubrique, SELECT } from "./elements";

type EtatLiaison = {
  active: boolean; reglee: boolean; adresse: string; salon: string; page: string | null; integration: string | null;
  dernier_succes_le: number | null; derniere_erreur: string | null; derniere_erreur_le: number | null; attente_relais: number | null;
  offre_publiee_le: number | null; plages_publiees_le: number | null;
};

/** Interrupteur, horizon, délai minimal, adresse du relais, textes d'accord (gérante) : seuls les champs changés sont envoyés. */
function ReglagesGerante({ settings, recharger }: { settings: Setting[]; recharger: () => Promise<void> }) {
  const { t } = useI18n();
  const [baseline, setBaseline] = useState<Record<string, string> | null>(null);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const envoi = useEnvoi();
  useEffect(() => {
    const fresh = valuesOf(settings, CLES_GERANTE);
    if (!form || !baseline) {
      setForm(fresh);
      setBaseline(fresh);
      return;
    }
    const m = rebase(baseline, form, fresh);
    setBaseline(m.baseline);
    setForm(m.form);
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!form || !baseline) return <EtatChargement />;
  const set = (cle: string) => (e: Event) => setForm({ ...form, [cle]: (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value });
  const enregistrer = (e: Event) => {
    e.preventDefault();
    setErreur(null);
    setOk(null);
    void envoi.lancer("reglages", async () => {
      try {
        for (const cle of changedKeys(baseline, form)) {
          await api("PUT", `/api/settings/${cle}`, { value: valeurReglage(cle, form[cle]) });
          setBaseline((b) => (b ? { ...b, [cle]: form[cle] } : b));
        }
        setOk(t("en_ligne.reglages_enregistres"));
        await recharger();
      } catch (err) {
        setErreur((err as Error).message);
      }
    });
  };
  return (
    <Bloc titre={t("en_ligne.bloc.reglages")}>
      <form className="grid max-w-lg gap-4" onSubmit={enregistrer} noValidate>
        <Case id="en-ligne-active" label={t("en_ligne.active")} hint={t("en_ligne.active_aide")} checked={form["en_ligne.active"] === "true"} onChange={(v) => setForm({ ...form, "en_ligne.active": String(v) })} />
        <Champ id="en-ligne-horizon" type="number" min={7} max={92} label={t("en_ligne.horizon")} value={form["en_ligne.horizon_jours"]} onInput={set("en_ligne.horizon_jours")} />
        <Champ id="en-ligne-delai" type="number" min={0} max={168} label={t("en_ligne.delai")} value={form["en_ligne.delai_minimal_heures"]} onInput={set("en_ligne.delai_minimal_heures")} />
        <Champ id="en-ligne-adresse" type="url" label={t("en_ligne.adresse")} placeholder={t("en_ligne.adresse_exemple")} value={form["en_ligne.adresse"]} onInput={set("en_ligne.adresse")} />
        {(["fr", "en"] as const).map((l) => (
          <div key={l} className="space-y-1.5">
            <Label htmlFor={`en-ligne-texte-${l}`}>{t(`en_ligne.texte_donnees.${l}` as Key)}</Label>
            <Textarea id={`en-ligne-texte-${l}`} rows={3} value={form[`en_ligne.texte_donnees.${l}`]} onInput={set(`en_ligne.texte_donnees.${l}`)} />
          </div>
        ))}
        <Erreur message={erreur} />
        <Succes message={ok} />
        <div><Button type="submit" disabled={envoi.occupe || changedKeys(baseline, form).length === 0}>{t("commun.enregistrer")}</Button></div>
      </form>
    </Bloc>
  );
}

/** Thème de la page (gérante, spec § 9.4) : fond, accent, police, contraste contrôlé avant l'envoi, aperçu. */
function ThemeSalon({ settings, nom, recharger }: { settings: Setting[]; nom: string; recharger: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const enPlace = (settings.find((s) => s.key === "en_ligne.theme")?.value ?? null) as ThemeEnLigne | null;
  const [actif, setActif] = useState(enPlace !== null);
  const [theme, setTheme] = useState<ThemeEnLigne>(enPlace ?? THEME_DEPART);
  useEffect(() => {
    setActif(enPlace !== null);
    if (enPlace) setTheme(enPlace);
  }, [JSON.stringify(enPlace)]); // eslint-disable-line react-hooks/exhaustive-deps
  const [erreur, setErreur] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const envoi = useEnvoi();
  const probleme = actif ? problemeAffiche(theme) : null;
  const couleursLisibles = COULEUR.test(theme.fond) && COULEUR.test(theme.accent);
  const changer = (champ: Partial<ThemeEnLigne>) => { setOk(null); setTheme({ ...theme, ...champ }); };
  const enregistrer = () => void envoi.lancer("theme", async () => {
    setErreur(null);
    setOk(null);
    try {
      await api("PUT", "/api/settings/en_ligne.theme", { value: actif ? theme : null });
      setOk(t("en_ligne.theme_enregistre"));
      await recharger();
    } catch (err) {
      setErreur((err as Error).message);
    }
  });
  return (
    <Bloc titre={t("en_ligne.bloc.theme")}>
      <p className="max-w-prose text-sm text-encre-grise">{t("en_ligne.theme_aide")}</p>
      <Case id="en-ligne-theme" label={t("en_ligne.theme_propre")} checked={actif} onChange={(v) => { setOk(null); setActif(v); }} />
      {actif ? (
        <div className="grid max-w-lg gap-4">
          {(["fond", "accent"] as const).map((champ) => (
            <div key={champ} className="space-y-1.5">
              <Label htmlFor={`theme-${champ}`}>{t(`en_ligne.theme_${champ}` as Key)}</Label>
              <div className="flex gap-2">
                <input
                  type="color"
                  aria-label={t(`en_ligne.theme_${champ}` as Key)}
                  className="h-11 w-14 shrink-0 cursor-pointer rounded-sm border border-input bg-card"
                  value={COULEUR.test(theme[champ]) ? theme[champ] : THEME_DEPART[champ]}
                  onInput={(e: Event) => changer({ [champ]: (e.currentTarget as HTMLInputElement).value.toUpperCase() })}
                />
                <Input id={`theme-${champ}`} value={theme[champ]} onInput={(e: Event) => changer({ [champ]: (e.currentTarget as HTMLInputElement).value.trim() })} />
              </div>
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="theme-police">{t("en_ligne.theme_police")}</Label>
            <select id="theme-police" className={SELECT} value={theme.police} onChange={(e) => changer({ police: (e.currentTarget as HTMLSelectElement).value as Police })}>
              {POLICES.map((p) => <option key={p} value={p}>{t(`en_ligne.police.${p}` as Key)}</option>)}
            </select>
          </div>
          {couleursLisibles && (
            <p className="text-sm text-encre-grise">{t("en_ligne.theme_contrastes", { texte: rapport(texteSur(theme.fond), theme.fond, lang), accent: rapport(theme.accent, theme.fond, lang) })}</p>
          )}
          {probleme && <Erreur message={t(probleme)} />}
          {couleursLisibles && <ApercuTheme theme={theme} nom={nom} />}
        </div>
      ) : (
        <p className="text-sm text-encre-grise">{t("en_ligne.theme_charte")}</p>
      )}
      <Erreur message={erreur} />
      <Succes message={ok} />
      <div><Button disabled={!peutEnregistrerTheme(actif, theme, envoi.occupe)} onClick={enregistrer}>{t("commun.enregistrer")}</Button></div>
    </Bloc>
  );
}

/** État de la liaison (gérante et administrateur) : relu toutes les 30 secondes, et « Tester la liaison ». */
function EtatDeLaLiaison() {
  const { t, lang } = useI18n();
  const etat = useLoad(() => api<EtatLiaison>("GET", "/api/en-ligne/etat"), ["settings", "demandes"], { reloadOnLang: true });
  useEffect(() => {
    const id = setInterval(() => void etat.reload(), 30_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [resultat, setResultat] = useState<{ ok: boolean; message: string } | null>(null);
  const envoi = useEnvoi();
  const tester = () => void envoi.lancer("tester", async () => {
    setResultat(null);
    try {
      setResultat(await api<{ ok: boolean; message: string }>("POST", "/api/en-ligne/tester", {}));
      await etat.reload();
    } catch (err) {
      setResultat({ ok: false, message: (err as Error).message });
    }
  });
  const e = etat.data;
  const quand = (ms: number | null) => (ms === null ? t("en_ligne.etat.jamais") : formatInstant(ms, lang));
  return (
    <Bloc titre={t("en_ligne.bloc.liaison")}>
      {etat.error && !e ? <EtatErreur message={etat.error} onRetry={() => void etat.reload()} /> : !e ? <EtatChargement /> : (
        <dl className="grid max-w-lg grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-encre-grise">{t("en_ligne.etat.interrupteur")}</dt>
          <dd>{t(e.active ? "en_ligne.etat.activee" : "en_ligne.etat.coupee")}</dd>
          <dt className="text-encre-grise">{t("en_ligne.etat.liaison")}</dt>
          <dd>{t(e.reglee ? "en_ligne.etat.reglee" : "en_ligne.etat.non_reglee")}</dd>
          <dt className="text-encre-grise">{t("en_ligne.etat.dernier_echange")}</dt>
          <dd>{quand(e.dernier_succes_le)}</dd>
          <dt className="text-encre-grise">{t("en_ligne.etat.attente")}</dt>
          <dd>{e.attente_relais ?? t("en_ligne.etat.inconnu")}</dd>
          {e.derniere_erreur && (
            <>
              <dt className="text-encre-grise">{t("en_ligne.etat.erreur")}</dt>
              <dd className="text-encre-rouge">{e.derniere_erreur} ({quand(e.derniere_erreur_le)})</dd>
            </>
          )}
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={envoi.occupe || !e?.reglee} onClick={tester}>{t("en_ligne.tester")}</Button>
        {resultat && (resultat.ok ? <Succes message={resultat.message} /> : <Erreur message={resultat.message} />)}
      </div>
    </Bloc>
  );
}

/** Lien de la page, code d'intégration à copier, QR code à télécharger et imprimer (gérante). */
function PartageEnLigne() {
  const { t } = useI18n();
  const etat = useLoad(() => api<EtatLiaison>("GET", "/api/en-ligne/etat"), ["settings"]);
  const [copie, setCopie] = useState<string | null>(null);
  const e = etat.data;
  // QR code demandé seulement quand la liaison donne une page (adresse et salon réglés), une fois par page.
  const page = e?.page ?? null;
  const [qr, setQr] = useState<{ image: string; page: string } | null>(null);
  useEffect(() => {
    if (!page) {
      setQr(null);
      return;
    }
    let actif = true;
    api<{ image: string; page: string }>("GET", "/api/en-ligne/qr")
      .then((r) => { if (actif) setQr(r); })
      .catch(() => { if (actif) setQr(null); });
    return () => { actif = false; };
  }, [page]);
  if (!e?.page || !e.integration) {
    return <Bloc titre={t("en_ligne.bloc.partage")}><p className="max-w-prose text-sm text-encre-grise">{t("en_ligne.partage_vide")}</p></Bloc>;
  }
  const code = e.integration;
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopie(t("en_ligne.code_copie"));
    } catch {
      setCopie(null);
    }
  };
  return (
    <Bloc titre={t("en_ligne.bloc.partage")}>
      <div className="space-y-1.5 text-sm">
        <p className="text-encre-grise">{t("en_ligne.page")}</p>
        <a className="break-all underline underline-offset-4" href={e.page} target="_blank" rel="noopener">{e.page}</a>
      </div>
      <div className="max-w-lg space-y-1.5">
        <Label htmlFor="en-ligne-code">{t("en_ligne.code")}</Label>
        <Textarea id="en-ligne-code" readOnly rows={2} className="font-mono text-xs" value={code} />
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => void copier()}>{t("en_ligne.copier")}</Button>
          <Succes message={copie} />
        </div>
      </div>
      {qr && (
        <div className="space-y-2">
          <img src={qr.image} alt={t("en_ligne.qr_alt")} className="h-40 w-40 rounded-sm border border-filet bg-card" />
          <a className="text-sm underline underline-offset-4" href={qr.image} download="qr-reservation.svg">{t("en_ligne.qr_telecharger")}</a>
        </div>
      )}
    </Bloc>
  );
}

/** Identifiant du salon et clé partagée (administrateur, mot de passe retapé) ; la clé n'est jamais relue : champ vide = clé gardée. */
function LiaisonAdmin({ settings, recharger }: { settings: Setting[]; recharger: () => Promise<void> }) {
  const confirm = useConfirmation();
  const { t } = useI18n();
  const salonEnPlace = String(settings.find((s) => s.key === "en_ligne.salon")?.value ?? "");
  const cleReglee = settings.find((s) => s.key === "en_ligne.cle")?.set ?? false;
  const [salon, setSalon] = useState(salonEnPlace);
  useEffect(() => setSalon(salonEnPlace), [salonEnPlace]);
  const [cleSaisie, setCleSaisie] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const envoi = useEnvoi();
  const enregistrer = (e: Event) => {
    e.preventDefault();
    setErreur(null);
    setOk(null);
    void envoi.lancer("liaison", async () => {
      try {
        const ecritures: [string, string][] = [];
        if (salon.trim() !== salonEnPlace) ecritures.push(["en_ligne.salon", salon.trim()]);
        if (cleSaisie.trim()) ecritures.push(["en_ligne.cle", cleSaisie.trim()]);
        for (const [cle, valeur] of ecritures) {
          const fait = await confirm(() => api("PUT", `/api/settings/${cle}`, { value: valeur }));
          if (fait === null) return;
        }
        setCleSaisie("");
        setOk(t("en_ligne.liaison_enregistree"));
        await recharger();
      } catch (err) {
        setErreur((err as Error).message);
      }
    });
  };
  return (
    <Bloc titre={t("en_ligne.bloc.salon")}>
      <p className="max-w-prose text-sm text-encre-grise">{t("en_ligne.salon_aide")}</p>
      <form className="grid max-w-lg gap-4" onSubmit={enregistrer} noValidate>
        <Champ id="en-ligne-salon" label={t("en_ligne.salon")} autoComplete="off" value={salon} onInput={(ev: Event) => setSalon((ev.currentTarget as HTMLInputElement).value)} />
        <Champ id="en-ligne-cle" type="password" label={t("en_ligne.cle")} autoComplete="new-password" placeholder={cleReglee ? t("en_ligne.cle_enregistree") : ""} value={cleSaisie} onInput={(ev: Event) => setCleSaisie((ev.currentTarget as HTMLInputElement).value)} />
        <Erreur message={erreur} />
        <Succes message={ok} />
        <div><Button type="submit" disabled={envoi.occupe}>{t("commun.enregistrer")}</Button></div>
      </form>
    </Bloc>
  );
}

/**
 * Réglages > Réservation en ligne (spec du 16/10/2026 § 4.6, § 9.4) : la gérante règle, choisit le thème,
 * teste et partage ; l'administrateur colle l'identifiant du salon et la clé créés dans la gestion du relais.
 */
export function EnLigne() {
  const { account } = useAuth();
  const { t } = useI18n();
  const reglages = useLoad(() => api<{ settings: Setting[] }>("GET", "/api/settings"), ["settings"]);
  const gerante = account.role === "manager";
  const nom = String(reglages.data?.settings.find((s) => s.key === "institut.nom")?.value ?? "");
  return (
    <Rubrique titre={t("reglages.rubrique.en_ligne")} description={t(gerante ? "en_ligne.description" : "en_ligne.description_admin")}>
      {reglages.error && !reglages.data ? <EtatErreur message={reglages.error} onRetry={() => void reglages.reload()} />
        : !reglages.data ? <EtatChargement />
        : (
          <>
            {gerante && <ReglagesGerante settings={reglages.data.settings} recharger={reglages.reload} />}
            {gerante && <ThemeSalon settings={reglages.data.settings} nom={nom} recharger={reglages.reload} />}
            <EtatDeLaLiaison />
            {gerante && <PartageEnLigne />}
            {!gerante && <LiaisonAdmin settings={reglages.data.settings} recharger={reglages.reload} />}
          </>
        )}
    </Rubrique>
  );
}
