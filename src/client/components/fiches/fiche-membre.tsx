import { useState } from "preact/hooks";
import { Mail, Phone } from "lucide-preact";
import { useApp } from "../../context";
import { useAuth } from "../../auth-context";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { todayAt } from "@/lib/calendrier";
import { catalogCommands, telHref } from "@/lib/fiches";
import { EMPTY } from "@/lib/format";
import { STAFF_INKS, toInk } from "@/lib/inks";
import { pathFor } from "@/lib/routes";
import { canManageAppointments } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { Staff } from "../../types";
import { Succes } from "../champ";
import { CreateStaff } from "../create-staff";
import { TransfertRdv } from "../transfert-rdv";
import { ACTION, EnTeteFiche, LigneDetail, PastilleEncre, SuppressionFiche } from "./corps-fiche";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";
const LIEN = cn("flex min-h-11 items-center gap-2 break-all underline decoration-filet underline-offset-4 hover:decoration-foreground", FOCUS);

/**
 * Fiche d'un membre de l'équipe dans le panneau (sous-projet 4 § 6) :
 * coordonnées (appel en un geste), fonction dans les deux langues, couleur,
 * « Voir son agenda » (l'agenda du jour, sa colonne en premier sur
 * téléphone) ; pour la gérante : Modifier, Désactiver ou Réactiver, et
 * Supprimer (refusé par le serveur s'il a des rendez-vous ou un compte).
 * « Transférer ses rendez-vous » pour la gérante et la réception (spec du 04/10/2026).
 */
export function FicheMembre({ staff }: { staff: Staff }) {
  const { updateStaff, deleteStaff, navigate, setCalendarDate, setAgendaStaffId, setError } = useApp();
  const { account } = useAuth();
  const { t, tn, lang } = useI18n();
  const commands = catalogCommands(account.role);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [transferring, setTransferring] = useState(false);
  // Avis du dernier transfert, gardé après la fermeture de la fenêtre.
  const [transferNotice, setTransferNotice] = useState<string | null>(null);
  // Transfert des rendez-vous (spec du 04/10/2026, décision 13) : gérante et réception, comme « Déplacer ».
  const transfer = canManageAppointments(account.role);
  const call = telHref(staff.phone);
  const ink = STAFF_INKS.find((i) => i.hex.toLowerCase() === toInk(staff.color).toLowerCase());

  const voirAgenda = () => {
    setCalendarDate(todayAt());
    setAgendaStaffId(staff.id);
    navigate(pathFor("calendar", lang));
  };
  const toggle = async () => {
    setSaving(true);
    try {
      await updateStaff(staff.id, { active: staff.active ? 0 : 1 });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 p-4">
      <EnTeteFiche
        titre={staff.name}
        pastille={<PastilleEncre color={staff.color} grande />}
        sousTitre={staff.active ? tn("commun.nb_rdv", staff.appointment_count ?? 0) : t("equipe.desactivee")}
      />

      <div className="grid grid-cols-2 gap-2">
        <Button className={cn(ACTION, !commands.manage && "col-span-2")} onClick={voirAgenda}>{t("equipe.voir_agenda")}</Button>
        {commands.manage && <Button variant="outline" className={ACTION} onClick={() => setEditing(true)}>{t("commun.modifier")}</Button>}
        {transfer && <Button variant="outline" className={cn(ACTION, "col-span-2")} onClick={() => setTransferring(true)}>{t("transfert.ouvrir")}</Button>}
      </div>

      <Succes message={transferNotice} />

      <dl className="grid gap-4 border-t border-filet pt-4 @md:grid-cols-2">
        <LigneDetail libelle={t("equipe.fonction")}>{staff.title || EMPTY}</LigneDetail>
        <LigneDetail libelle={t("equipe.fonction_anglais")}>{staff.title_en || EMPTY}</LigneDetail>
        <LigneDetail libelle={t("colonne.telephone")}>
          {call ? <a href={call} className={LIEN}><Phone className="h-4 w-4 shrink-0" aria-hidden="true" /> <span className="chiffres-tabulaires">{staff.phone}</span></a> : EMPTY}
        </LigneDetail>
        <LigneDetail libelle={t("colonne.email")}>
          {staff.email ? <a href={`mailto:${staff.email}`} className={LIEN}><Mail className="h-4 w-4 shrink-0" aria-hidden="true" /> {staff.email}</a> : EMPTY}
        </LigneDetail>
        <LigneDetail libelle={t("commun.couleur")}>
          <span className="flex items-center gap-2">
            <PastilleEncre color={staff.color} />
            {ink ? t(ink.labelKey) : EMPTY}
          </span>
        </LigneDetail>
      </dl>

      {commands.manage && (
        <div className="space-y-3 border-t border-filet pt-4">
          <Button variant="outline" disabled={saving} onClick={toggle}>
            {staff.active ? t("equipe.desactiver_fiche") : t("equipe.reactiver_fiche")}
          </Button>
          <p className="text-sm text-muted-foreground">{staff.active ? t("equipe.desactiver_aide") : t("equipe.reactiver_aide")}</p>
        </div>
      )}

      {commands.manage && (
        <SuppressionFiche
          question={t("equipe.supprimer_question", { nom: staff.name })}
          bloquee={(staff.appointment_count ?? 0) > 0 ? t("equipe.suppression_impossible") : null}
          onDelete={() => deleteStaff(staff.id)}
        />
      )}

      {editing && <CreateStaff key={staff.id} staff={staff} onClose={() => setEditing(false)} />}
      {transferring && <TransfertRdv staffId={staff.id} staffName={staff.name} day={null} onClose={() => setTransferring(false)} onDone={setTransferNotice} />}
    </div>
  );
}
