import { useState } from "preact/hooks";
import { embedded } from "@clawnify/app/client";
import { Plus, ShoppingBag } from "lucide-preact";
import { useApp } from "../../context";
import { useAuth } from "../../auth-context";
import { useCalendarRange, useDoualaClock } from "../../hooks/use-journee";
import { useWide } from "../../hooks/use-wide";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { dayFigures, todayGroups, weekBounds, weekFigures, type GroupesDuJour } from "@/lib/accueil";
import { blockTone } from "@/lib/agenda";
import { pickText } from "@/lib/bilingual";
import { conflictsFrom, conflictSentence } from "@/lib/conflicts";
import { nextStep } from "@/lib/fiche-rdv";
import { formatLongDate, formatPrice, formatRange } from "@/lib/format";
import { encreVars, toInk } from "@/lib/inks";
import { appointmentCommands, canSell } from "@/lib/roles";
import { pathFor } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { Appointment, AppointmentStatus } from "../../types";
import { CreateAppointment } from "../create-appointment";
import { RetardBadge, StatusBadge } from "../status-badge";
import { ChiffreCle, EtatChargement, EtatErreur, EtatVide } from "../comptoir";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";
/** Grille des chiffres clés : suit la place réelle (rail déployé, panneau), jamais les points de rupture de l'écran. */
const CHIFFRES = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-3";
/** Groupes de la liste du jour, dans l'ordre d'affichage : ce qu'il faut traiter d'abord, les soins à encaisser, les terminés en bas. */
const GROUPES: { key: keyof GroupesDuJour; labelKey: "accueil.groupe_a_traiter" | "accueil.groupe_a_encaisser" | "accueil.groupe_a_venir" | "accueil.groupe_termines" }[] = [
  { key: "aTraiter", labelKey: "accueil.groupe_a_traiter" },
  { key: "aEncaisser", labelKey: "accueil.groupe_a_encaisser" },
  { key: "aVenir", labelKey: "accueil.groupe_a_venir" },
  { key: "termines", labelKey: "accueil.groupe_termines" },
];

/**
 * Une ligne du jour (§ 5.2) : heure, cliente, prestation, praticienne, statut,
 * et le bouton du geste suivant (même règle que la fiche, § 4.3), ou
 * « Encaisser » pour un soin terminé sans facture (sous-projet 5). Carte tant
 * que la liste est étroite, ligne dense à partir de 42 rem (@2xl) de largeur
 * réelle de la liste, panneau posé compris. Toucher la ligne ouvre la fiche.
 */
function Ligne({ apt, today, now, saving, onOpen, onStep, onCash = null }: {
  apt: Appointment;
  today: string;
  now: string;
  saving: boolean;
  onOpen: () => void;
  onStep: ((to: AppointmentStatus) => void) | null;
  onCash?: (() => void) | null;
}) {
  const { t, lang } = useI18n();
  const step = onStep ? nextStep(apt.status) : null;
  const services = apt.appointment_services?.map((s) => pickText(lang, s.service_name, s.service_name_en)).filter(Boolean).join(", ") ?? "";
  const praticienne = (
    <>
      <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-sm", apt.staff_name ? "encre-fond" : "bg-encre-grise")} style={apt.staff_name ? encreVars(toInk(apt.staff_color)) : undefined} aria-hidden="true" />
      <span className="truncate">{apt.staff_name || t("commun.non_attribue")}</span>
    </>
  );
  const etat = blockTone(apt, today, now) === "retard"
    ? <RetardBadge />
    : <StatusBadge status={apt.status} />;
  const done = apt.status === "completed" || apt.status === "no_show";
  // Une ligne « À encaisser » demande un geste : jamais estompée comme une ligne terminée (retouche 3).
  const estompe = done && !onCash;
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-sm border border-filet bg-card p-3 @2xl:flex-row @2xl:items-center @2xl:gap-4 @2xl:rounded-none @2xl:border-x-0 @2xl:border-t-0 @2xl:last:border-b-0 @2xl:bg-transparent @2xl:px-4 @2xl:py-1.5">
      <button type="button" onClick={onOpen} className={cn("flex min-w-0 flex-1 flex-col gap-1 text-left @2xl:min-h-11 @2xl:flex-row @2xl:items-center @2xl:gap-4", FOCUS, estompe && "text-muted-foreground")}>
        <span className="flex items-center justify-between gap-2 @2xl:w-28 @2xl:shrink-0">
          <span className="chiffres-tabulaires text-sm">{formatRange(apt.start_time, apt.end_time)}</span>
          <span className="@2xl:hidden">{etat}</span>
        </span>
        <span className="min-w-0 @2xl:flex-1">
          <span className={cn("block truncate", !estompe && "font-medium")}>{apt.client_name}</span>
          {services && <span className="block truncate text-sm text-muted-foreground">{services}</span>}
          {/* Liste étroite (téléphone, tablette en portrait) : la praticienne sous le nom. */}
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground @4xl:hidden">{praticienne}</span>
        </span>
        <span className="hidden min-w-0 items-center gap-1.5 text-sm text-muted-foreground @4xl:flex @4xl:w-40 @4xl:shrink-0">{praticienne}</span>
        <span className="hidden @2xl:block @2xl:w-36 @2xl:shrink-0 whitespace-nowrap">{etat}</span>
      </button>
      {onCash ? (
        <Button className="w-full @2xl:w-32 @2xl:shrink-0" onClick={onCash}>{t("caisse.encaisser")}</Button>
      ) : onStep && (step ? (
        <Button variant="outline" className="w-full @2xl:w-32 @2xl:shrink-0" disabled={saving} onClick={() => onStep(step.to)}>
          {t(step.labelKey)}
        </Button>
      ) : (
        // Place du geste gardée : les statuts restent alignés d'une ligne à l'autre.
        <span className="hidden @2xl:block @2xl:w-32 @2xl:shrink-0" aria-hidden="true" />
      ))}
    </li>
  );
}

/** Chiffres de la semaine de la gérante (§ 5.2), tirés des rendez-vous de la semaine. */
function Semaine({ day }: { day: string }) {
  const { t, lang } = useI18n();
  const week = useCalendarRange(weekBounds(day));
  const figures = weekFigures(week.appointments);
  return (
    // Sous les chiffres du jour dès 42 rem de large ; en bas au téléphone, pour garder la liste du jour à portée.
    <section className="order-last space-y-2 @2xl:order-none">
      <h2 className="etiquette text-encre-grise">{t("accueil.semaine")}</h2>
      {week.error && !week.loaded ? <EtatErreur message={week.error} onRetry={week.reload} />
        : !week.loaded ? <EtatChargement />
        : (
          <div className={CHIFFRES}>
            <ChiffreCle valeur={figures.total} libelle={t("accueil.semaine_rdv")} />
            <ChiffreCle valeur={figures.completed} libelle={t("accueil.semaine_termines")} />
            <ChiffreCle valeur={figures.noShow} libelle={t("accueil.semaine_absentes")} />
            {figures.revenue !== null && <ChiffreCle valeur={formatPrice(figures.revenue, lang)} libelle={t("accueil.semaine_ca")} />}
          </div>
        )}
    </section>
  );
}

/**
 * « Aujourd'hui » de la réception et de la gérante (sous-projet 4 § 5.2) :
 * chiffres clés du jour, compteurs de l'ancien menu (clientes, rendez-vous à
 * venir), liste du jour avec le geste suivant, et pour la gérante les chiffres
 * de la semaine. Jour et heure de Douala, indépendants du jour de l'agenda.
 */
export function Aujourdhui() {
  const { stats, navigate, openPanel, updateAppointment, setCalendarDate, setError } = useApp();
  const { account } = useAuth();
  const { t, lang } = useI18n();
  const commands = appointmentCommands(account.role);
  const wide = useWide();
  const clock = useDoualaClock();
  const range = useCalendarRange({ start: clock.day, end: clock.day });
  const groups = todayGroups(range.appointments, clock.day, clock.time);
  const figures = dayFigures(range.appointments, clock.day, clock.time);
  const [saving, setSaving] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  /** L'agenda s'ouvre sur aujourd'hui, même s'il montrait un autre jour. */
  const toAgenda = () => { setCalendarDate(clock.day); navigate(pathFor("calendar", lang)); };

  /** Geste suivant d'une ligne ; inactif pendant l'enregistrement (double appui). */
  const step = async (apt: Appointment, to: AppointmentStatus) => {
    setSaving(apt.id);
    try {
      await updateAppointment(apt.id, { status: to });
      range.reload();
    } catch (err) {
      const clashes = conflictsFrom(err);
      setError(clashes ? conflictSentence(lang, apt.staff_name ?? "", clashes) : (err as Error).message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="hors-panneau @container flex flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-serif text-3xl leading-tight">{t("cadre.aujourdhui")}</h1>
          <p className="text-sm text-muted-foreground">{formatLongDate(clock.day, lang)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={toAgenda}>{t("tableau.voir_agenda")}</Button>
          {/* Vente de comptoir, sans rendez-vous (sous-projet 5 § 4.1), au téléphone aussi. */}
          {canSell(account.role) && (
            <Button variant="outline" onClick={() => navigate(pathFor("vente", lang))}><ShoppingBag className="h-4 w-4" aria-hidden="true" /> {t("caisse.vente")}</Button>
          )}
          {/* Sur téléphone, le « + » du cadre crée le rendez-vous ; le mode intégré n'a pas de « + ». */}
          {commands.create && (wide || embedded) && (
            <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden="true" /> {t("agenda.nouveau_rdv")}</Button>
          )}
        </div>
      </header>

      <section className="space-y-3">
        <div className={CHIFFRES}>
          <ChiffreCle valeur={figures.total} libelle={t("tableau.rdv_du_jour")} onClick={toAgenda} />
          <ChiffreCle valeur={figures.waiting} libelle={t("accueil.attendues")} />
          <ChiffreCle valeur={figures.remaining} libelle={t("accueil.encore_a_venir")} />
          {figures.plannedRevenue !== null && <ChiffreCle valeur={formatPrice(figures.plannedRevenue, lang)} libelle={t("accueil.ca_prevu")} />}
          {stats.low_stock_products > 0 && (
            <ChiffreCle valeur={stats.low_stock_products} libelle={t("tableau.stock_bas")} alerte onClick={() => navigate(pathFor("products", lang))} />
          )}
        </div>
        {/* Compteurs de l'ancien menu (report de la vague 1) : toutes dates confondues. */}
        <p className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <button type="button" className={cn("min-h-11 underline decoration-filet underline-offset-4 hover:decoration-foreground", FOCUS)} onClick={() => navigate(pathFor("clients", lang))}>
            <span className="chiffres">{stats.clients}</span> <span className="etiquette text-encre-grise">{t("menu.clientes")}</span>
          </button>
          <button type="button" className={cn("min-h-11 underline decoration-filet underline-offset-4 hover:decoration-foreground", FOCUS)} onClick={() => navigate(pathFor("appointments", lang))}>
            <span className="chiffres">{stats.upcoming_appointments}</span> <span className="etiquette text-encre-grise">{t("accueil.rdv_a_venir")}</span>
          </button>
        </p>
      </section>

      {account.role === "manager" && <Semaine day={clock.day} />}

      <section className="space-y-2">
        <h2 className="etiquette text-encre-grise">{t("tableau.planning")}</h2>
        {range.error && !range.loaded ? <EtatErreur message={range.error} onRetry={range.reload} />
          : !range.loaded ? <EtatChargement />
          : (
            <>
              {range.error && <EtatErreur message={range.error} onRetry={range.reload} />}
              {figures.total === 0 ? (
                <EtatVide message={t("tableau.aucun_rdv")} action={{ libelle: t("tableau.voir_agenda"), onClick: toAgenda }} />
              ) : (
                <div className="space-y-4">
                  {GROUPES.map(({ key, labelKey }) => {
                    const list = groups[key];
                    return list.length > 0 && (
                      <div key={key} className="space-y-2">
                        <h3 className="text-sm text-muted-foreground">{t(labelKey)} <span className="chiffres-tabulaires">({list.length})</span></h3>
                        {/* La liste se met en page selon sa largeur réelle, panneau posé compris. */}
                        <ul aria-label={t(labelKey)} className="flex min-w-0 flex-col gap-2 @2xl:gap-0 @2xl:rounded-sm @2xl:border @2xl:border-filet @2xl:bg-card">
                          {list.map((apt) => (
                            <Ligne
                              key={apt.id}
                              apt={apt}
                              today={clock.day}
                              now={clock.time}
                              saving={saving === apt.id}
                              onOpen={() => openPanel("appointment", apt.id)}
                              onStep={commands.changeStatus ? (to) => step(apt, to) : null}
                              onCash={key === "aEncaisser" && canSell(account.role) ? () => navigate(pathFor("vente", lang, apt.id)) : null}
                            />
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
      </section>

      {creating && <CreateAppointment defaultDate={clock.day} onClose={() => { setCreating(false); range.reload(); }} />}
    </div>
  );
}
