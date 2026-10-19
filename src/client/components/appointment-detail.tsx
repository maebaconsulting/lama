import { Fragment, type ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useApp } from "../context";
import { useAuth } from "../auth-context";
import { MoreHorizontal, Phone, Plus, Send, Trash2 } from "lucide-preact";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/provider";
import { pickText } from "@/lib/bilingual";
import { conflictsFrom, conflictSentence } from "@/lib/conflicts";
import { draftFor, keepDraft, needsConfirmation, newestFirst, nextStep, otherStatuses, telHref } from "@/lib/fiche-rdv";
import { formatPrice, formatRange, formatShortDate, formatTimestamp } from "@/lib/format";
import { encreVars, toInk } from "@/lib/inks";
import { appointmentCommands, canChargeAppointment, canSell } from "@/lib/roles";
import type { SaleSettings } from "@/lib/caisse-types";
import { api } from "../api";
import { useLoad } from "../hooks/use-load";
import { pathFor } from "@/lib/routes";
import { statusLabel } from "@/lib/statuses";
import { supplementLabel } from "@/lib/supplements";
import { cn } from "@/lib/utils";
import type { AppointmentStatus } from "../types";
import { PayeBadge, StatusBadge } from "./status-badge";
import { AcompteRdv } from "./caisse/acompte-rdv";
import { BoutonsTicket } from "./caisse/boutons-ticket";
import { RescheduleAppointment } from "./reschedule-appointment";
import { ConfirmerSuppression } from "./confirmer-suppression";
import { EditeurSupplements } from "./supplements/editeur-rdv";

/**
 * Brouillons de note par rendez-vous, en mémoire seulement : toucher un autre
 * bloc de l'agenda ou changer d'écran démonte la fiche sans perdre la note en
 * cours. Vidé après un envoi réussi, et entièrement quand l'app se démonte.
 */
const drafts = new Map<number, string>();

/** Oublie tous les brouillons de note (verrouillage, déconnexion, veille : tablette partagée). */
export function clearNoteDrafts(): void {
  drafts.clear();
}

/** Colonnes de la rangée d'actions selon le nombre de boutons montrés (jamais d'orphelin). */
const ACTION_COLUMNS = ["hidden", "grid-cols-1", "grid-cols-2", "grid-cols-3"];
/** Boutons de la rangée : marges serrées, libellé sur deux lignes plutôt que coupé dans un panneau étroit. */
const ACTION = "h-auto min-h-11 whitespace-normal px-2 py-2 text-center leading-tight";

/** Une ligne du corps de la fiche : libellé discret au-dessus, valeur dessous. */
function Ligne({ libelle, children }: { libelle: string; children: ComponentChildren }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="etiquette text-encre-grise">{libelle}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/**
 * Fiche d'un rendez-vous dans le panneau (sous-projet 4 § 4.3) : la cliente en
 * grand, le geste suivant du statut en gros bouton cuir, « Autre statut »,
 * Appeler, Déplacer, le corps (date, praticienne, prestations, total, notes)
 * et le champ de note en bas ; Supprimer dans le menu « … ». Les commandes
 * refusées par le serveur ne sont pas montrées (la praticienne lit la fiche et
 * ajoute une note).
 */
export function AppointmentDetail() {
  const {
    selectedAppointment: apt, openPanel, updateAppointment, deleteAppointment,
    addAppointmentNote, deleteAppointmentNote, setError, navigate,
  } = useApp();
  const { account } = useAuth();
  // Encaissement par la praticienne : réglage lu pour elle seulement, relu quand la gérante le change.
  const checkout = useLoad(() => (account.role === "practitioner" ? api<SaleSettings>("GET", "/api/sales/settings").then((s) => s.practitioner_checkout) : Promise.resolve(false)), ["settings"]);
  const { t, lang } = useI18n();
  const commands = appointmentCommands(account.role);
  const [rescheduling, setRescheduling] = useState(false);
  const [showOther, setShowOther] = useState(false);
  // Décision 5 (passe V 1.0) : « Supprimer la note » demande confirmation ; le bouton reste grisé tant qu'elle est ouverte.
  const [noteASupprimer, setNoteASupprimer] = useState<{ id: number; content: string } | null>(null);
  // Statut qui attend sa confirmation (Annulé, Absente) et suppression demandée depuis « … ».
  const [pending, setPending] = useState<AppointmentStatus | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [supplements, setSupplements] = useState(false);
  const statusGroup = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const lastPending = useRef<AppointmentStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [, redraw] = useState(0);

  // Confirmation d'un statut : le focus va sur « Revenir » (choix sûr) ; au retour sans rien
  // changer, il revient sur le statut qui l'avait demandée.
  useEffect(() => {
    const group = statusGroup.current;
    if (pending) group?.querySelector<HTMLButtonElement>("[data-revenir]")?.focus();
    else if (lastPending.current) group?.querySelector<HTMLButtonElement>(`[data-statut="${lastPending.current}"]`)?.focus();
    lastPending.current = pending;
  }, [pending]);

  if (!apt) return null;
  const step = nextStep(apt.status);
  const call = telHref(apt.client_phone);
  const notes = newestFirst(apt.appointment_notes);
  const services = apt.appointment_services ?? [];
  const noteText = draftFor(drafts, apt.id);
  // Encaisser (sous-projet 5 § 4.1) : soin en cours ou terminé, pas encore payé ; payé, il ne se supprime plus (§ 3.4).
  // La praticienne, son propre rendez-vous, si la gérante a activé l'encaissement par la praticienne (vague 3).
  const cashable = canChargeAppointment(account, apt, checkout.data === true) && !apt.paid && (apt.status === "in_progress" || apt.status === "completed");
  // Correctif final (point 1) : la praticienne ne lit pas les acomptes ; sans « Encaisser » (acompte en
  // attente), une phrase le lui dit plutôt que de la laisser croire que le rendez-vous se règle plein tarif.
  // Retouche de fin de vague 3b : seulement si « Encaisser » lui aurait été proposé sans l'acompte
  // (réglage activé, son rendez-vous, statut permis) ; sinon la phrase ne dit rien qui vaille (un
  // rendez-vous qu'elle n'aurait de toute façon pas pu encaisser).
  const depositHeld = account.role === "practitioner" && Boolean(apt.deposit_held) && !apt.paid && (apt.status === "in_progress" || apt.status === "completed") && canChargeAppointment(account, { ...apt, deposit_held: 0 }, checkout.data === true);

  /** Met à jour le brouillon de ce rendez-vous (gardé hors du composant) et redessine la fiche. */
  const setNoteText = (text: string) => {
    keepDraft(drafts, apt.id, text);
    redraw((n) => n + 1);
  };

  /** Change le statut ; un rendez-vous rétabli peut être refusé si la praticienne n'est plus libre. */
  const changeStatus = async (status: AppointmentStatus) => {
    setSaving(true);
    try {
      await updateAppointment(apt.id, { status });
      lastPending.current = null;
      setPending(null);
      setShowOther(false);
    } catch (err) {
      const clashes = conflictsFrom(err);
      setError(clashes ? conflictSentence(lang, apt.staff_name ?? "", clashes) : (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddNote = async (e: Event) => {
    e.preventDefault();
    const text = noteText;
    if (sending || !text.trim()) return;
    setSending(true);
    try {
      await addAppointmentNote(apt.id, text.trim());
      // Vidé seulement si rien n'a été ajouté au champ pendant l'envoi.
      if (draftFor(drafts, apt.id) === text) setNoteText("");
    } catch (err) {
      // La note reste dans le champ : rien n'est perdu si le réseau coupe.
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <header className="space-y-2">
        {/* 44 px de haut avec ou sans « … » : l'en-tête ne bouge pas d'un rôle à l'autre. */}
        <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2">
          <span className="chiffres whitespace-nowrap text-sm text-muted-foreground">{apt.identifier}</span>
          <StatusBadge status={apt.status} />
          {Boolean(apt.en_ligne) && <span className="etiquette text-encre-grise">{t("rdv.en_ligne")}</span>}
          {Boolean(apt.paid) && <PayeBadge />}
          {/* Correctif final (point 1) : une facture émise, même entièrement reprise par un avoir, masque toujours « Supprimer ». */}
          {commands.remove && !apt.invoiced && (
            // Menu ancré au bouton : rien ne s'insère dans la fiche, le geste principal ne bouge pas.
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button ref={moreButton} variant="ghost" size="icon" className="ml-auto" aria-label={t("rdv.plus_actions")}>
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuItem className="min-h-11 text-encre-rouge focus:text-encre-rouge" onSelect={() => setConfirmDelete(true)}>
                  <Trash2 aria-hidden="true" /> {t("rdv.supprimer_rdv")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <h3 className="min-w-0">
          <button
            type="button"
            className="flex min-h-11 max-w-full items-center break-words text-left font-serif text-3xl leading-tight hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => openPanel("client", apt.client_id)}
          >
            {apt.client_name}
          </button>
        </h3>
      </header>

      <div className="space-y-2">
        {commands.changeStatus && step && (
          <Button size="lg" className="w-full" disabled={saving} onClick={() => changeStatus(step.to)}>
            {t(step.labelKey)}
          </Button>
        )}
        {cashable && (
          <Button size="lg" variant={commands.changeStatus && step ? "outline" : "default"} className="w-full" onClick={() => navigate(pathFor("vente", lang, apt.id))}>
            {t("caisse.encaisser")}
          </Button>
        )}
        {!cashable && depositHeld && <p className="text-sm text-encre-grise">{t("rdv.acompte_praticienne")}</p>}
        {/* Une seule rangée, sans bouton orphelin : trois, deux ou un seul (Appeler, pour la praticienne). */}
        <div className={cn("grid gap-2", ACTION_COLUMNS[[commands.changeStatus, Boolean(call), commands.move].filter(Boolean).length])}>
          {commands.changeStatus && (
            <Button variant="outline" className={ACTION} aria-expanded={showOther} aria-controls="rdv-autres-statuts" onClick={() => { setShowOther(!showOther); setPending(null); }}>
              {t("rdv.autre_statut")}
            </Button>
          )}
          {call && (
            <a href={call} className={cn(buttonVariants({ variant: "outline" }), ACTION)}>
              <Phone className="h-4 w-4" aria-hidden="true" /> {t("rdv.appeler")}
            </a>
          )}
          {commands.move && (
            <Button variant="outline" className={ACTION} onClick={() => setRescheduling(true)}>{t("rdv.deplacer")}</Button>
          )}
        </div>
        {commands.changeStatus && showOther && (
          <div ref={statusGroup} id="rdv-autres-statuts" role="group" aria-label={t("rdv.autre_statut")} className="rounded-sm border border-filet bg-card p-3">
            {pending ? (
              // La confirmation remplace les choix : une question, « Revenir » et le geste nommé.
              <div
                role="group"
                aria-label={t("rdv.confirmer_statut", { statut: statusLabel(lang, pending) })}
                className="space-y-3"
                onKeyDown={(e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); setPending(null); } }}
              >
                <p className="text-sm text-encre-rouge">{t("rdv.confirmer_statut", { statut: statusLabel(lang, pending) })}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button data-revenir="" variant="outline" className={ACTION} onClick={() => setPending(null)}>{t("commun.revenir")}</Button>
                  <Button variant="destructive" className={ACTION} disabled={saving} onClick={() => changeStatus(pending)}>
                    {t("rdv.passer_a", { statut: statusLabel(lang, pending) })}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {otherStatuses(apt.status).map((status) => (
                  <Button
                    key={status}
                    data-statut={status}
                    variant={needsConfirmation(status) ? "trait-rouge" : "outline"}
                    className={ACTION}
                    disabled={saving}
                    onClick={() => (needsConfirmation(status) ? setPending(status) : changeStatus(status))}
                  >
                    {statusLabel(lang, status)}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Acomptes (vague 3b) : gérante et réception seulement, la praticienne ne lit rien de la caisse (décision 18 de la vague 3a). */}
      {canSell(account.role) && <AcompteRdv key={`acompte-${apt.id}`} apt={apt} />}

      <dl className="grid gap-4 border-t border-filet pt-4 @md:grid-cols-2">
        <Ligne libelle={t("rdv.date_et_heure")}>
          {t("rdv.date_plage", { date: formatShortDate(apt.scheduled_date, lang), plage: formatRange(apt.start_time, apt.end_time) })}
        </Ligne>
        <Ligne libelle={t("rdv.praticienne")}>
          <span className="flex min-w-0 items-center gap-1.5">
            {apt.staff_name && <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm encre-fond" style={encreVars(toInk(apt.staff_color))} aria-hidden="true" />}
            <span className="truncate">{apt.staff_name || t("commun.non_attribue")}</span>
          </span>
        </Ligne>
        <div className="@md:col-span-2">
          <Ligne libelle={t("menu.prestations")}>
            {services.length === 0 ? (
              <span className="text-muted-foreground">{t("rdv.aucune_prestation")}</span>
            ) : (
              <ul className="divide-y divide-border">
                {services.map((svc) => (
                  <Fragment key={svc.id}>
                    <li className="flex items-baseline justify-between gap-3 py-1.5">
                      <span className="min-w-0">{pickText(lang, svc.service_name, svc.service_name_en) || t("rdv.prestation_numero", { id: svc.service_id })}</span>
                      <span className="flex shrink-0 items-baseline gap-2">
                        <span className="text-xs text-muted-foreground">{t("commun.minutes", { min: svc.duration })}</span>
                        {svc.price != null && <span className="chiffres whitespace-nowrap font-medium">{formatPrice(svc.price, lang)}</span>}
                      </span>
                    </li>
                    {(svc.supplements ?? []).map((s) => (
                      <li key={`s${s.id}`} className="flex items-baseline justify-between gap-3 py-1 pl-4 text-sm">
                        <span className="flex min-w-0 items-baseline gap-1.5">
                          <Plus className="h-3 w-3 shrink-0 text-encre-grise" aria-hidden="true" />
                          <span className="min-w-0 break-words">{supplementLabel(s, lang)}{s.quantity > 1 && ` × ${s.quantity}`}</span>
                        </span>
                        <span className="flex shrink-0 items-baseline gap-2">
                          {s.minutes > 0 && <span className="text-xs text-muted-foreground">{t("commun.minutes", { min: s.minutes })}</span>}
                          {s.price != null && <span className="chiffres whitespace-nowrap">{formatPrice(s.price * s.quantity, lang)}</span>}
                        </span>
                      </li>
                    ))}
                  </Fragment>
                ))}
              </ul>
            )}
            {commands.move && !apt.paid && services.length > 0 && (
              <Button variant="outline" className="mt-2" onClick={() => setSupplements(true)}>{t("rdv.modifier_supplements")}</Button>
            )}
          </Ligne>
        </div>
        {apt.invoice_number && apt.invoice_total != null ? (
          <>
            {/* Retouche R2 vague 2 : la fiche payée montre d'abord le total facturé (remise, TVA, produits compris), pas le prix prévu. */}
            <Ligne libelle={t("rdv.total_facture")}>
              <span className="chiffres whitespace-nowrap text-lg font-semibold">{formatPrice(apt.invoice_total, lang)}</span>
              {apt.total_price != null && (
                <p className="text-xs text-encre-grise">{t("rdv.prestations_prevues", { montant: formatPrice(apt.total_price, lang) })}</p>
              )}
            </Ligne>
            <Ligne libelle={t("caisse.facture")}>
              {/* Vague 3 : le numéro ouvre la facture dans le panneau (avoirs, détail), pour qui la voit. */}
              {apt.invoice_id && canSell(account.role) ? (
                <button type="button" onClick={() => openPanel("invoice", apt.invoice_id!)} className="chiffres -ml-2 inline-flex min-h-11 items-center whitespace-nowrap rounded-sm px-2 underline decoration-filet underline-offset-4 transition-colors duration-200 hover:bg-muted focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  {apt.invoice_number}
                </button>
              ) : <span className="chiffres whitespace-nowrap">{apt.invoice_number}</span>}
            </Ligne>
            {/* Ticket de la facture (§ 5.1) : gérante et réception, les seules à qui le serveur rend la facture. Pleine largeur (retouche 3). Groupe dt/dd (enfant valide du dl, correctif final) : le libellé n'est pas montré à l'écran (déjà dit par « Facture » juste au-dessus), seulement aux technologies d'assistance. */}
            {apt.invoice_id && canSell(account.role) && (
              <div className="@md:col-span-2">
                <dt className="sr-only">{t("caisse.ticket_pdf")}</dt>
                <dd>
                  <BoutonsTicket invoice={{ id: apt.invoice_id, number: apt.invoice_number }} direct={{ kind: "invoice", id: apt.invoice_id }} />
                </dd>
              </div>
            )}
          </>
        ) : (
          <>
            {apt.invoice_number && (
              <Ligne libelle={t("caisse.facture")}>
                <span className="chiffres whitespace-nowrap">{apt.invoice_number}</span>
                {/* Ticket de la facture (§ 5.1) : gérante et réception, les seules à qui le serveur rend la facture. */}
                {apt.invoice_id && canSell(account.role) && <BoutonsTicket invoice={{ id: apt.invoice_id, number: apt.invoice_number }} direct={{ kind: "invoice", id: apt.invoice_id }} className="mt-2" />}
              </Ligne>
            )}
            {apt.total_price != null && (
              <Ligne libelle={t("rdv.total")}>
                <span className="chiffres whitespace-nowrap text-lg font-semibold">{formatPrice(apt.total_price, lang)}</span>
              </Ligne>
            )}
          </>
        )}
        <div className="@md:col-span-2">
          <Ligne libelle={t("rdv.notes")}>
            {!apt.notes && notes.length === 0 && <span className="text-muted-foreground">{t("rdv.aucune_note")}</span>}
            <ul className="space-y-2">
              {notes.map((note) => (
                <li key={note.id} className="rounded-sm border border-filet p-2.5">
                  <p className="break-words">{note.content}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{formatTimestamp(note.created_at, lang)}</span>
                    {commands.deleteNote && (
                      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" aria-label={t("rdv.supprimer_note")} disabled={noteASupprimer !== null} onClick={() => setNoteASupprimer({ id: note.id, content: note.content })}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
              {apt.notes && (
                <li className="rounded-sm bg-muted p-2.5">
                  <p className="etiquette text-encre-grise">{t("rdv.note_reservation")}</p>
                  <p className="break-words">{apt.notes}</p>
                </li>
              )}
            </ul>
          </Ligne>
        </div>
      </dl>

      {commands.addNote && (
        <form className="flex gap-2 border-t border-filet pt-4" onSubmit={handleAddNote}>
          <Input
            data-brouillon=""
            aria-label={t("rdv.ajouter_note")}
            placeholder={t("rdv.ajouter_note")}
            value={noteText}
            onInput={(e: Event) => setNoteText((e.target as HTMLInputElement).value)}
          />
          <Button type="submit" variant="outline" size="icon" disabled={sending || !noteText.trim()} aria-label={t("rdv.envoyer_note")}>
            <Send className="h-4 w-4" aria-hidden="true" />
          </Button>
        </form>
      )}
      {supplements && <EditeurSupplements apt={apt} onClose={() => setSupplements(false)} />}
      {rescheduling && <RescheduleAppointment key={`deplacer-${apt.id}`} appointment={apt} onClose={() => setRescheduling(false)} />}
      {commands.deleteNote && noteASupprimer && (
        <ConfirmerSuppression
          titre={t("rdv.supprimer_note_question")}
          detail={noteASupprimer.content}
          action={t("rdv.supprimer_note")}
          onConfirm={() => deleteAppointmentNote(noteASupprimer.id).catch((err: Error) => setError(err.message))}
          onClose={() => setNoteASupprimer(null)}
        />
      )}
      {commands.remove && confirmDelete && (
        <Dialog open onOpenChange={(open: boolean) => { if (!open) setConfirmDelete(false); }}>
          {/* Ouverte depuis le menu (disparu) : à la fermeture, le focus revient sur « … ». */}
          <DialogContent compact role="alertdialog" onCloseAutoFocus={(event: Event) => { event.preventDefault(); moreButton.current?.focus(); }}>
            <DialogHeader>
              <DialogTitle>{t("rdv.supprimer_question")}</DialogTitle>
              <DialogDescription>
                {t("rdv.supprimer_detail", {
                  cliente: apt.client_name ?? "",
                  date: t("rdv.date_plage", { date: formatShortDate(apt.scheduled_date, lang), plage: formatRange(apt.start_time, apt.end_time) }),
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>{t("commun.revenir")}</Button>
              <Button variant="destructive" onClick={() => { setConfirmDelete(false); deleteAppointment(apt.id).catch((err: Error) => setError(err.message)); }}>
                {t("rdv.supprimer_rdv")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
