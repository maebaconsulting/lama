import { useState } from "preact/hooks";
import { api } from "../../api";
import type { BackupsReply, BackupStatus } from "../../lib/api-types";
import { backupRunText, backupStatus, dateHeure, derniereCopie, destinationLabel } from "../../lib/libelles";
import { restoreProblem } from "../../lib/reglages";
import { emitSessionSignal } from "../../lib/session-bus";
import { useLoad } from "../../hooks/use-load";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Champ, Erreur, Succes } from "../champ";
import { useConfirmation } from "../auth/confirmation";
import { useFormation } from "../../formation-context";
import { Bloc, Case, Rubrique, SELECT } from "./elements";
import { cn } from "@/lib/utils";

/** État, historique, sauvegarde à la demande et restauration (administrateur, spec 2 § 7). */
export function Sauvegardes() {
  const confirm = useConfirmation();
  const { t, lang } = useI18n();
  const statut = useLoad(() => api<BackupStatus>("GET", "/api/backups/status"), ["outbox"]);
  const liste = useLoad(() => api<BackupsReply>("GET", "/api/backups"), ["outbox"], { reloadOnLang: true });
  const [enCours, setEnCours] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const sauvegarder = async () => {
    setEnCours(true);
    setError(null);
    setOk(null);
    try {
      const r = await confirm(() => api<{ usb: "ok" | "failed"; drive: "pending" | "none" }>("POST", "/api/backups/run"));
      if (r) {
        if (r.usb === "ok") setOk(backupRunText(r, lang));
        else setError(backupRunText(r, lang));
      }
      await Promise.all([statut.reload(), liste.reload()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnCours(false);
    }
  };

  const formation = useFormation();
  const d = statut.data?.destinations;
  return (
    <Rubrique titre={t("reglages.rubrique.sauvegardes")} description={t("sauvegardes.description")}>
      {formation && <p className="max-w-prose text-sm text-encre-grise">{t("formation.coupe")}</p>}
      <Erreur message={error ?? statut.error ?? liste.error} />
      <Succes message={ok} />
      {d && (
        <dl className="grid max-w-lg grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="etiquette text-encre-grise">{destinationLabel("usb", lang)}</dt>
          <dd className={cn(d.usb.alert && "text-encre-rouge")}>{derniereCopie(d.usb.last_ok_at, lang)}</dd>
          <dt className="etiquette text-encre-grise">{destinationLabel("drive", lang)}</dt>
          <dd className={cn(d.drive.alert && "text-encre-rouge")}>
            {d.drive.configured ? derniereCopie(d.drive.last_ok_at, lang) : t("sauvegardes.drive_non_configure")}
          </dd>
        </dl>
      )}
      <div><Button onClick={() => void sauvegarder()} disabled={enCours}>{enCours ? t("sauvegardes.en_cours") : t("sauvegardes.maintenant")}</Button></div>

      <Bloc titre={t("sauvegardes.historique")}>
        {liste.data?.history.length === 0 && <p className="text-sm text-encre-grise">{t("sauvegardes.aucune")}</p>}
        {!!liste.data?.history.length && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colonne.date")}</TableHead><TableHead>{t("colonne.destination")}</TableHead><TableHead>{t("colonne.etat")}</TableHead>
                <TableHead>{t("colonne.fichier")}</TableHead><TableHead>{t("colonne.message")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {liste.data.history.map((h, i) => (
                <TableRow key={`${h.at}-${h.destination}-${i}`} className="registre">
                  <TableCell className="chiffres-tabulaires">{dateHeure(h.at, lang)}</TableCell>
                  <TableCell>{destinationLabel(h.destination, lang)}</TableCell>
                  <TableCell className={cn(h.status === "failed" && "text-encre-rouge")}>{backupStatus(h.status, lang)}</TableCell>
                  <TableCell className="text-encre-grise">{h.file}</TableCell>
                  <TableCell className="max-w-xs text-encre-grise">{h.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Bloc>

      <Restauration fichiers={liste.data?.files ?? { quotidiennes: [], mensuelles: [] }} />
    </Rubrique>
  );
}

function Restauration({ fichiers }: { fichiers: BackupsReply["files"] }) {
  const { t, lang } = useI18n();
  const confirm = useConfirmation();
  const [source, setSource] = useState<"usb" | "drive">("usb");
  const [nom, setNom] = useState("");
  const [cle, setCle] = useState("");
  const [compris, setCompris] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    const problem = restoreProblem({ source, name: nom, identity: cle, understood: compris });
    if (problem) { setError(t(problem)); return; }
    const identity = cle.trim();
    // La clé privée ne reste pas dans l'écran : elle ne sert qu'à cet envoi.
    setCle("");
    setPending(true);
    setError(null);
    try {
      const done = await confirm(() => api("POST", "/api/backups/restore", { source, name: nom, identity }));
      if (done !== null) {
        // Le serveur passe en maintenance puis redémarre : tous les écrans l'affichent.
        emitSessionSignal("maintenance");
      } else {
        setError(t("restauration.annulee"));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Bloc titre={t("restauration.titre")}>
      <p className="max-w-prose text-sm text-encre-grise">{t("restauration.texte")}</p>
      <form className="grid max-w-lg gap-4" onSubmit={submit} noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="restauration-source">{t("restauration.source")}</Label>
          <select id="restauration-source" className={SELECT} value={source} onChange={(e) => { setSource(e.currentTarget.value as "usb" | "drive"); setNom(""); }}>
            <option value="usb">{destinationLabel("usb", lang)}</option>
            <option value="drive">{destinationLabel("drive", lang)}</option>
          </select>
        </div>
        {source === "usb" ? (
          <div className="space-y-1.5">
            <Label htmlFor="restauration-nom">{t("restauration.sauvegarde")}</Label>
            <select id="restauration-nom" className={SELECT} value={nom} onChange={(e) => setNom(e.currentTarget.value)}>
              <option value="">{t("restauration.choisir")}</option>
              <optgroup label={t("restauration.quotidiennes")}>{fichiers.quotidiennes.map((f) => <option key={f} value={f}>{f}</option>)}</optgroup>
              <optgroup label={t("restauration.mensuelles")}>{fichiers.mensuelles.map((f) => <option key={f} value={f}>{f}</option>)}</optgroup>
            </select>
          </div>
        ) : (
          <Champ id="restauration-nom" label={t("restauration.nom_drive")} placeholder={t("restauration.nom_exemple")} autoComplete="off" spellcheck={false} value={nom} onInput={(e: Event) => setNom((e.currentTarget as HTMLInputElement).value.trim())} />
        )}
        <div className="space-y-1.5">
          <Label htmlFor="restauration-cle">{t("restauration.cle")}</Label>
          <Textarea id="restauration-cle" rows={3} autoComplete="off" spellcheck={false} placeholder={t("restauration.cle_exemple")} value={cle} onInput={(e: Event) => setCle((e.currentTarget as HTMLTextAreaElement).value)} />
        </div>
        <Case id="restauration-compris" label={t("restauration.compris")} checked={compris} onChange={setCompris} />
        <Erreur message={error} />
        <div><Button type="submit" variant="destructive" disabled={pending}>{t("restauration.bouton")}</Button></div>
      </form>
    </Bloc>
  );
}
