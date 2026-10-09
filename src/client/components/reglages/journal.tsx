import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import type { AuditEntry } from "../../lib/api-types";
import type { Account } from "../../lib/auth-types";
import { auditQuery } from "../../lib/journal";
import { auditAction, auditTarget, dateHeure } from "../../lib/libelles";
import { useLoad } from "../../hooks/use-load";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Erreur } from "../champ";
import { ChampDate } from "../champ-date";
import { Rubrique, SELECT } from "./elements";

const VIDE = { accountId: "", from: "", to: "" };

/**
 * Qui a fait quoi, quand et d'où (spec 2 § 3.5) ; le serveur stocke des codes
 * d'action, traduits ici (spec § 6). Sous-projet 4 § 7.1 : une carte par
 * entrée au téléphone, une ligne dense dès 36 rem ; tout tient sur la ligne,
 * rien à ouvrir. § 7.3 : une date illisible ou hors bornes dans le filtre est
 * dite, au lieu d'être ignorée en silence.
 */
export function Journal() {
  const { t, lang } = useI18n();
  const comptes = useLoad(() => api<{ accounts: Account[] }>("GET", "/api/accounts"), ["accounts"]);
  const [filtre, setFiltre] = useState(VIDE);
  const [applique, setApplique] = useState(VIDE);
  const [probleme, setProbleme] = useState<string | null>(null);
  const entrees = useLoad(() => api<{ entries: AuditEntry[] }>("GET", `/api/audit?${auditQuery(applique)}`));

  useEffect(() => { void entrees.reload(); }, [applique]); // eslint-disable-line react-hooks/exhaustive-deps

  const afficher = (e: Event) => {
    e.preventDefault();
    // Le champ de date signale une saisie illisible au navigateur (`setCustomValidity`) : le filtre n'est pas appliqué.
    if (!(e.currentTarget as HTMLFormElement).checkValidity()) {
      setProbleme(t("journal.date_illisible"));
      return;
    }
    setProbleme(null);
    setApplique(filtre);
  };

  return (
    <Rubrique titre={t("reglages.rubrique.journal")} description={t("journal.description")}>
      <div className="@container space-y-4">
        <form className="grid gap-4 @xl:grid-cols-2 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={afficher} noValidate>
          <div className="space-y-1.5 @xl:col-span-2 @3xl:col-span-1">
            <Label htmlFor="journal-personne">{t("journal.personne")}</Label>
            <select id="journal-personne" className={SELECT} value={filtre.accountId} onChange={(e: Event) => setFiltre({ ...filtre, accountId: (e.currentTarget as HTMLSelectElement).value })}>
              <option value="">{t("journal.tout_le_monde")}</option>
              {comptes.data?.accounts.map((a) => <option key={a.id} value={String(a.id)}>{a.display_name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="journal-du">{t("journal.du")}</Label>
            <ChampDate id="journal-du" max={filtre.to} value={filtre.from} onValue={(v: string) => setFiltre((f) => ({ ...f, from: v }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="journal-au">{t("journal.au")}</Label>
            <ChampDate id="journal-au" min={filtre.from} value={filtre.to} onValue={(v: string) => setFiltre((f) => ({ ...f, to: v }))} />
          </div>
          <div className="@3xl:self-start @3xl:pt-7"><Button type="submit">{t("journal.afficher")}</Button></div>
        </form>
        <Erreur message={probleme ?? entrees.error} />
        {entrees.data?.entries.length === 0 && <p className="text-sm text-encre-grise">{t("journal.vide")}</p>}
        {!!entrees.data?.entries.length && (
          <ul aria-label={t("reglages.rubrique.journal")} className="flex flex-col gap-2 @xl:gap-0 @xl:rounded-sm @xl:border @xl:border-filet @xl:bg-card">
            {entrees.data.entries.map((e) => {
              const echec = e.action.startsWith("connexion.") && e.action !== "connexion.poste";
              const cible = auditTarget(e.target, lang);
              return (
                <li key={e.id} className="grid min-w-0 gap-0.5 rounded-sm border border-filet bg-card p-3 text-sm @xl:grid-cols-[9.5rem_minmax(0,1fr)_minmax(0,1fr)] @xl:items-baseline @xl:gap-4 @xl:rounded-none @xl:border-x-0 @xl:border-t-0 @xl:last:border-b-0 @xl:bg-transparent @xl:px-4 @xl:py-2">
                  <span className="chiffres-tabulaires text-muted-foreground">{dateHeure(e.at, lang)}</span>
                  <span className="min-w-0 break-words">
                    <span className={echec ? "font-medium text-encre-rouge" : "font-medium"}>{auditAction(e.action, lang)}</span>
                    {e.account_name && <span className="text-muted-foreground">{` · ${e.account_name}`}</span>}
                  </span>
                  <span className="min-w-0 break-words text-muted-foreground">
                    {cible}
                    {e.ip && <span className="chiffres-tabulaires">{cible ? ` · ${e.ip}` : e.ip}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Rubrique>
  );
}
