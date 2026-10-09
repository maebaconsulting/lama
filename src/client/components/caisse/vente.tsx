import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../../api";
import { useAuth } from "../../auth-context";
import { useApp } from "../../context";
import { useDoualaClock } from "../../hooks/use-journee";
import { useLoad } from "../../hooks/use-load";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { chosenCounterDeposit, counterOffer, depositShare, heldDeposit, syncCounterDeposit } from "@/lib/acompte";
import type { Deposit, Invoice, SaleSettings } from "@/lib/caisse-types";
import { formatLongDate, formatPrice } from "@/lib/format";
import { canChargeAppointment, canSell, homePath } from "@/lib/roles";
import { pathFor } from "@/lib/routes";
import { addItem, emptyTicket, fromAppointment, itemCount, keepIssued, keepPending, keepTicket, keptIssued, keptPending, keptTicket, openFor, priceTicket, type Ticket } from "@/lib/ticket";
import { cn } from "@/lib/utils";
import type { Appointment, Product } from "../../types";
import { EtatChargement, EtatErreur, Montant } from "../comptoir";
import { Catalogue } from "./catalogue";
import { Emise } from "./emise";
import { Paiement } from "./paiement";
import { TicketVente } from "./ticket-vente";

type Etape = "ticket" | "paiement" | "emise";

/**
 * Écran « Vente » (sous-projet 5 § 4.1), une page et non un panneau : à partir
 * de 42 rem de large réelle, catalogue à gauche et ticket à droite ; plus
 * étroit (téléphone), catalogue plein écran et barre « Ticket · N articles ·
 * montant » en bas, qui ouvre le ticket. `appointmentId` (adresse
 * `/vente/12`) : encaissement d'un rendez-vous, ticket pré-rempli. Le ticket
 * est gardé sur l'appareil jusqu'à l'émission ou « Vider le ticket ».
 */
export function Vente({ appointmentId }: { appointmentId: string | null }) {
  const { services, staffLookup, clientLookup, navigate, reloadServices } = useApp();
  // Ticket, envoi en attente et facture gardés rattachés au compte (relecture 2 de la tâche 6, § 7) :
  // sur un poste partagé, une autre personne connectée ensuite part d'un écran vierge.
  const { account } = useAuth();
  const { t, tn, lang } = useI18n();
  const clock = useDoualaClock();
  const aptId = appointmentId && /^[1-9]\d{0,9}$/.test(appointmentId) ? Number(appointmentId) : null;
  const settings = useLoad(() => api<SaleSettings>("GET", "/api/sales/settings"), ["settings"]);
  const products = useLoad(() => api<{ products: Product[] }>("GET", "/api/products?limit=1000"), ["products"]);
  const appointment = useLoad(
    () => (aptId === null ? Promise.resolve(null) : api<{ appointment: Appointment }>("GET", `/api/appointments/${aptId}`).then((r) => r.appointment)),
    ["appointments"],
  );
  const [ticket, setTicket] = useState<Ticket>(() => keptTicket(account.id));
  // Une facture reçue pendant que l'écran est quitté (spec § 7, relecture de la tâche 6) est
  // retrouvée au montage, seulement si elle vient de cette vente précise (relecture 2, même
  // compte et même rendez-vous, `null` au comptoir) : sans cela, la personne verrait un ticket
  // vide et pourrait rejouer la vente, ou lirait la facture d'une autre.
  const [etape, setEtape] = useState<Etape>(() => (keptIssued(account.id, aptId) ? "emise" : "ticket"));
  const [vue, setVue] = useState<"catalogue" | "ticket">("catalogue");
  const [issued, setIssued] = useState<Invoice | null>(() => keptIssued(account.id, aptId));
  // Issue d'un envoi encore inconnue (spec § 7, reste de la tâche 5) : gardée avec le ticket, elle
  // survit à un aller-retour sur l'écran et gèle le ticket tant qu'une facture ou un refus n'est pas là.
  const [pending, setPending] = useState(() => keptPending(account.id));
  // Refus 409 « total » (mineur 2 de la relecture finale) : montant dû renvoyé par le serveur, affiché
  // tout de suite ; effacé dès que le ticket change, pour ne jamais montrer un montant périmé.
  const [staleDue, setStaleDue] = useState<number | null>(null);

  /** Toute modification passe par ici : le ticket reste gardé si l'on quitte l'écran. */
  const update = (next: Ticket) => { keepTicket(next, account.id); setTicket(next); setStaleDue(null); };
  const updatePending = (p: boolean) => { keepPending(p, account.id); setPending(p); };

  // Acompte en attente du rendez-vous (vague 3b) : gérante et réception, qui seules lisent les acomptes ;
  // déduit du montant à payer comme le serveur le fera (la praticienne n'encaisse pas un rendez-vous qui en a un).
  const deposits = useLoad(
    () => (aptId === null || !canSell(account.role) ? Promise.resolve([] as Deposit[]) : api<{ deposits: Deposit[] }>("GET", `/api/deposits?appointment_id=${aptId}`).then((r) => r.deposits)),
    ["invoices", "appointments"],
  );
  // V1-78 : vente au comptoir de la gérante ou de la réception, cliente choisie : acomptes que la vente peut déduire.
  const counterClient = aptId === null && canSell(account.role) && ticket.appointment_id === null ? ticket.client_id : null;
  const counter = useLoad(
    () => (counterClient === null ? Promise.resolve([] as Deposit[]) : api<{ deposits: Deposit[] }>("GET", `/api/deposits?client_id=${counterClient}`).then((r) => r.deposits)),
    ["invoices", "appointments"],
  );
  // Rechargée quand la cliente change (le premier chargement est celui de `useLoad`, jamais deux fois).
  const counterFor = useRef(counterClient);
  useEffect(() => {
    if (counterFor.current === counterClient) return;
    counterFor.current = counterClient;
    void counter.reload();
  }, [counterClient]); // eslint-disable-line react-hooks/exhaustive-deps
  // Proposition alignée sur le ticket, jamais pendant le paiement ni sur une vente émise : le montant ne bouge plus.
  // `syncCounterDeposit` rend le même objet une fois aligné : la mise à jour ne se relance pas en boucle.
  useEffect(() => {
    if (etape !== "ticket" || pending || issued) return;
    const next = syncCounterDeposit(ticket, account.role, counter.data);
    if (next !== ticket) update(next);
  }, [ticket, counter.data, etape, pending, issued]); // eslint-disable-line react-hooks/exhaustive-deps
  const apt = appointment.data ?? null;
  const unpaid = apt !== null && apt.id === aptId && !apt.paid && apt.status !== "cancelled";
  // Correctif (relecture du correctif final, retouches vague 3a) : réglage désactivé, le serveur ne
  // rend que `practitioner_checkout` (§ 4.5) ; bloquer dès ce seul indicateur, sans attendre le
  // rendez-vous, évite d'afficher Paiement sur des réglages réduits (`settings.methods` absent,
  // l'écran plantait). Réglage activé : encore faut-il, une fois le rendez-vous chargé, que ce soit
  // le sien, en cours ou terminé (décision 16).
  const blocked = account.role === "practitioner" && settings.data !== null
    && (!settings.data.practitioner_checkout || (apt !== null && !canChargeAppointment(account, apt, settings.data.practitioner_checkout)));
  // Même retouche : un rendez-vous introuvable (fiche supprimée) renvoie aussi à « Ma journée ».
  const notFound = account.role === "practitioner" && appointment.error !== null;
  // Et tant qu'il n'est ni chargé ni refusé, rien n'est montré (ni ticket pré-rempli, ni Paiement sur
  // une issue encore en attente, `pending` compris) : l'état de chargement, le temps que la réponse arrive.
  const waiting = account.role === "practitioner" && !blocked && !notFound && apt === null;
  // I1 de la relecture finale : ne pré-remplir qu'à l'étape du ticket, sans facture ni envoi en
  // cours, pour que le ticket vidé par `onIssued` ne soit jamais repris par le rendez-vous qui
  // vient d'être encaissé (le rendez-vous reste vu comme impayé le temps que le signal temps réel
  // rapporte la vraie donnée) : « Nouvelle vente » et un autre rendez-vous ouvrent un ticket vide.
  const ouverture = apt && unpaid && etape === "ticket" && !issued && !pending && !blocked ? openFor(ticket, apt.id) : "keep";
  // Encaisser un rendez-vous (§ 4.1) : prestations, cliente et praticienne reprises, si aucun autre ticket n'est en cours.
  useEffect(() => {
    if (apt && ouverture === "prefill") update(fromAppointment(apt, ticket.request_id));
  }, [apt?.id, ouverture]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (blocked || notFound) navigate(homePath(account.role));
  }, [blocked, notFound]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mineur 2 (relecture finale) : attendus comme les réglages, jamais le prix plein avant de
  // savoir s'il y a un acompte à déduire (rendez-vous de gérante ou de réception seulement).
  const depositsExpected = aptId !== null && canSell(account.role);
  if (settings.error && !settings.data) return <div className="p-4 sm:p-6"><EtatErreur message={settings.error} onRetry={settings.reload} /></div>;
  if (!settings.data) return <EtatChargement />;
  if (blocked || notFound) return <EtatChargement />;
  if (depositsExpected && deposits.error && !deposits.data) return <div className="p-4 sm:p-6"><EtatErreur message={deposits.error} onRetry={deposits.reload} /></div>;
  if (depositsExpected && deposits.data === null) return <EtatChargement />;
  const vat = { active: settings.data.vat_active ?? false, rate: settings.data.vat_rate ?? 0 };
  const priced = priceTicket(ticket, { services, products: products.data?.products ?? [] }, vat, lang);
  const held = ticket.appointment_id !== null && ticket.appointment_id === aptId ? heldDeposit(deposits.data ?? []) : chosenCounterDeposit(ticket, counter.data);
  const share = depositShare(priced.totals, ticket.client_id, held);
  const offer = counterOffer(ticket, account.role, counter.data);
  const clientName = clientLookup.find((c) => c.id === ticket.client_id)?.name ?? null;

  if (etape === "emise" && issued) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Emise
          invoice={issued}
          allowNew={canSell(account.role)}
          onNew={() => { keepIssued(null, account.id); setIssued(null); setEtape("ticket"); setVue("catalogue"); navigate(pathFor("vente", lang)); }}
          onHome={() => { keepIssued(null, account.id); navigate(pathFor("dashboard", lang)); }}
        />
      </div>
    );
  }
  if (waiting) return <EtatChargement />;

  return (
    <div className="@container flex min-h-0 min-w-0 flex-1 flex-col">
      {etape === "paiement" || pending ? (
        <Paiement
          ticket={ticket}
          totals={staleDue !== null ? { ...share.totals, due: staleDue } : share.totals}
          settings={settings.data}
          clientName={clientName}
          onBack={() => setEtape("ticket")}
          onStale={(due) => { void products.reload(); void reloadServices(); if (due !== undefined) setStaleDue(due); }}
          onIssued={(invoice) => { update(emptyTicket()); updatePending(false); keepIssued(invoice, account.id); setIssued(invoice); setEtape("emise"); }}
          onPending={updatePending}
          resume={pending}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col @2xl:flex-row">
          <section aria-label={t("caisse.catalogue")} className={cn("min-h-0 min-w-0 flex-1 flex-col", vue === "ticket" ? "hidden @2xl:flex" : "flex")}>
            <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
              <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h1 className="font-serif text-3xl leading-tight">{t("caisse.vente")}</h1>
                <p className="text-sm text-muted-foreground">{t("caisse.date_heure", { date: formatLongDate(clock.day, lang), heure: clock.time })}</p>
              </header>
              {aptId !== null && apt && apt.id === aptId && !unpaid && (
                <p role="status" className="rounded-sm border border-filet p-3 text-sm">
                  {apt.status === "cancelled" ? t("caisse.rdv_annule") : apt.invoice_number ? t("caisse.rdv_deja_paye", { numero: apt.invoice_number }) : t("caisse.rdv_deja_paye_court")}
                </p>
              )}
              {ouverture === "conflict" && apt && (
                <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-filet p-3 text-sm">
                  <p className="min-w-0">{t("caisse.autre_ticket", { cliente: apt.client_name ?? "" })}</p>
                  <Button variant="outline" onClick={() => update(fromAppointment(apt))}>{t("caisse.remplacer_ticket")}</Button>
                </div>
              )}
              {products.error && <EtatErreur message={products.error} onRetry={products.reload} />}
              <Catalogue
                services={services}
                products={products.data?.products ?? null}
                ticket={ticket}
                onAdd={(item) => update(addItem(ticket, { ...item, staff_id: ticket.appointment_id !== null ? apt?.staff_id ?? null : null }))}
              />
            </div>
            {/* Téléphone : la barre « Ticket » en bas du catalogue ouvre le ticket (§ 4.1). */}
            <div className="shrink-0 border-t border-filet bg-card p-3 @2xl:hidden">
              <button
                type="button"
                onClick={() => setVue("ticket")}
                className="flex min-h-14 w-full items-center justify-between gap-3 rounded-sm bg-primary px-4 text-primary-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="text-sm font-medium tracking-[0.04em]">{tn("caisse.barre_ticket", itemCount(ticket))}</span>
                <span className="chiffres text-xl"><Montant valeur={formatPrice(share.totals.due, lang)} /></span>
              </button>
            </div>
          </section>
          <aside aria-label={t("caisse.ticket")} className={cn("min-h-0 flex-col bg-card @2xl:w-[22rem] @2xl:shrink-0 @2xl:border-l @2xl:border-filet @5xl:w-[25rem]", vue === "ticket" ? "flex flex-1 @2xl:flex-none" : "hidden @2xl:flex")}>
            <TicketVente
              ticket={ticket}
              lines={priced.lines}
              totals={share.totals}
              deposit={share.deposit}
              depositExceeds={share.exceeds}
              depositOtherClient={share.otherClient}
              counterDeposit={offer ? { id: offer.id, number: offer.number, amount: offer.amount } : null}
              settings={settings.data}
              appointment={apt && ticket.appointment_id === apt.id ? apt : null}
              clients={clientLookup}
              staff={staffLookup}
              onChange={update}
              onCharge={() => setEtape("paiement")}
              onBack={() => setVue("catalogue")}
            />
          </aside>
        </div>
      )}
    </div>
  );
}
