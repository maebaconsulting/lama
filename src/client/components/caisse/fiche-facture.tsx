import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Plus } from "lucide-preact";
import { api } from "../../api";
import { useAuth } from "../../auth-context";
import { useApp } from "../../context";
import { useLoad } from "../../hooks/use-load";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { canCredit } from "@/lib/avoir";
import { pickText } from "@/lib/bilingual";
import { aroundAmount, invoiceDiscountLabel, methodLabel, vatLabel } from "@/lib/caisse-texte";
import type { Invoice, SaleSettings } from "@/lib/caisse-types";
import { formatInstant, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { orderedLines } from "../../../shared/supplements";
import { EtatChargement, EtatErreur, Montant } from "../comptoir";
import { ACTION, EnTeteFiche, LigneDetail } from "../fiches/corps-fiche";
import { BoutonsTicket } from "./boutons-ticket";
import { EnvoiWhatsapp } from "./envoi-whatsapp";
import { FormulaireAvoir } from "./formulaire-avoir";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Une rangée de montant : libellé à gauche, montant en chiffres de la charte à droite. */
function Rangee({ libelle, montant, fort = false }: { libelle: ComponentChildren; montant: string; fort?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", fort ? "text-base font-medium" : "text-sm text-muted-foreground")}>
      <dt className="min-w-0">{libelle}</dt>
      <dd className={cn("chiffres-tabulaires whitespace-nowrap", fort && "font-serif text-2xl")}><Montant valeur={montant} /></dd>
    </div>
  );
}

/**
 * Fiche d'une facture ou d'un avoir dans le panneau (sous-projet 5 § 6.1) :
 * numéro, date, cliente, personne qui a encaissé ou établi, lignes (et ce
 * que les avoirs en ont repris), totaux, versements ou remboursements,
 * pourboire, avoirs émis ; « Imprimer » et « Télécharger » le ticket ;
 * « Émettre un avoir » pour la gérante, et la réception si la gérante
 * l'autorise, tant que la facture n'est pas entièrement reprise. Un avoir
 * émis s'ouvre à la place, prêt à imprimer.
 */
export function FicheFacture({ id }: { id: number }) {
  const { account } = useAuth();
  const { openPanel } = useApp();
  const { t, tn, lang } = useI18n();
  const loaded = useLoad(() => api<{ invoice: Invoice }>("GET", `/api/invoices/${id}`).then((r) => r.invoice), ["invoices"]);
  const settings = useLoad(() => api<SaleSettings>("GET", "/api/sales/settings"), ["settings"]);
  const [crediting, setCrediting] = useState(false);

  if (loaded.error && !loaded.data) return <div className="p-4"><EtatErreur message={loaded.error} onRetry={loaded.reload} /></div>;
  const inv = loaded.data;
  if (!inv) return <EtatChargement />;
  const note = inv.kind === "credit_note";
  const allowed = !note && !inv.cancelled && canCredit(account.role, settings.data);
  const discount = inv.discount_amount > 0 ? invoiceDiscountLabel(inv.discount_kind, inv.discount_value, inv.discount_reason, lang) : null;
  // Correctif final (point 2) : alignée sur le ticket (server/caisse/ticket.ts) : l'argent donné ne suffit pas
  // sans la monnaie rendue (toujours 0 sur un avoir, le filtre n'affiche donc la ligne que pour une facture).
  const change = inv.payments.reduce((sum, p) => sum + p.change_given, 0);
  // Retouche P2 (critique du 1er octobre 2026) : le montant sorti de la phrase traduite, composé en
  // chiffres de la charte comme les autres montants de la fiche (`encaisser` dans ticket-vente.tsx).
  const reprise = aroundAmount(t("facture.reprise_partielle", { montant: formatPrice(inv.credited_total, lang) }), formatPrice(inv.credited_total, lang));

  return (
    <div className="space-y-5 p-4">
      <EnTeteFiche
        titre={inv.number}
        sousTitre={`${t(note ? "facture.nature.credit_note" : "facture.nature.invoice")} · ${formatInstant(inv.issued_at, lang)}`}
      />
      {!note && inv.cancelled && <p role="status" className="etiquette inline-flex rounded-sm border border-foreground px-2 py-0.5">{t("facture.reprise_entiere")}</p>}
      {!note && !inv.cancelled && inv.credited_total > 0 && (
        <p className="text-sm text-muted-foreground">{reprise[0]}<span className="chiffres">{reprise[1]}</span>{reprise[2]}</p>
      )}

      <BoutonsTicket key={inv.id} invoice={inv} direct={{ kind: inv.kind === "credit_note" ? "credit" : "invoice", id: inv.id }} />
      {/* Sous-projet 7, vague 2 : une facture entièrement reprise ne part plus, son avoir oui. */}
      {inv.client_id !== null && !(inv.kind === "invoice" && inv.cancelled) && <EnvoiWhatsapp kind={inv.kind === "credit_note" ? "credit" : "invoice"} id={inv.id} />}
      {allowed && !crediting && (
        <Button variant="outline" className={cn(ACTION, "w-full")} onClick={() => setCrediting(true)}>{t("avoir.emettre")}</Button>
      )}
      {crediting && (
        <FormulaireAvoir
          invoice={inv}
          onClose={() => setCrediting(false)}
          onDone={(created) => { setCrediting(false); openPanel("invoice", created.id); }}
        />
      )}

      <dl className="grid gap-4 border-t border-filet pt-4 @md:grid-cols-2">
        <LigneDetail libelle={t("facture.cliente")}>
          {inv.client_id !== null ? (
            <button type="button" onClick={() => openPanel("client", inv.client_id!)} className={cn("-ml-2 flex min-h-11 items-center rounded-sm px-2 text-left underline decoration-filet underline-offset-4 hover:bg-muted", FOCUS)}>
              {inv.client_name}
            </button>
          ) : t("facture.sans_cliente")}
        </LigneDetail>
        <LigneDetail libelle={t(note ? "facture.etabli_par" : "facture.encaisse_par")}>{inv.account_name ?? ""}</LigneDetail>
        {inv.appointment_id !== null && (
          <LigneDetail libelle={t("facture.rendez_vous")}>
            <button type="button" onClick={() => openPanel("appointment", inv.appointment_id!)} className={cn("-ml-2 flex min-h-11 items-center rounded-sm px-2 text-left underline decoration-filet underline-offset-4 hover:bg-muted", FOCUS)}>
              {inv.appointment_identifier ?? ""}
            </button>
          </LigneDetail>
        )}
        {note && inv.credited_invoice_id !== null && (
          <LigneDetail libelle={t("facture.corrigee")}>
            <button type="button" onClick={() => openPanel("invoice", inv.credited_invoice_id!)} className={cn("chiffres -ml-2 flex min-h-11 items-center rounded-sm px-2 text-left underline decoration-filet underline-offset-4 hover:bg-muted", FOCUS)}>
              {inv.credited_number ?? ""}
            </button>
          </LigneDetail>
        )}
        {note && <div className="@md:col-span-2"><LigneDetail libelle={t("facture.motif")}>{inv.reason}</LigneDetail></div>}
      </dl>

      <section className="space-y-2 border-t border-filet pt-4">
        <h3 className="etiquette text-encre-grise">{t("facture.lignes")}</h3>
        <ul className="divide-y divide-border">
          {orderedLines(inv.lines).map((l) => (
            <li key={l.id} className={cn("flex items-start justify-between gap-3 py-2", l.supplement && "pl-4")}>
              <span className="min-w-0 space-y-0.5">
                <span className="flex items-baseline gap-1.5 break-words font-medium">
                  {l.supplement && <Plus className="h-3 w-3 shrink-0 text-encre-grise" aria-hidden="true" />}
                  <span className="min-w-0 break-words">{pickText(lang, l.label_fr, l.label_en)}</span>
                </span>
                <span className="block text-sm text-muted-foreground">
                  {t("facture.quantite_prix", { quantite: l.quantity, prix: formatPrice(l.unit_price, lang) })}{l.staff_name ? ` · ${l.staff_name}` : ""}
                </span>
                {!note && l.credited > 0 && <span className="block text-sm text-muted-foreground">{tn("facture.reprise", l.credited)}</span>}
                {note && l.restock === 1 && <span className="block text-sm text-muted-foreground">{t("facture.remis_en_stock")}</span>}
              </span>
              <span className="chiffres whitespace-nowrap"><Montant valeur={formatPrice(l.line_total, lang)} /></span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 border-t border-filet pt-2">
          {discount && <Rangee libelle={t("caisse.sous_total")} montant={formatPrice(inv.subtotal, lang)} />}
          {discount && <Rangee libelle={discount} montant={"\u2212" + formatPrice(inv.discount_amount, lang)} />}
          <Rangee fort libelle={t(note ? "facture.total_avoir" : "caisse.total")} montant={formatPrice(inv.total_ttc, lang)} />
          {inv.fiscal.tva_active && <Rangee libelle={vatLabel(inv.fiscal.tva_taux, lang)} montant={formatPrice(inv.total_tva, lang)} />}
        </dl>
      </section>

      {(inv.payments.length > 0 || (inv.deposits ?? []).length > 0) && (
        <section className="space-y-2 border-t border-filet pt-4">
          <h3 className="etiquette text-encre-grise">{t(note ? "facture.remboursements" : "facture.versements")}</h3>
          <dl className="space-y-1">
            {/* Acompte déduit (vague 3b) : versement reçu avant le rendez-vous, sous son numéro de reçu. */}
            {(inv.deposits ?? []).map((d) => <Rangee key={d.id} libelle={t("facture.acompte", { numero: d.number })} montant={formatPrice(d.amount, lang)} />)}
            {inv.payments.map((p, i) => (
              // Remboursements inscrits en négatif sur l'avoir (avoir.ts) : montrés en valeur absolue sous « Remboursement ».
              <Rangee key={i} libelle={`${methodLabel(p.method, lang)}${p.reference ? ` · ${p.reference}` : ""}`} montant={formatPrice(Math.abs(p.cash_given ?? p.amount), lang)} />
            ))}
            {change > 0 && <Rangee libelle={t("caisse.monnaie_rendue")} montant={formatPrice(change, lang)} />}
          </dl>
        </section>
      )}
      {inv.tip && (
        <dl className="border-t border-filet pt-4">
          <Rangee libelle={inv.tip.staff_name ? t("caisse.pourboire_pour", { nom: inv.tip.staff_name }) : t("caisse.pourboire_sans_nom")} montant={formatPrice(inv.tip.amount, lang)} />
        </dl>
      )}

      {inv.credits.length > 0 && (
        <section className="space-y-2 border-t border-filet pt-4">
          <h3 className="etiquette text-encre-grise">{t("facture.avoirs")}</h3>
          <ul className="divide-y divide-border rounded-sm border border-filet bg-card">
            {inv.credits.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => openPanel("invoice", c.id)} className={cn("flex min-h-12 w-full items-start justify-between gap-3 p-3 text-left transition-colors duration-200 hover:bg-muted", FOCUS)}>
                  <span className="min-w-0 space-y-0.5">
                    <span className="chiffres block font-medium">{c.number}</span>
                    <span className="block break-words text-sm text-muted-foreground">{formatInstant(c.issued_at, lang)} · {c.reason}</span>
                  </span>
                  <span className="chiffres whitespace-nowrap"><Montant valeur={"\u2212" + formatPrice(c.total_ttc, lang)} /></span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
