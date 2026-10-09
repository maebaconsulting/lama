import { useState } from "preact/hooks";
import { api } from "../../api";
import type { Device } from "../../lib/auth-types";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Champ, Erreur } from "../champ";
import { Couverture } from "./couverture";
import { ComptesDemo } from "./comptes-demo";

/** Connexion par identifiant et mot de passe (appareil personnel, ou administrateur sur un poste). */
export function Connexion({ device, onDone, onBackToPoste }: { device: Device | null; onDone: () => Promise<void>; onBackToPoste: () => void }) {
  const { t } = useI18n();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!login.trim() || !password) { setError(t("connexion.manquant")); return; }
    setPending(true);
    setError(null);
    try {
      await api("POST", "/api/auth/login", { login: login.trim(), password });
      await onDone();
    } catch (err) {
      setPassword("");
      setError((err as Error).message);
      setPending(false);
    }
  };

  return (
    <Couverture titre={t("connexion.titre")} sousTitre={device ? t("connexion.poste", { nom: device.name }) : t("connexion.sous_titre")}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <Champ id="identifiant" label={t("connexion.identifiant")} autoComplete="username" autoCapitalize="none" spellcheck={false} value={login} onInput={(e: Event) => setLogin((e.currentTarget as HTMLInputElement).value)} />
        <Champ id="mot-de-passe" type="password" label={t("connexion.mot_de_passe")} autoComplete="current-password" value={password} onInput={(e: Event) => setPassword((e.currentTarget as HTMLInputElement).value)} />
        <Erreur message={error} />
        <Button type="submit" className="w-full" disabled={pending}>{pending ? t("connexion.en_cours") : t("connexion.bouton")}</Button>
        {device && <Button type="button" variant="link" className="w-full" onClick={onBackToPoste}>{t("connexion.retour_poste")}</Button>}
      </form>
      {/* Démonstration publique (DP-03) : les comptes publics, un toucher remplit le formulaire. */}
      <ComptesDemo onChoisir={(compte) => { setLogin(compte.login); setPassword(compte.mot_de_passe); setError(null); }} />
    </Couverture>
  );
}
