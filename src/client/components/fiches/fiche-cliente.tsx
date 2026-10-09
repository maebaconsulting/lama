import { useEffect, useRef, useState } from "preact/hooks";
import { Mail } from "lucide-preact";
import { useApp } from "../../context";
import { useAuth, useCrm } from "../../auth-context";
import { useAbsenceDays } from "../../hooks/use-absence-days";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/provider";
import { pickText } from "@/lib/bilingual";
import { todayAt } from "@/lib/calendrier";
import { absenceLine, absenceText, birthdayLabel, crmTags, ficheCrm, isBirthdayToday, MAX_PREFERENCES } from "@/lib/crm";
import { clientCommands } from "@/lib/fiches";
import { canSeeManual, canSell } from "@/lib/roles";
import { EMPTY, formatPrice, formatShortDate, formatTimestampDate } from "@/lib/format";
import { encreVars, toInk } from "@/lib/inks";
import { cn } from "@/lib/utils";
import { FacturesCliente } from "../caisse/factures-cliente";
import { CreateAppointment } from "../create-appointment";
import { CreateClient } from "../create-client";
import { LienAppel } from "../client-list";
import { StatusBadge } from "../status-badge";
import { ACTION, EnTeteFiche, LigneDetail, SuppressionFiche } from "./corps-fiche";
import { PucesEtiquettes } from "./etiquettes";
import { SyntheseCliente } from "./synthese-cliente";
import { WhatsappCliente } from "./whatsapp-cliente";
import { FideliteCliente } from "./fidelite-cliente";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Texte de la fiche modifiable sur place : la note, ou les préférences
 * (`field`, mini CRM, décision 2) ; la praticienne écrit les deux.
 * « Enregistrer » n'apparaît qu'après un changement.
 */
function NoteCliente({ id, notes, editable, field = "notes", libelle, exemple, vide }: {
  id: number;
  notes: string;
  editable: boolean;
  field?: "notes" | "preferences";
  libelle?: string;
  exemple?: string;
  vide?: string;
}) {
  const { updateClient, setError } = useApp();
  const { t } = useI18n();
  const [text, setText] = useState(notes);
  const [saving, setSaving] = useState(false);
  // Dernière valeur connue du serveur : le champ la suit tant qu'il affiche
  // encore cette valeur (non touché) ; une fois modifié sur place, une
  // sauvegarde arrivée d'ailleurs n'écrase plus la saisie en cours.
  const shown = useRef(notes);
  useEffect(() => {
    if (text === shown.current) setText(notes);
    shown.current = notes;
  }, [notes]);
  if (!editable) return <p className="whitespace-pre-line text-sm">{notes || <span className="text-muted-foreground">{vide ?? t("journee.aucune_note")}</span>}</p>;
  const save = async () => {
    setSaving(true);
    try {
      await updateClient(id, { [field]: text });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-2">
      <Textarea
        aria-label={libelle ?? t("cliente.note")}
        rows={3}
        value={text}
        maxLength={field === "preferences" ? MAX_PREFERENCES : undefined}
        placeholder={exemple ?? t("cliente.notes_exemple")}
        onInput={(e: Event) => setText((e.target as HTMLTextAreaElement).value)}
      />
      {text !== notes && <Button variant="outline" disabled={saving} onClick={save}>{saving ? t("commun.enregistrement") : t("commun.enregistrer")}</Button>}
    </div>
  );
}

/**
 * Fiche d'une cliente dans le panneau (sous-projet 4 § 6, mini CRM § 1) :
 * nom, étiquettes, ligne d'état (absente depuis, prochain rendez-vous, pas
 * encore venue) et anniversaire du jour ; « Nouveau rendez-vous » et
 * « Modifier » ; chiffres clés et habitudes ; coordonnées et anniversaire ;
 * préférences puis note, modifiables sur place (la praticienne aussi) ;
 * messages, historique des rendez-vous (chacun s'ouvre dans le panneau),
 * factures, et « Supprimer » en bas (refusé par le serveur si elle a un
 * historique). Mini CRM désactivé (interrupteur général) : la fiche d'avant
 * le chantier (ligne des visites, coordonnées, numéro de carte, note).
 */
export function FicheCliente() {
  const { selectedClient: client, selectedClientAppointments: appointments, selectedClientSummary: summary, openPanel, deleteClient } = useApp();
  const { account } = useAuth();
  const { t, tn, lang } = useI18n();
  const commands = clientCommands(account.role);
  const [booking, setBooking] = useState(false);
  const [editing, setEditing] = useState(false);
  const absenceDays = useAbsenceDays();
  const crm = useCrm();
  if (!client) return null;
  const parts = ficheCrm(crm, summary);
  const visits = client.visit_count ?? 0;
  const visitLine = client.last_visit
    ? `${tn("cliente.nb_visites", visits)} · ${t("cliente.derniere_visite", { date: formatShortDate(client.last_visit, lang) })}`
    : t("cliente.jamais_venue");
  // Ligne d'état (décision 6) : seuil du réglage des relances, 60 jours tant qu'il n'est pas lu.
  const line = parts.summary && summary ? absenceLine(summary, absenceDays) : null;
  const birthdayToday = parts.birthday && isBirthdayToday(client.birthday, todayAt());

  return (
    <div className="space-y-5 p-4">
      <div className="space-y-2">
        <EnTeteFiche titre={client.name} sousTitre={parts.visitLine ? visitLine : undefined} />
        <PucesEtiquettes tags={crmTags(client.tags, crm)} />
        {line && (
          <p className={cn("text-sm", line.kind === "absent" && line.over ? "border-l-2 border-primary pl-2 font-medium text-foreground" : "text-muted-foreground")}>
            {absenceText(line, lang)}
          </p>
        )}
        {birthdayToday && <p className="text-sm font-medium">{t("crm.anniversaire_aujourdhui")}</p>}
      </div>

      {(commands.book || commands.edit) && (
        <div className="grid grid-cols-2 gap-2">
          {commands.book && <Button className={ACTION} onClick={() => setBooking(true)}>{t("agenda.nouveau_rdv")}</Button>}
          {commands.edit && <Button variant="outline" className={ACTION} onClick={() => setEditing(true)}>{t("commun.modifier")}</Button>}
        </div>
      )}

      {parts.summary && summary && <SyntheseCliente summary={summary} />}

      <dl className="grid gap-4 border-t border-filet pt-4 @md:grid-cols-2">
        <LigneDetail libelle={t("colonne.telephone")}>
          {client.phone ? <span className="-ml-2 block"><LienAppel client={client} /></span> : EMPTY}
        </LigneDetail>
        <LigneDetail libelle={t("colonne.email")}>
          {client.email ? (
            <a href={`mailto:${client.email}`} className={cn("flex min-h-11 items-center gap-2 break-all underline decoration-filet underline-offset-4", FOCUS)}>
              <Mail className="h-4 w-4 shrink-0" aria-hidden="true" /> {client.email}
            </a>
          ) : EMPTY}
        </LigneDetail>
        {parts.birthday && <LigneDetail libelle={t("crm.anniversaire")}>{client.birthday ? birthdayLabel(client.birthday, lang) : EMPTY}</LigneDetail>}
        <LigneDetail libelle={t("crm.carte")}>{client.card ? <span className="chiffres-tabulaires">{client.card}</span> : EMPTY}</LigneDetail>
        {parts.preferences && (
          <div className="@md:col-span-2">
            <LigneDetail libelle={t("crm.preferences")}>
              <NoteCliente id={client.id} notes={client.preferences} editable={commands.editPreferences} field="preferences" libelle={t("crm.preferences")} exemple={t("crm.preferences_exemple")} vide={t("crm.aucune_preference")} />
            </LigneDetail>
          </div>
        )}
        <div className="@md:col-span-2">
          <LigneDetail libelle={t("cliente.note")}>
            <NoteCliente id={client.id} notes={client.notes} editable={commands.editNotes} />
          </LigneDetail>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">{t("cliente.depuis", { date: formatTimestampDate(client.created_at, lang) })}</p>

      {/* Fidélité (mini CRM § 2) : réception et gérante, fidélité active (synthèse `loyalty` non nulle). */}
      {canSell(account.role) && parts.loyalty && <FideliteCliente key={client.id} clientId={client.id} />}

      {/* WhatsApp (sous-projet 7) : réception et gérante, comme le serveur. */}
      {canSeeManual(account.role) && <WhatsappCliente client={client} />}

      <section className="space-y-2 border-t border-filet pt-4">
        <h3 className="etiquette text-encre-grise">{t("cliente.historique")}</h3>
        {appointments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("cliente.aucun_rdv")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-sm border border-filet bg-card">
            {appointments.map((apt) => (
              <li key={apt.id}>
                <button type="button" onClick={() => openPanel("appointment", apt.id)} className={cn("flex min-h-12 w-full items-start justify-between gap-3 p-3 text-left transition-colors duration-200 hover:bg-muted", FOCUS)}>
                  <span className="min-w-0 space-y-0.5">
                    <span className="block text-xs text-muted-foreground">{t("rdv.date_heure", { date: formatShortDate(apt.scheduled_date, lang), heure: apt.start_time.slice(0, 5) })}</span>
                    <span className="block break-words font-medium">{pickText(lang, apt.service_names, apt.service_names_en) || EMPTY}</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                      {apt.staff_name && <span className="inline-block h-2 w-2 shrink-0 rounded-sm encre-fond" style={encreVars(toInk(apt.staff_color))} aria-hidden="true" />}
                      <span className="truncate">{apt.staff_name || t("commun.non_attribue")}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={apt.status} />
                    {apt.total_price != null && <span className="chiffres whitespace-nowrap text-sm">{formatPrice(apt.total_price, lang)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Factures et avoirs (sous-projet 5 § 6.1) : gérante et réception, comme le serveur. */}
      {canSell(account.role) && <FacturesCliente clientId={client.id} />}

      {commands.remove && (
        <SuppressionFiche
          question={t("cliente.supprimer_question", { nom: client.name })}
          onDelete={() => deleteClient(client.id)}
          bloquee={appointments.length > 0 ? t("cliente.suppression_impossible") : null}
        />
      )}

      {booking && <CreateAppointment defaultClientId={client.id} onClose={() => setBooking(false)} />}
      {editing && <CreateClient client={client} onClose={() => setEditing(false)} />}
    </div>
  );
}
