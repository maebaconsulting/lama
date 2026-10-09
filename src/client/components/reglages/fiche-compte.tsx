import { useState } from "preact/hooks";
import { api } from "../../api";
import { useAuth } from "../../auth-context";
import { useDemo } from "../../demo-context";
import { estCompteDemo } from "../../lib/demo";
import type { Account } from "../../lib/auth-types";
import { EMPTY } from "../../lib/format";
import { etatCompte } from "../../lib/libelles";
import { accountCommands } from "../../lib/reglages";
import { ROLE_KEYS } from "../../lib/roles";
import { useLoad } from "../../hooks/use-load";
import type { StaffLookup } from "../../types";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Erreur, Succes } from "../champ";
import { EtatChargement, EtatErreur } from "../comptoir";
import { ACTION, EnTeteFiche, LigneDetail } from "../fiches/corps-fiche";
import { Edition } from "./comptes";

/**
 * Fiche d'un compte dans le panneau (sous-projet 4 § 7.1) : identifiant,
 * rôle, langue, état, PIN et fiche de l'équipe d'une praticienne ; Modifier
 * (fenêtre de modification) et Débloquer selon les règles du serveur
 * (`accountCommands`). Relue à chaque signal « comptes » du serveur.
 */
export function FicheCompte({ id }: { id: number }) {
  const { account: moi } = useAuth();
  const { t, lang } = useI18n();
  const demo = useDemo();
  const comptes = useLoad(() => api<{ accounts: Account[] }>("GET", "/api/accounts"), ["accounts"]);
  const fiches = useLoad(() => (moi.role === "manager" ? api<{ staff: StaffLookup[] }>("GET", "/api/staff/all") : Promise.resolve({ staff: [] as StaffLookup[] })), ["staff"]);
  const [edition, setEdition] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (comptes.error) return <div className="p-4"><EtatErreur message={comptes.error} onRetry={() => void comptes.reload()} /></div>;
  if (!comptes.data) return <EtatChargement />;
  const cible = comptes.data.accounts.find((a) => a.id === id);
  if (!cible) return <div className="p-4"><EtatErreur message={t("fiche.introuvable")} /></div>;

  const now = Date.now();
  const etat = etatCompte(cible, now, lang);
  const commands = accountCommands(moi, cible, now);
  // Démonstration publique (DP-06) : la fiche d'un compte public ne se modifie pas, le serveur refuse aussi.
  const fige = estCompteDemo(demo, cible.login);
  const modifier = commands.edit && !fige;
  const fiche = fiches.data?.staff.find((s) => s.id === cible.staff_id);

  const debloquer = async () => {
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      await api("POST", `/api/accounts/${cible.id}/unlock`);
      setOk(t("comptes.debloque", { nom: cible.display_name }));
      await comptes.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 p-4">
      <EnTeteFiche titre={cible.display_name} sousTitre={t(ROLE_KEYS[cible.role])} />
      <dl className="grid gap-4">
        <LigneDetail libelle={t("colonne.identifiant")}>{cible.login}</LigneDetail>
        <LigneDetail libelle={t("colonne.langue")}>{t(cible.language === "en" ? "langue.nom.en" : "langue.nom.fr")}</LigneDetail>
        <LigneDetail libelle={t("colonne.etat")}><span className={etat.alert ? "text-encre-rouge" : undefined}>{etat.text}</span></LigneDetail>
        <LigneDetail libelle={t("colonne.pin")}>{cible.has_pin ? t("commun.oui") : t("commun.non")}</LigneDetail>
        {cible.role === "practitioner" && moi.role === "manager" && (
          <LigneDetail libelle={t("comptes.fiche")}>{fiche?.name ?? EMPTY}</LigneDetail>
        )}
      </dl>
      {fige && <p className="text-sm text-encre-grise">{t("demo.compte_fige")}</p>}
      <Erreur message={error} />
      <Succes message={ok} />
      {(modifier || commands.unlock) && (
        <div className="flex flex-wrap gap-2 border-t border-filet pt-4">
          {modifier && <Button variant="outline" className={ACTION} onClick={() => { setOk(null); setEdition(true); }}>{t("commun.modifier")}</Button>}
          {commands.unlock && <Button variant="outline" className={ACTION} disabled={busy} onClick={() => void debloquer()}>{t("comptes.debloquer")}</Button>}
        </div>
      )}
      {edition && (
        <Edition
          cible={cible}
          moi={moi}
          fiches={fiches.data?.staff ?? []}
          onClose={() => setEdition(false)}
          onDone={async (message) => { setEdition(false); setOk(message); await comptes.reload(); }}
        />
      )}
    </div>
  );
}
