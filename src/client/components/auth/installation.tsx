import { useState } from "preact/hooks";
import { api } from "../../api";
import { newAccountProblem } from "../../lib/forms";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Champ, Erreur } from "../champ";
import { Couverture } from "./couverture";
import { useFormation } from "../../formation-context";

/** Première mise en route : crée le compte administrateur (spec 2 § 3.2), dans la langue de l'écran. */
export function Installation({ onDone }: { onDone: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const formation = useFormation();
  const [form, setForm] = useState({ display_name: "", login: "", password: "", confirmation: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof form) => (e: Event) => setForm((f) => ({ ...f, [key]: (e.currentTarget as HTMLInputElement).value }));

  const submit = async (e: Event) => {
    e.preventDefault();
    // L'administrateur n'a jamais de PIN (il ne passe pas par un poste) : rien à contrôler de ce côté.
    const problem = newAccountProblem({ ...form, pin: "" });
    if (problem) { setError(t(problem)); return; }
    setPending(true);
    setError(null);
    try {
      await api("POST", "/api/auth/install", { display_name: form.display_name.trim(), login: form.login.trim(), password: form.password, language: lang });
      await onDone();
    } catch (err) {
      setForm((f) => ({ ...f, password: "", confirmation: "" }));
      setError((err as Error).message);
      setPending(false);
    }
  };

  // Base de formation sans compte : le serveur refuse l'installation (409), le technicien crée les comptes.
  if (formation) {
    return (
      <Couverture titre={t("formation.sans_compte")} sousTitre={t("formation.sans_compte_aide")}>
        <Button className="w-full" onClick={() => void onDone()}>{t("etat.reessayer")}</Button>
      </Couverture>
    );
  }

  return (
    <Couverture titre={t("installation.titre")} sousTitre={t("installation.sous_titre")}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <Champ id="nom" label={t("compte.nom_affiche")} autoComplete="name" value={form.display_name} onInput={set("display_name")} />
        <Champ id="identifiant" label={t("connexion.identifiant")} autoComplete="username" autoCapitalize="none" spellcheck={false} value={form.login} onInput={set("login")} />
        <Champ id="mot-de-passe" type="password" label={t("installation.mot_de_passe")} autoComplete="new-password" value={form.password} onInput={set("password")} />
        <Champ id="confirmation" type="password" label={t("compte.mot_de_passe_bis")} autoComplete="new-password" value={form.confirmation} onInput={set("confirmation")} />
        <Erreur message={error} />
        <Button type="submit" className="w-full" disabled={pending}>{pending ? t("installation.en_cours") : t("installation.bouton")}</Button>
      </form>
    </Couverture>
  );
}
