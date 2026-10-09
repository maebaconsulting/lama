import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { changeText, methodLabel } from "@/lib/caisse-texte";
import type { Invoice } from "@/lib/caisse-types";
import { formatInstant, formatPrice } from "@/lib/format";
import { Montant } from "../comptoir";
import { BoutonsTicket } from "./boutons-ticket";
import { EnvoiWhatsapp } from "./envoi-whatsapp";

/**
 * Après l'émission (sous-projet 5 § 4.2) : numéro, total, versements et
 * monnaie rendue, « Imprimer » et « Télécharger » le ticket PDF (vague 2,
 * § 5.1), « Envoyer par WhatsApp » (sous-projet 7, vague 2), puis « Nouvelle vente ».
 */
export function Emise({ invoice, onNew, onHome, allowNew = true }: { invoice: Invoice; onNew: () => void; onHome: () => void; allowNew?: boolean }) {
  const { t, lang } = useI18n();
  const change = invoice.payments.reduce((sum, p) => sum + p.change_given, 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-4 sm:p-6">
      <section aria-labelledby="facture-emise" className="w-full max-w-md space-y-5 py-6">
        <div className="space-y-2 border-b border-filet pb-5 text-center">
          <p id="facture-emise" className="etiquette text-encre-grise">{t("caisse.facture_emise")}</p>
          <p className="chiffres font-serif text-4xl leading-tight">{invoice.number}</p>
          <p className="text-sm text-muted-foreground">{formatInstant(invoice.issued_at, lang)}{invoice.client_name ? ` · ${invoice.client_name}` : ""}</p>
        </div>
        <dl className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="etiquette">{t("caisse.total")}</dt>
            <dd className="chiffres font-serif text-3xl"><Montant valeur={formatPrice(invoice.total_ttc, lang)} /></dd>
          </div>
          {invoice.tip && (
            <div className="flex justify-between gap-3 text-sm text-muted-foreground">
              <dt>{invoice.tip.staff_name ? t("caisse.pourboire_pour", { nom: invoice.tip.staff_name }) : t("caisse.pourboire_sans_nom")}</dt>
              <dd className="chiffres-tabulaires text-base"><Montant valeur={formatPrice(invoice.tip.amount, lang)} /></dd>
            </div>
          )}
          {invoice.payments.map((p, i) => (
            <div key={i} className="flex justify-between gap-3 text-sm text-muted-foreground">
              <dt className="min-w-0 truncate">{methodLabel(p.method, lang)}{p.reference ? ` · ${p.reference}` : ""}</dt>
              <dd className="chiffres-tabulaires text-base"><Montant valeur={formatPrice(p.cash_given ?? p.amount, lang)} /></dd>
            </div>
          ))}
        </dl>
        {change > 0 && (
          <div className="flex items-center justify-between gap-4 rounded-sm bg-primary p-4 text-primary-foreground">
            <div className="min-w-0">
              <p className="etiquette">{t("caisse.monnaie_rendue")}</p>
              <p className="mt-1 text-sm opacity-80">{changeText(change, lang)}</p>
            </div>
            <p className="chiffres shrink-0 font-serif text-3xl"><Montant valeur={formatPrice(change, lang)} /></p>
          </div>
        )}
        <BoutonsTicket invoice={invoice} direct={{ kind: "invoice", id: invoice.id }} outcome={invoice} />
        {invoice.client_id !== null && <EnvoiWhatsapp kind="invoice" id={invoice.id} queued={invoice.whatsapp_queued} />}
        <div className="grid gap-2">
          {/* La praticienne n'a pas de vente de comptoir (encaissement par la praticienne, vague 3). */}
          {allowNew && <Button className="h-16 w-full text-base" onClick={onNew}>{t("caisse.nouvelle_vente")}</Button>}
          <Button variant="outline" className="w-full" onClick={onHome}>{t(allowNew ? "caisse.retour_aujourdhui" : "caisse.retour_ma_journee")}</Button>
        </div>
      </section>
    </div>
  );
}
