import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import { useAuth } from "../../auth-context";
import { useLoad } from "../../hooks/use-load";
import { EMPTY, formatInstant } from "../../lib/format";
import { derniereOperation, etapeKey, operationEnCours, peutMettreAJour, texteSansVersion, type EtatMiseAJour } from "../../lib/mise-a-jour-reseau";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Erreur, Succes } from "../champ";
import { useConfirmation } from "../auth/confirmation";
import { Bloc, Case, Rubrique, SELECT } from "./elements";

/** Relecture de l'état pendant une opération (étape en cours). */
const SUIVI_MS = 3000;

/**
 * Mise à jour (spec du 21/10/2026, M-14 à M-16) : version installée et version disponible pour
 * l'administrateur et la gérante ; pour l'administrateur, « Vérifier maintenant », « Mettre à jour
 * vers X.Y.Z » (case, puis mot de passe retapé), mode et dernière opération. Le service root fait
 * le travail ; pendant le redémarrage, le serveur met tous les écrans en maintenance.
 */
export function MiseAJourReseau() {
  const { account } = useAuth();
  const admin = account.role === "admin";
  const { t, lang } = useI18n();
  const confirm = useConfirmation();
  const etat = useLoad(() => api<EtatMiseAJour>("GET", "/api/mise-a-jour"), ["settings"], { reloadOnLang: true });
  const [compris, setCompris] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const e = etat.data;
  const enCours = e ? operationEnCours(e) : null;
  const derniere = e ? derniereOperation(e) : null;
  const sansVersion = e ? texteSansVersion(e) : null;

  useEffect(() => {
    if (enCours === null) return;
    const timer = setInterval(() => void etat.reload(), SUIVI_MS);
    return () => clearInterval(timer);
  }, [enCours === null]);

  /** Lance une action ; `annulee` : texte si la saisie du mot de passe est abandonnée. */
  const agir = async (action: () => Promise<unknown>, reussite: string | null, annulee: string | null = null) => {
    if (pending) return;
    setPending(true);
    setError(null);
    setOk(null);
    try {
      const fait = await action();
      if (fait === null && annulee) setError(annulee);
      else if (reussite) setOk(reussite);
      await etat.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const mettreAJour = () => {
    if (!compris) {
      setError(t("mise_a_jour.cocher"));
      return;
    }
    void agir(() => confirm(() => api("POST", "/api/mise-a-jour")), t("mise_a_jour.demandee"), t("mise_a_jour.annulee"));
  };
  const changerMode = (mode: string) => void agir(() => confirm(() => api("PUT", "/api/mise-a-jour/mode", { mode })), t("mise_a_jour.mode.enregistre"));

  return (
    <Rubrique titre={t("reglages.rubrique.mise_a_jour")} description={t("mise_a_jour.description")}>
      <Erreur message={error ?? etat.error} />
      <Succes message={ok} />
      {e && (
        <>
          <dl className="grid max-w-lg grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="etiquette text-encre-grise">{t("mise_a_jour.installee")}</dt>
            <dd>
              {e.installee.developpement ? t("mise_a_jour.version_developpement", { version: e.installee.version }) : e.installee.version}
              {e.installee.installee_le !== null && <span className="block text-encre-grise">{t("mise_a_jour.installee_le", { date: formatInstant(e.installee.installee_le, lang) })}</span>}
            </dd>
            <dt className="etiquette text-encre-grise">{t("mise_a_jour.disponible")}</dt>
            <dd>
              {e.disponible ? e.disponible.version : sansVersion ? t(sansVersion) : EMPTY}
              {e.disponible?.publiee_le != null && <span className="block text-encre-grise">{t("mise_a_jour.publiee_le", { date: formatInstant(e.disponible.publiee_le, lang) })}</span>}
            </dd>
          </dl>
          {e.installee.developpement && <p className="max-w-prose text-sm text-encre-grise">{t("mise_a_jour.developpement_aide")}</p>}
          {e.erreur && <p role="alert" className="max-w-prose text-sm text-encre-rouge">{e.erreur}</p>}
          <p className="text-sm text-encre-grise">{e.verifie_le === null ? t("mise_a_jour.jamais_verifiee") : t("mise_a_jour.verifiee_le", { date: formatInstant(e.verifie_le, lang) })}</p>
          {admin && <div><Button variant="secondary" disabled={pending} onClick={() => void agir(() => api("POST", "/api/mise-a-jour/verifier"), null)}>{t("mise_a_jour.verifier")}</Button></div>}
          {e.disponible && e.disponible.note && (
            <Bloc titre={t("mise_a_jour.ce_qui_change")}>
              <p className="max-w-prose whitespace-pre-line text-sm">{e.disponible.note}</p>
            </Bloc>
          )}
          {admin && e.mecanisme === false && !e.installee.developpement && <p className="max-w-prose text-sm text-encre-grise">{t("mise_a_jour.non_pose")}</p>}
          {admin && enCours !== null && (
            <p role="status" className="max-w-prose text-sm">
              {enCours === "preparation" ? t("mise_a_jour.preparation") : t("mise_a_jour.en_cours", { version: enCours.version_cible ?? EMPTY, etape: t(etapeKey(enCours.etape)) })}
            </p>
          )}
          {admin && peutMettreAJour(e) && (
            <Bloc titre={t("mise_a_jour.nouvelle")}>
              <p className="max-w-prose text-sm text-encre-grise">{t("mise_a_jour.confirmation")}</p>
              <Case id="mise-a-jour-compris" label={t("mise_a_jour.compris")} checked={compris} onChange={setCompris} />
              <div><Button disabled={pending} onClick={mettreAJour}>{t("mise_a_jour.bouton", { version: e.disponible!.version })}</Button></div>
            </Bloc>
          )}
          {admin && e.mecanisme === true && !e.installee.developpement && (
            <Bloc titre={t("mise_a_jour.mode")}>
              <div className="max-w-xs space-y-1.5">
                <Label htmlFor="mise-a-jour-mode">{t("mise_a_jour.mode")}</Label>
                <select id="mise-a-jour-mode" className={SELECT} value={e.mode} disabled={pending} onChange={(ev) => changerMode(ev.currentTarget.value)}>
                  <option value="manuel">{t("mise_a_jour.mode.manuel")}</option>
                  <option value="automatique">{t("mise_a_jour.mode.automatique")}</option>
                </select>
              </div>
            </Bloc>
          )}
          {admin && derniere && derniere.fin !== null && (
            <Bloc titre={t("mise_a_jour.derniere")}>
              <p className="max-w-prose text-sm">
                {derniere.resultat === "reussie"
                  ? t("mise_a_jour.resultat.reussie", { version: derniere.version_cible ?? EMPTY, date: formatInstant(derniere.fin, lang) })
                  : t("mise_a_jour.resultat.echec", { version: derniere.version_cible ?? EMPTY, date: formatInstant(derniere.fin, lang), motif: derniere.motif_texte ?? EMPTY })}
              </p>
            </Bloc>
          )}
        </>
      )}
    </Rubrique>
  );
}
