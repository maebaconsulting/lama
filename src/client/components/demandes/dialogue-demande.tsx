import { useState } from "preact/hooks";
import { TriangleAlert } from "lucide-preact";
import { api } from "../../api";
import { useApp } from "../../context";
import { useEnvoi } from "../../hooks/use-envoi";
import type { DemandeEnLigne } from "../../types";
import { useI18n } from "@/i18n/provider";
import type { Key } from "@/i18n/translate";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Erreur } from "../champ";
import { ChampDate, ChampHeure } from "../champ-date";
import { SELECT } from "../reglages/elements";
import { conflictsFrom, describeConflict, type Conflict } from "@/lib/conflicts";
import { sellableAlone } from "@/lib/supplements";
import {
  avecFiche, avecHoraire, avecService, CHEMINS, corpsAction, ISSUES_RAPPEL, MOTIFS, praticiennesProposees, prestationDe, saisieInitiale, saisiePrete, type ActionDialogue, type ModeFiche, type Saisie,
} from "@/lib/demandes-en-ligne";

const CASE = "flex min-h-11 items-center gap-3 text-sm";

/**
 * Fenêtre d'une action sur une demande (spec § 4.5) : praticienne, horaire, fiche, motif ou issue selon
 * l'action. Un chevauchement est dit dans la fenêtre, avec « Confirmer quand même » (sauf pour un autre
 * horaire, qui doit être libre) ; un second appui pendant l'envoi est ignoré.
 */
export function DialogueDemande({ demande: d, action, onClose, onDone }: {
  demande: DemandeEnLigne; action: ActionDialogue; onClose: () => void; onDone: (message: string) => void;
}) {
  const { t, lang } = useI18n();
  const { staffLookup, clientLookup, services } = useApp();
  const [saisie, setSaisie] = useState<Saisie>(() => {
    const s = saisieInitiale(d, action);
    // Une prestation désactivée ou passée en « supplément seulement » depuis est refusée par le serveur : la réception en choisit une autre.
    return sellableAlone(services).some((x) => String(x.id) === s.service) ? s : { ...s, service: "" };
  });
  const [conflits, setConflits] = useState<Conflict[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const envoi = useEnvoi();
  const changer = (champ: Partial<Saisie>) => { setConflits(null); setSaisie((s) => ({ ...s, ...champ })); };
  const horaire = avecHoraire(action, saisie.issue);
  const avecLaPrestation = avecService(action, saisie.issue);
  const avecLaFiche = avecFiche(action, saisie.issue);
  const choisirFiche = (mode: ModeFiche) => () => changer({ fiche: mode });
  const [toute, setToute] = useState(false);
  const { liste: proposees, masquees } = praticiennesProposees(staffLookup, avecLaPrestation ? saisie.service : d.service_id, saisie.staff, toute);

  const valider = (forcer = false) => void envoi.lancer("demande", async () => {
    setErreur(null);
    try {
      await api("POST", `/api/demandes-en-ligne/${d.id}/${CHEMINS[action]}`, corpsAction(action, saisie, forcer));
      onDone(t(`demandes.fait.${action}` as Key));
    } catch (err) {
      const clashes = conflictsFrom(err);
      if (clashes) setConflits(clashes);
      else setErreur((err as Error).message);
    }
  });

  return (
    <Dialog open onOpenChange={(o: boolean) => { if (!o && !envoi.occupe) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`demandes.action.${action}` as Key)}</DialogTitle>
          <DialogDescription>{d.cliente_nom} · {prestationDe(d, lang)}</DialogDescription>
        </DialogHeader>
        {action === "clore" && (
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t("demandes.dialogue.issue")}</legend>
            {ISSUES_RAPPEL.map((i) => (
              <label key={i} className={CASE}>
                <input type="radio" name="issue" checked={saisie.issue === i} onChange={() => changer({ issue: i })} />
                {t(`demandes.issue.${i}` as Key)}
              </label>
            ))}
          </fieldset>
        )}
        {(action === "confirmer" || horaire) && (
          <div className="space-y-1.5">
            <Label htmlFor="demande-praticienne">{t("demandes.dialogue.praticienne")}</Label>
            <select id="demande-praticienne" className={SELECT} value={saisie.staff} onChange={(e) => changer({ staff: (e.currentTarget as HTMLSelectElement).value })}>
              <option value="">{t("demandes.dialogue.choisir_praticienne")}</option>
              {proposees.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
            </select>
            {masquees > 0 && (
              <Button type="button" variant="link" className="px-0" onClick={() => setToute(true)}>{t("demandes.dialogue.toute_equipe")}</Button>
            )}
          </div>
        )}
        {horaire && (
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="demande-date">{t("demandes.dialogue.date")}</Label>
              <ChampDate id="demande-date" value={saisie.date} onValue={(v: string) => changer({ date: v })} />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="demande-heure">{t("demandes.dialogue.heure")}</Label>
              <ChampHeure id="demande-heure" className="h-11 w-full min-w-0" value={saisie.heure} onValue={(v: string) => changer({ heure: v })} />
            </div>
          </div>
        )}
        {avecLaPrestation && (
          <div className="space-y-1.5">
            <Label htmlFor="demande-prestation">{t("demandes.dialogue.prestation")}</Label>
            <select id="demande-prestation" className={SELECT} value={saisie.service} onChange={(e) => changer({ service: (e.currentTarget as HTMLSelectElement).value })}>
              <option value="">{t("demandes.dialogue.choisir_prestation")}</option>
              {sellableAlone(services).map((s) => <option key={s.id} value={String(s.id)}>{lang === "en" && s.name_en ? s.name_en : s.name}</option>)}
            </select>
          </div>
        )}
        {avecLaFiche && (
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t("demandes.dialogue.fiche")}</legend>
            {d.client_id !== null && d.fiche === "connue" && (
              <label className={CASE}>
                <input type="radio" name="fiche" checked={saisie.fiche === "trouvee"} onChange={choisirFiche("trouvee")} />
                {t("demandes.dialogue.fiche_trouvee", { nom: d.client_nom ?? "" })}
              </label>
            )}
            <label className={CASE}>
              <input type="radio" name="fiche" checked={saisie.fiche === "autre"} onChange={choisirFiche("autre")} />
              {t("demandes.dialogue.fiche_autre")}
            </label>
            {saisie.fiche === "autre" && (
              <select aria-label={t("demandes.dialogue.choisir_fiche")} className={SELECT} value={saisie.autreClient} onChange={(e) => changer({ autreClient: (e.currentTarget as HTMLSelectElement).value })}>
                <option value="">{t("demandes.dialogue.choisir_fiche")}</option>
                {clientLookup.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
            )}
            <label className={CASE}>
              <input type="radio" name="fiche" checked={saisie.fiche === "nouvelle"} onChange={choisirFiche("nouvelle")} />
              {t("demandes.dialogue.fiche_nouvelle")}
            </label>
          </fieldset>
        )}
        {action === "refuser" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="demande-motif">{t("demandes.dialogue.motif")}</Label>
              <select id="demande-motif" className={SELECT} value={saisie.motif} onChange={(e) => changer({ motif: (e.currentTarget as HTMLSelectElement).value as Saisie["motif"] })}>
                {MOTIFS.map((m) => <option key={m} value={m}>{t(`demandes.motif.${m}` as Key)}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demande-message">{t("demandes.dialogue.message")}</Label>
              <Textarea id="demande-message" rows={3} maxLength={500} value={saisie.message} onInput={(e: Event) => changer({ message: (e.currentTarget as HTMLTextAreaElement).value })} />
            </div>
          </>
        )}
        {conflits && (
          <div role="alert" className="flex min-w-0 gap-2.5 rounded-sm border border-encre-rouge bg-card p-3 text-sm text-encre-rouge">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-encre-rouge" aria-hidden="true" />
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{t("conflit.pas_libre", { qui: staffLookup.find((s) => String(s.id) === saisie.staff)?.name ?? t("conflit.ce_membre") })}</p>
              <ul className="text-muted-foreground">{conflits.map((c, i) => <li key={i}>{describeConflict(c, lang)}</li>)}</ul>
            </div>
          </div>
        )}
        <Erreur message={erreur} />
        <DialogFooter>
          <Button variant="outline" disabled={envoi.occupe} onClick={onClose}>{t("commun.annuler")}</Button>
          {conflits && action !== "autre_horaire" && <Button variant="outline" disabled={envoi.occupe} onClick={() => valider(true)}>{t("demandes.dialogue.quand_meme")}</Button>}
          <Button disabled={envoi.occupe || !saisiePrete(action, saisie)} onClick={() => valider()}>{t("demandes.dialogue.valider")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
