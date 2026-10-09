import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import { useAuth } from "../../auth-context";
import type { DeviceRow, Setting } from "../../lib/api-types";
import { dateHeure } from "../../lib/libelles";
import { rebase, valuesOf } from "../../lib/reglages";
import { useLoad } from "../../hooks/use-load";
import { useEnvoi } from "../../hooks/use-envoi";
import { useApp } from "../../context";
import { isOpen } from "../../lib/fiches";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Champ, Erreur, Succes } from "../champ";
import { useConfirmation } from "../auth/confirmation";
import { ListeFiches, LigneFiche } from "../fiches/liste-fiches";
import { Bloc, Rubrique } from "./elements";

const DELAI_KEY = "postes.verrouillage_minutes";

/**
 * Déclaration de cet appareil, liste des postes et délai de verrouillage
 * (spec 2 § 3.3) ; toucher un poste ouvre sa fiche dans le panneau, où il se
 * révoque (sous-projet 4 § 7.1).
 */
export function Postes() {
  const { device, reload: reloadAuth, logout } = useAuth();
  const { panel, openPanel } = useApp();
  const { t, lang } = useI18n();
  const confirm = useConfirmation();
  // Vague C (passe V 1.0) : un double appui sur « Déclarer » ou « Enregistrer le délai » ne part qu'une fois.
  const envoi = useEnvoi();
  const postes = useLoad(() => api<{ devices: DeviceRow[] }>("GET", "/api/devices"), ["accounts"]);
  const reglages = useLoad(() => api<{ settings: Setting[] }>("GET", "/api/settings"), ["settings"]);
  const [nom, setNom] = useState(() => t("postes.nom_defaut"));
  const [delaiBaseline, setDelaiBaseline] = useState<Record<string, string> | null>(null);
  const [delaiForm, setDelaiForm] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Même règle que dans Institut : un champ non modifié prend la nouvelle
  // valeur, un champ en cours de saisie garde son brouillon.
  useEffect(() => {
    if (!reglages.data) return;
    const fresh = valuesOf(reglages.data.settings, [DELAI_KEY]);
    if (!delaiForm || !delaiBaseline) {
      setDelaiForm(fresh);
      setDelaiBaseline(fresh);
      return;
    }
    const merged = rebase(delaiBaseline, delaiForm, fresh);
    setDelaiBaseline(merged.baseline);
    setDelaiForm(merged.form);
  }, [reglages.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const agir = async (cle: string, action: () => Promise<unknown>, message: string, onSuccess?: () => void) => {
    setError(null);
    setOk(null);
    try {
      await envoi.lancer(cle, async () => {
        const done = await confirm(action);
        if (done !== null) {
          setOk(message);
          onSuccess?.();
        }
      });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const declarer = (e: Event) => {
    e.preventDefault();
    void agir("declarer", async () => {
      await api("POST", "/api/devices", { name: nom.trim() });
      await reloadAuth();
      await postes.reload();
    }, t("postes.declare"));
  };

  const enregistrerDelai = (e: Event) => {
    e.preventDefault();
    const value = delaiForm?.[DELAI_KEY] ?? "";
    void agir(
      "delai",
      () => api("PUT", `/api/settings/${DELAI_KEY}`, { value: Number(value) }),
      t("postes.delai_enregistre"),
      () => setDelaiBaseline((current) => (current ? { ...current, [DELAI_KEY]: value } : current)),
    );
  };

  return (
    <Rubrique titre={t("reglages.rubrique.postes")} description={t("postes.description")}>
      <Erreur message={error ?? postes.error} />
      <Succes message={ok} />

      <Bloc titre={t("postes.cet_appareil")}>
        {device ? (
          <div className="space-y-3 text-sm">
            <p>{t("postes.est_poste", { nom: device.name })}</p>
            <p className="text-encre-grise">{t("postes.fermer_session")}</p>
            <Button variant="outline" onClick={() => void logout()}>{t("menu.deconnexion")}</Button>
          </div>
        ) : (
          <form className="grid max-w-md gap-4" onSubmit={declarer} noValidate>
            <Champ id="poste-nom" label={t("postes.nom")} value={nom} onInput={(e: Event) => setNom((e.currentTarget as HTMLInputElement).value)} />
            <div><Button type="submit" disabled={envoi.enCours("declarer") || !nom.trim()}>{t("postes.declarer")}</Button></div>
          </form>
        )}
      </Bloc>

      <Bloc titre={t("postes.declares")}>
        {postes.data?.devices.length === 0 && <p className="text-sm text-encre-grise">{t("postes.aucun")}</p>}
        {!!postes.data?.devices.length && (
          <div className="@container">
            <ListeFiches libelle={t("postes.declares")}>
              {postes.data.devices.map((d) => (
                <LigneFiche
                  key={d.id}
                  titre={d.name}
                  detail={t("postes.vu_le", { date: dateHeure(d.last_seen_at, lang) })}
                  secondaire={device?.id === d.id ? t("postes.cet_appareil") : undefined}
                  fin={<span className="text-muted-foreground">{d.revoked ? t("postes.etat.revoque") : t("compte.etat.actif")}</span>}
                  attenue={d.revoked === 1}
                  actif={isOpen(panel, "device", d.id)}
                  onOpen={() => openPanel("device", d.id)}
                />
              ))}
            </ListeFiches>
          </div>
        )}
      </Bloc>

      <Bloc titre={t("postes.verrouillage")}>
        <form className="grid max-w-md gap-4" onSubmit={enregistrerDelai} noValidate>
          <Champ id="poste-delai" type="number" min={1} max={30} step={1} label={t("postes.minutes")} value={delaiForm?.[DELAI_KEY] ?? ""} onInput={(e: Event) => setDelaiForm((f) => ({ ...(f ?? {}), [DELAI_KEY]: (e.currentTarget as HTMLInputElement).value }))} />
          <div><Button type="submit" disabled={envoi.enCours("delai") || !delaiForm?.[DELAI_KEY]}>{t("postes.enregistrer_delai")}</Button></div>
        </form>
      </Bloc>
    </Rubrique>
  );
}
