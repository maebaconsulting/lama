import { useEffect, useState } from "preact/hooks";
import { useAuth, useCrm } from "../../auth-context";
import { ChevronLeft, Minus, Plus, X } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { aroundAmount, discountLabel, vatLabel } from "@/lib/caisse-texte";
import type { SaleSettings } from "@/lib/caisse-types";
import { formatPrice } from "@/lib/format";
import {
  defaultTipStaff, dropStaleReward, emptyTicket, needsClient, removeLine, setClient, setDiscount, setLineStaff, setQuantity, setTip, type PricedLine, type Ticket,
} from "@/lib/ticket";
import { cn } from "@/lib/utils";
import type { Totals } from "../../../shared/caisse";
import type { Appointment, ClientLookup, StaffLookup } from "../../types";
import { BoutonDestructif, Montant } from "../comptoir";
import { Case, SELECT } from "../reglages/elements";
import { ChoixCliente, FenetrePourboire, FenetreRecompense, FenetreRemise } from "./fenetres";
import { useSoldeFidelite } from "../../hooks/use-solde-fidelite";
import { pointsText, rewardChoices } from "@/lib/fidelite";

type Fenetre = "cliente" | "remise" | "pourboire" | "recompense" | null;

/** Ligne de total : libellé à gauche, montant en chiffres de registre à droite ; `moins` pour la remise. */
function Total({ libelle, montant, moins = false }: { libelle: string; montant: string; moins?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm text-muted-foreground">
      <dt className="min-w-0">{libelle}</dt>
      <dd className="chiffres-tabulaires text-base">{moins && "\u2013\u00a0"}<Montant valeur={montant} /></dd>
    </div>
  );
}

/**
 * Ticket de la vente (sous-projet 5 § 4.1), toujours visible à droite à
 * partir de 42 rem de large, plein écran au téléphone : cliente, lignes (− et
 * + pour un produit, praticienne d'une prestation), sous-total, remise, « dont
 * TVA », total, pourboire hors facture (puis « À payer », total et pourboire,
 * en grand à la place du total), puis « Encaisser <montant> ».
 */
export function TicketVente({ ticket, lines, totals, deposit = null, depositExceeds = false, depositOtherClient = false, counterDeposit = null, settings, appointment, clients, staff, onChange, onCharge, onBack }: {
  ticket: Ticket;
  lines: PricedLine[];
  /** Totaux, `due` déjà diminué de l'acompte en attente s'il y en a un (jamais si `depositOtherClient`). */
  totals: Totals;
  /** Acompte en attente du rendez-vous (vague 3b), déjà reçu : montré au ticket, déduit de « À payer ». */
  deposit?: { number: string; amount: number } | null;
  /** L'acompte dépasse le total à payer : le serveur refuserait la vente. */
  depositExceeds?: boolean;
  /** La cliente du ticket n'est pas celle de l'acompte (mineur 3, relecture finale) : rien n'est déduit, le serveur refuserait la vente. */
  depositOtherClient?: boolean;
  /** V1-78 : acompte qu'une vente au comptoir de produits seuls peut déduire ; la case le coche ou le décoche. */
  counterDeposit?: { id: number; number: string; amount: number } | null;
  settings: SaleSettings;
  appointment: Appointment | null;
  clients: ClientLookup[];
  staff: StaffLookup[];
  onChange: (next: Ticket) => void;
  onCharge: () => void;
  /** Téléphone : retour au catalogue. */
  onBack: () => void;
}) {
  const { t, lang } = useI18n();
  const { account } = useAuth();
  const crm = useCrm();
  const [fenetre, setFenetre] = useState<Fenetre>(null);
  const client = clients.find((c) => c.id === ticket.client_id) ?? null;
  // Fidélité (mini CRM § 2) : solde de la cliente choisie et paliers atteints ; jamais pour la praticienne,
  // et `settings.loyalty` peut manquer (encaissement fermé) : lu avec précaution. Mini CRM désactivé :
  // le serveur rend `active: false` ; l'interrupteur est aussi lu ici pour ne pas attendre la relecture.
  const loyalty = crm && settings.loyalty?.active && account.role !== "practitioner" ? settings.loyalty : null;
  const balance = useSoldeFidelite(loyalty && client ? client.id : null);
  const reward = ticket.discount?.reward_points ?? null;
  const choices = loyalty && balance !== null ? rewardChoices(balance, loyalty.tiers, totals.subtotal) : [];
  // Une récompense déjà au ticket reste retirable même si le solde ne l'atteint plus.
  const showReward = loyalty !== null && client !== null && (choices.length > 0 || reward !== null);
  // Relecture I1 : une récompense posée devient intenable quand la fidélité n'est plus active à l'écran
  // (mini CRM désactivé ou case décochée pendant la vente) ; elle est retirée d'office, la cause dite.
  const stale = dropStaleReward(ticket, { crm, loyaltyActive: Boolean(settings.loyalty?.active) && account.role !== "practitioner" });
  const [retiree, setRetiree] = useState<"crm" | "fidelite" | null>(null);
  useEffect(() => {
    if (!stale) return;
    setRetiree(stale.cause);
    onChange(stale.ticket);
  }, [stale?.cause]); // eslint-disable-line react-hooks/exhaustive-deps
  const staffName = (id: number | null) => staff.find((s) => s.id === id)?.name ?? "";
  const missingClient = needsClient(ticket);
  // Retouche C (décision du 30/09/2026) : un dû nul (remise de 100 %, prestation offerte) n'empêche plus
  // « Encaisser » ; l'étape de paiement l'émet directement, sans versement, facture à 0 F.
  const blocked = lines.length === 0 || missingClient || lines.some((l) => l.missing) || depositExceeds || depositOtherClient;
  // Avec un pourboire ou un acompte réellement déduit, le grand chiffre est « À payer » ; « Total » de la facture passe en taille normale.
  const toPay = Boolean(ticket.tip) || (deposit !== null && !depositOtherClient);
  // « Encaisser 33 350 F » : montant en chiffres de la charte (règle des chiffres de registre), mots dans l'ordre de la langue.
  const encaisser = aroundAmount(t("caisse.encaisser_montant", { montant: formatPrice(totals.due, lang) }), formatPrice(totals.due, lang));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        <Button variant="ghost" className="-ml-3 @2xl:hidden" onClick={onBack}>
          <ChevronLeft aria-hidden="true" /> {t("caisse.retour_catalogue")}
        </Button>
        {/* Cliente (§ 4.1) : choisie, changée ou retirée ; obligatoire dès qu'une prestation est au ticket. */}
        <section aria-label={t("caisse.cliente")} className="flex items-start justify-between gap-3 rounded-sm bg-muted p-4">
          <div className="min-w-0">
            <p className="break-words font-medium">{client?.name ?? t("caisse.sans_cliente")}</p>
            {appointment && ticket.appointment_id === appointment.id && (
              <p className="text-sm text-muted-foreground">{t("caisse.rdv_de", { numero: appointment.identifier, heure: appointment.start_time.slice(0, 5) })}</p>
            )}
            {missingClient && <p className="text-sm text-encre-rouge">{t("caisse.cliente_obligatoire")}</p>}
            {loyalty && client && balance !== null && <p className="text-sm text-muted-foreground">{pointsText(balance, lang)}</p>}
            {retiree && loyalty === null && reward === null && (
              <p role="status" className="text-sm text-encre-rouge">{t(retiree === "crm" ? "caisse.recompense_retiree_crm" : "caisse.recompense_retiree_fidelite")}</p>
            )}
          </div>
          {/* La praticienne encaisse la cliente de son rendez-vous, rien d'autre (le serveur refuse) : pas de « Changer » (report de la vague 3a). */}
          {account.role !== "practitioner" && (
            <Button variant="link" className="-my-2 shrink-0 px-0" onClick={() => setFenetre("cliente")}>
              {client ? t("caisse.changer") : t("caisse.choisir")}
            </Button>
          )}
        </section>

        {lines.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("caisse.ticket_vide")}</p>
        ) : (
          <ul aria-label={t("caisse.lignes")} className="divide-y divide-border border-y border-filet">
            {lines.map((l) => (
              <li key={l.index} className="space-y-2 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={l.missing ? "text-encre-rouge" : undefined}>{l.missing ? t("caisse.article_retire") : l.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {l.line.kind === "service" ? t("commun.minutes", { min: l.detail }) : l.detail}
                    </p>
                  </div>
                  <span className="chiffres whitespace-nowrap text-lg">{formatPrice(l.line_total, lang)}</span>
                </div>
                <div className="flex items-center gap-2">
                  {l.line.kind === "product" ? (
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" aria-label={t("caisse.moins", { designation: l.missing ? t("caisse.article_retire") : l.label })} onClick={() => onChange(setQuantity(ticket, l.index, l.line.quantity - 1))}><Minus aria-hidden="true" /></Button>
                      <span className="chiffres w-10 text-center text-lg" aria-label={t("caisse.quantite")}>{l.line.quantity}</span>
                      <Button variant="outline" size="icon" aria-label={t("caisse.plus", { designation: l.missing ? t("caisse.article_retire") : l.label })} disabled={l.stock !== null && l.line.quantity >= l.stock} onClick={() => onChange(setQuantity(ticket, l.index, l.line.quantity + 1, l.stock ?? undefined))}><Plus aria-hidden="true" /></Button>
                    </div>
                  ) : (
                    <select
                      aria-label={t("caisse.praticienne")}
                      className={cn(SELECT, "min-w-0 flex-1")}
                      value={l.line.staff_id ?? ""}
                      onChange={(e: Event) => onChange(setLineStaff(ticket, l.index, Number((e.currentTarget as HTMLSelectElement).value) || null))}
                    >
                      <option value="">{t("commun.non_attribue")}</option>
                      {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                  <Button variant="ghost" size="icon" className="ml-auto" aria-label={t("caisse.retirer_ligne")} onClick={() => onChange(removeLine(ticket, l.index))}><X aria-hidden="true" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <dl className="space-y-1.5">
          <Total libelle={t("caisse.sous_total")} montant={formatPrice(totals.subtotal, lang)} />
          {ticket.discount && totals.discount_amount > 0 && (
            <Total libelle={discountLabel(ticket.discount, lang)} montant={formatPrice(totals.discount_amount, lang)} moins />
          )}
          {settings.vat_active && <Total libelle={vatLabel(settings.vat_rate ?? 0, lang)} montant={formatPrice(totals.total_tva, lang)} />}
          {/* Avec un pourboire, le grand chiffre est la somme demandée (« À payer ») ; « Total » de la facture passe en taille normale (retouche 4). */}
          <div className="flex items-baseline justify-between gap-3 border-t border-foreground pt-3">
            <dt className="etiquette">{t("caisse.total")}</dt>
            <dd className={toPay ? "chiffres-tabulaires text-base" : "chiffres text-right font-serif text-4xl leading-none"}><Montant valeur={formatPrice(totals.total_ttc, lang)} /></dd>
          </div>
          {ticket.tip && (
            <Total
              libelle={staffName(ticket.tip.staff_id) ? t("caisse.pourboire_pour", { nom: staffName(ticket.tip.staff_id) }) : t("caisse.pourboire_sans_nom")}
              montant={formatPrice(ticket.tip.amount, lang)}
            />
          )}
          {deposit && !depositOtherClient && <Total libelle={t("caisse.acompte_deduit", { numero: deposit.number })} montant={formatPrice(deposit.amount, lang)} moins />}
          {toPay && (
            <div className="flex items-baseline justify-between gap-3 border-t border-foreground pt-3">
              <dt className="etiquette">{t("caisse.a_payer")}</dt>
              <dd className="chiffres text-right font-serif text-4xl leading-none"><Montant valeur={formatPrice(totals.due, lang)} /></dd>
            </div>
          )}
        </dl>

        {(settings.discounts || settings.tips || showReward) && (
          <div className="grid grid-cols-2 gap-2">
            {showReward && (
              <Button variant="outline" className="col-span-2 h-12" disabled={lines.length === 0} onClick={() => setFenetre("recompense")}>{t("fidelite.recompense")}</Button>
            )}
            {settings.discounts && <Button variant="outline" className="h-12" disabled={lines.length === 0} onClick={() => setFenetre("remise")}>{t("caisse.remise")}</Button>}
            {settings.tips && <Button variant="outline" className="h-12" disabled={lines.length === 0} onClick={() => setFenetre("pourboire")}>{t("caisse.pourboire")}</Button>}
          </div>
        )}
        {counterDeposit && (
          <Case
            id="caisse-acompte-comptoir"
            label={t("caisse.acompte_proposer", { numero: counterDeposit.number, montant: formatPrice(counterDeposit.amount, lang) })}
            checked={ticket.deposit_id === counterDeposit.id}
            onChange={(on) => onChange({ ...ticket, deposit_id: on ? counterDeposit.id : null })}
          />
        )}
        {depositExceeds && deposit && (
          <p role="status" className="rounded-sm border border-encre-rouge p-3 text-sm text-encre-rouge">{ticket.appointment_id === null
            ? t("caisse.acompte_depasse_comptoir", { montant: formatPrice(deposit.amount, lang) })
            : t("caisse.acompte_depasse", { montant: formatPrice(deposit.amount, lang) })}</p>
        )}
        {depositOtherClient && deposit && (
          <p role="status" className="rounded-sm border border-encre-rouge p-3 text-sm text-encre-rouge">{t("acompte.autre_cliente", { numero: deposit.number })}</p>
        )}
        {(lines.length > 0 || ticket.client_id !== null) && (
          <BoutonDestructif libelle={t("caisse.vider")} question={t("caisse.vider_question")} onConfirm={() => onChange(emptyTicket())} />
        )}
      </div>

      <div className="shrink-0 border-t border-filet bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6 md:pb-4">
        <Button className="h-16 w-full text-base" disabled={blocked} onClick={onCharge}>
          <span>{encaisser[0]}<span className="chiffres text-lg">{encaisser[1]}</span>{encaisser[2]}</span>
        </Button>
      </div>

      {fenetre === "cliente" && (
        <ChoixCliente clients={clients} current={ticket.client_id} onClose={() => setFenetre(null)} onDone={(id) => { onChange(setClient(ticket, id)); setFenetre(null); }} />
      )}
      {fenetre === "remise" && (
        <FenetreRemise subtotal={totals.subtotal} cap={settings.discount_cap ?? 0} current={reward !== null ? null : ticket.discount} onClose={() => setFenetre(null)} onDone={(d) => { onChange(setDiscount(ticket, d)); setFenetre(null); }} />
      )}
      {fenetre === "recompense" && showReward && (
        <FenetreRecompense
          balance={balance ?? 0}
          choices={choices}
          current={reward}
          replacesDiscount={ticket.discount !== null && reward === null}
          onClose={() => setFenetre(null)}
          onDone={(d) => { onChange(setDiscount(ticket, d)); setFenetre(null); }}
        />
      )}
      {fenetre === "pourboire" && (
        <FenetrePourboire
          staff={staff}
          current={ticket.tip}
          defaultStaff={defaultTipStaff(ticket, appointment?.staff_id ?? null)}
          onClose={() => setFenetre(null)}
          onDone={(tip) => { onChange(setTip(ticket, tip)); setFenetre(null); }}
        />
      )}
    </div>
  );
}
