import { Check } from "lucide-preact";
import { useState } from "preact/hooks";
import { api } from "../../api";
import { useAuth } from "../../auth-context";
import { useDemo } from "../../demo-context";
import { estCompteDemo } from "../../lib/demo";
import { confirmationProblem, passwordProblem, pinProblem } from "../../lib/forms";
import { ROLE_KEYS } from "../../lib/roles";
import { useI18n } from "@/i18n/provider";
import { LANGS, translate, type Lang } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Champ, Erreur, Succes } from "../champ";
import { ChoixTheme } from "../choix-theme";
import { Bloc, Rubrique } from "./elements";

/** Langue, thème, mot de passe et PIN personnels (routes `PUT /api/auth/me/language`, `PUT /api/auth/me/theme` et `PUT /api/auth/me`). */
export function MonCompte() {
  const { account } = useAuth();
  const { t } = useI18n();
  // Démonstration publique (DP-06) : mot de passe et PIN d'un compte public figés, le serveur refuse aussi.
  const fige = estCompteDemo(useDemo(), account.login);
  return (
    <Rubrique
      titre={t("reglages.rubrique.mon_compte")}
      description={t("moncompte.description", { nom: account.display_name, role: t(ROLE_KEYS[account.role]).toLowerCase(), login: account.login })}
    >
      <Langue />
      <Theme />
      {fige ? <p className="max-w-prose text-sm text-encre-grise">{t("demo.compte_fige")}</p> : <MotDePasse />}
      {account.role !== "admin" && !fige && <Pin hasPin={account.has_pin} />}
    </Rubrique>
  );
}

/**
 * Sa propre langue (spec § 3.2) : appliquée aussitôt à tout l'écran, puis
 * enregistrée pour le compte ; si l'enregistrement échoue, l'ancienne revient.
 */
function Langue() {
  const { lang, setLang, t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const choose = (next: Lang) => {
    if (next === lang) return;
    const previous = lang;
    setOk(null);
    setError(null);
    setLang(next);
    api("PUT", "/api/auth/me/language", { language: next }).then(
      () => setOk(translate(next, "moncompte.langue_enregistree")),
      () => { setLang(previous); setError(translate(previous, "langue.echec")); },
    );
  };

  // Gros sélecteur (sous-projet 4 § 7.1) : chaque langue écrite dans sa propre langue, lisible par qui ne lit pas l'autre.
  return (
    <Bloc titre={t("langue.choix")}>
      <p className="text-sm text-encre-grise">{t("moncompte.langue_aide")}</p>
      <div role="group" aria-label={t("langue.choix")} className="grid max-w-md grid-cols-2 gap-2">
        {LANGS.map((code) => (
          <button
            key={code}
            type="button"
            lang={code}
            aria-pressed={lang === code}
            onClick={() => choose(code)}
            className={cn(
              "min-h-16 rounded-sm border px-3 text-base transition-colors duration-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring relative",
              lang === code ? "border-foreground bg-muted font-medium text-foreground" : "border-input text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {/* Coche du choix actif (retouche 9), lisible en thème sombre ; l'état reste porté par aria-pressed. */}
            {lang === code && <Check aria-hidden="true" className="absolute right-2 top-2 h-4 w-4 text-foreground" />}
            {translate(code, code === "fr" ? "langue.nom.fr" : "langue.nom.en")}
          </button>
        ))}
      </div>
      <Erreur message={error} />
      <Succes message={ok} />
    </Bloc>
  );
}

/** Son propre thème (sous-projet 4 § 3.2) : appliqué aussitôt, l'ancien revient si l'enregistrement échoue. */
function Theme() {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  return (
    <Bloc titre={t("theme.choix")}>
      <p className="max-w-prose text-sm text-encre-grise">{t("moncompte.theme_aide")}</p>
      <div className="max-w-md">
        <ChoixTheme
          grand
          onError={(message) => { setOk(null); setError(message); }}
          onSaved={() => { setError(null); setOk(t("moncompte.theme_enregistre")); }}
        />
      </div>
      <Erreur message={error} />
      <Succes message={ok} />
    </Bloc>
  );
}

function MotDePasse() {
  const { t } = useI18n();
  const [form, setForm] = useState({ actuel: "", nouveau: "", confirmation: "" });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setOk(null);
    const problem = passwordProblem(form.nouveau) ?? confirmationProblem(form.nouveau, form.confirmation);
    if (problem) { setError(t(problem)); return; }
    setPending(true);
    setError(null);
    try {
      await api("PUT", "/api/auth/me", { current_password: form.actuel, password: form.nouveau });
      setForm({ actuel: "", nouveau: "", confirmation: "" });
      setOk(t("moncompte.mot_de_passe_modifie"));
    } catch (err) {
      setForm({ actuel: "", nouveau: "", confirmation: "" });
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Bloc titre={t("connexion.mot_de_passe")}>
      <form className="grid max-w-md gap-4" onSubmit={submit} noValidate>
        <Champ id="mdp-actuel" type="password" label={t("moncompte.actuel")} autoComplete="current-password" value={form.actuel} onInput={(e: Event) => setForm({ ...form, actuel: (e.currentTarget as HTMLInputElement).value })} />
        <Champ id="mdp-nouveau" type="password" label={t("moncompte.nouveau")} autoComplete="new-password" value={form.nouveau} onInput={(e: Event) => setForm({ ...form, nouveau: (e.currentTarget as HTMLInputElement).value })} />
        <Champ id="mdp-confirmation" type="password" label={t("moncompte.nouveau_bis")} autoComplete="new-password" value={form.confirmation} onInput={(e: Event) => setForm({ ...form, confirmation: (e.currentTarget as HTMLInputElement).value })} />
        <Erreur message={error} />
        <Succes message={ok} />
        <div><Button type="submit" disabled={pending}>{t("moncompte.changer")}</Button></div>
      </form>
    </Bloc>
  );
}

function Pin({ hasPin }: { hasPin: boolean }) {
  const { t } = useI18n();
  const [actuel, setActuel] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setOk(null);
    const problem = pinProblem(pin);
    if (problem) { setError(t(problem)); return; }
    setPending(true);
    setError(null);
    try {
      await api("PUT", "/api/auth/me", { current_password: actuel, pin });
      setActuel("");
      setPin("");
      setOk(t("moncompte.pin_enregistre"));
    } catch (err) {
      setActuel("");
      setPin("");
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Bloc titre={t("moncompte.pin_titre")}>
      <p className="text-sm text-encre-grise">{hasPin ? t("moncompte.a_un_pin") : t("moncompte.sans_pin")}</p>
      <form className="grid max-w-md gap-4" onSubmit={submit} noValidate>
        <Champ id="pin-mdp-actuel" type="password" label={t("moncompte.actuel")} autoComplete="current-password" value={actuel} onInput={(e: Event) => setActuel((e.currentTarget as HTMLInputElement).value)} />
        <Champ id="pin-nouveau" type="password" inputMode="numeric" maxLength={6} className="h-14 text-center text-2xl tracking-[0.5em]" label={t("moncompte.nouveau_pin")} autoComplete="off" value={pin} onInput={(e: Event) => setPin((e.currentTarget as HTMLInputElement).value)} />
        <Erreur message={error} />
        <Succes message={ok} />
        <div><Button type="submit" disabled={pending}>{t("moncompte.enregistrer_pin")}</Button></div>
      </form>
    </Bloc>
  );
}
