import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import type { BackupStatus, OutboxReply, Setting } from "../../lib/api-types";
import { derniereCopie, destinationLabel, offlineText } from "../../lib/libelles";
import { rebase, valuesOf } from "../../lib/reglages";
import { useLoad } from "../../hooks/use-load";
import { useEnvoi } from "../../hooks/use-envoi";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Champ, Erreur, Succes } from "../champ";
import { useConfirmation } from "../auth/confirmation";
import { Bloc, Rubrique } from "./elements";
import { EtatWhatsapp } from "./etat-whatsapp";
import { FournisseurSms } from "./fournisseur-sms";
import { FournisseurWhatsapp } from "./fournisseur-whatsapp";

const DRIVE = "technique.drive_remote";
const TEST = "technique.test_internet_url";
const KEYS = [DRIVE, TEST] as const;

/** Internet, Google Drive, et emplacements prévus pour WhatsApp et les paiements (administrateur, spec 2 § 4). */
export function Connexions() {
  const confirm = useConfirmation();
  const { t, lang } = useI18n();
  const file = useLoad(() => api<OutboxReply>("GET", "/api/outbox?status=pending"), ["outbox"]);
  const statut = useLoad(() => api<BackupStatus>("GET", "/api/backups/status"), ["outbox", "settings"]);
  const reglages = useLoad(() => api<{ settings: Setting[] }>("GET", "/api/settings"), ["settings"]);
  const [baseline, setBaseline] = useState<Record<string, string> | null>(null);
  const [valeurs, setValeurs] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  // Vague C (passe V 1.0) : un verrou par réglage ; le bouton se grise pendant l'envoi.
  const envoi = useEnvoi();

  // Même règle que dans Institut et Postes : un champ non modifié prend la
  // nouvelle valeur au rechargement, un champ en cours de saisie garde son
  // brouillon (sinon un rechargement pendant la frappe l'écraserait).
  useEffect(() => {
    if (!reglages.data) return;
    const fresh = valuesOf(reglages.data.settings, KEYS);
    if (!valeurs || !baseline) {
      setValeurs(fresh);
      setBaseline(fresh);
      return;
    }
    const merged = rebase(baseline, valeurs, fresh);
    setBaseline(merged.baseline);
    setValeurs(merged.form);
  }, [reglages.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const enregistrer = async (key: string, message: string) => {
    if (!valeurs) return;
    setError(null);
    setOk(null);
    try {
      await envoi.lancer(key, async () => {
        const done = await confirm(() => api("PUT", `/api/settings/${key}`, { value: valeurs[key].trim() }));
        if (done !== null) {
          setOk(message);
          setBaseline((b) => (b ? { ...b, [key]: valeurs[key] } : b));
          await Promise.all([reglages.reload(), statut.reload()]);
        }
      });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const drive = statut.data?.destinations.drive;
  return (
    <Rubrique titre={t("reglages.rubrique.connexions")} description={t("connexions.description")}>
      <Erreur message={error ?? file.error ?? statut.error ?? reglages.error} />
      <Succes message={ok} />

      <Bloc titre={t("connexions.internet")}>
        {file.data && <p className="text-sm">{file.data.online ? t("connexions.connecte") : `${offlineText(file.data.pending, lang)}.`}</p>}
        {valeurs && (
          <form className="grid max-w-lg gap-4" onSubmit={(e) => { e.preventDefault(); void enregistrer(TEST, t("connexions.test_enregistree")); }} noValidate>
            <Champ id="connexion-test" type="url" label={t("connexions.adresse_test")} value={valeurs[TEST]} onInput={(e: Event) => setValeurs({ ...valeurs, [TEST]: (e.currentTarget as HTMLInputElement).value })} />
            <div><Button type="submit" variant="outline" disabled={envoi.enCours(TEST)}>{t("connexions.enregistrer_test")}</Button></div>
          </form>
        )}
      </Bloc>

      <Bloc titre={destinationLabel("drive", lang)}>
        {statut.data && (
          <p className="text-sm">
            {drive?.configured ? `${derniereCopie(drive.last_ok_at, lang)}.` : t("connexions.drive_a_configurer")}
          </p>
        )}
        {valeurs && (
          <form className="grid max-w-lg gap-4" onSubmit={(e) => { e.preventDefault(); void enregistrer(DRIVE, t("connexions.destination_enregistree")); }} noValidate>
            <Champ id="connexion-drive" label={t("connexions.destination")} autoComplete="off" spellcheck={false} value={valeurs[DRIVE]} onInput={(e: Event) => setValeurs({ ...valeurs, [DRIVE]: (e.currentTarget as HTMLInputElement).value })} />
            <div><Button type="submit" variant="outline" disabled={envoi.enCours(DRIVE)}>{t("connexions.enregistrer_destination")}</Button></div>
          </form>
        )}
      </Bloc>

      <Bloc titre={t("connexions.whatsapp")}>
        <FournisseurWhatsapp />
        <EtatWhatsapp />
      </Bloc>

      <Bloc titre={t("connexions.sms")}>
        <FournisseurSms />
      </Bloc>

      <Bloc titre={t("connexions.paiements")}>
        <p className="text-sm text-encre-grise">{t("connexions.paiements_a_venir")}</p>
      </Bloc>
    </Rubrique>
  );
}
