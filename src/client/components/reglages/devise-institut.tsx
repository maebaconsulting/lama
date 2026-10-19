import { useState } from "preact/hooks";
import { api } from "../../api";
import type { Setting } from "../../lib/api-types";
import { apercuDevise, deviseEtat, prixConserve } from "../../lib/reglages-devise";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CODES_DEVISES, DEVISES, type CodeDevise, type PositionSymbole } from "../../../shared/devises";
import { Erreur, Succes } from "../champ";
import { useConfirmation } from "../auth/confirmation";
import { useAuth } from "../../auth-context";
import { Bloc, Case, SELECT } from "./elements";

/**
 * Rubrique Devise (spec du 15/10/2026, § 5), dans la rubrique Caisse des deux
 * rôles. La devise se change avec le mot de passe tant qu'aucune facture,
 * acompte ou clôture n'existe ; la position du symbole et son affichage à
 * l'écran se règlent à tout moment (mot de passe confirmé pour l'administrateur).
 * Aucun formulaire HTML ici : dans la rubrique de la gérante, un formulaire imbriqué
 * ferait aussi enregistrer les réglages de caisse (voir PrefixeFactures).
 */
export function DeviseInstitut({ settings, onSaved }: { settings: Setting[]; onSaved: () => unknown }) {
  const confirm = useConfirmation();
  const { t, lang } = useI18n();
  const auth = useAuth();
  const etat = deviseEtat(settings);
  const [code, setCode] = useState<CodeDevise | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!settings.some((s) => s.key === "institut.devise")) return null;

  const choisie = code ?? etat.code;
  const saisie = { code: choisie, position: etat.position, symboleEcran: etat.symboleEcran };

  const run = async (action: () => Promise<unknown>, message: string | null) => {
    if (pending) return;
    setOk(null);
    setError(null);
    setPending(true);
    try {
      const done = await action();
      if (done === null) return;
      setCode(null);
      setOk(message);
      await onSaved();
      await auth.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };
  const changer = () => {
    void run(() => confirm(() => api("PUT", "/api/devise", { code: choisie })), t("devise.enregistree"));
  };
  const reglage = (key: string, value: unknown) => void run(() => confirm(() => api("PUT", `/api/settings/${key}`, { value })), null);
  const position = (value: PositionSymbole | null) => reglage("affichage.symbole_position", value);
  const apercu = apercuDevise(saisie, lang);

  return (
    <Bloc titre={t("devise.titre")}>
      <div className="grid max-w-md gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="reglage-devise">{t("devise.devise")}</Label>
          <select id="reglage-devise" className={SELECT} value={choisie} disabled={!etat.modifiable || pending} onChange={(e) => setCode((e.currentTarget as HTMLSelectElement).value as CodeDevise)}>
            {CODES_DEVISES.map((c) => <option key={c} value={c}>{`${DEVISES[c].nom[lang]} (${c})`}</option>)}
          </select>
          {etat.fige && <p className="text-sm text-encre-grise">{t("devise.figee", { numero: etat.fige })}</p>}
        </div>
        {etat.modifiable && choisie !== etat.code && (
          <p className="max-w-prose text-sm text-encre-grise">{t("devise.avertissement", prixConserve({ ...saisie, code: etat.code }, saisie, lang))}</p>
        )}
        {etat.modifiable && <div><Button type="button" onClick={changer} disabled={pending || choisie === etat.code}>{t("devise.changer")}</Button></div>}
      </div>
      <fieldset className="grid max-w-md gap-1" disabled={pending}>
        <legend className="mb-1 text-sm">{t("devise.position")}</legend>
        {([[null, "devise.position_defaut"], ["avant", "devise.avant"], ["apres", "devise.apres"]] as const).map(([valeur, cle]) => (
          <label key={cle} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="radio" name="devise-position" className="h-4 w-4 accent-primary" checked={etat.position === valeur} onChange={() => position(valeur)} />
            {t(cle)}
          </label>
        ))}
      </fieldset>
      <Case id="devise-symbole-ecran" label={t("devise.symbole_ecran")} checked={etat.symboleEcran} disabled={pending} onChange={(v) => reglage("affichage.symbole_ecran", v)} />
      <p className="text-sm text-encre-grise">{t("devise.apercu", apercu)}</p>
      <Erreur message={error} />
      <Succes message={ok} />
    </Bloc>
  );
}
