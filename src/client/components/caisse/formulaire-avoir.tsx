import { useState } from "preact/hooks";
import { Minus, Plus, X } from "lucide-preact";
import { api, ApiError } from "../../api";
import { useLoad } from "../../hooks/use-load";
import { keepOutcome } from "@/lib/impression";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/provider";
import {
  addRefund, completesInvoice, creditBlocker, creditBody, creditPreview, remainingOf, removeRefund, setQuantity, setReason, setRefund, setRestock, startCredit, takeAll, type CreditBlocker, type CreditDraft,
} from "@/lib/avoir";
import { pickText } from "@/lib/bilingual";
import { aroundAmount, methodLabel, vatLabel } from "@/lib/caisse-texte";
import type { Invoice, SaleSettings } from "@/lib/caisse-types";
import { formatAmount, formatPrice } from "@/lib/format";
import { typeAmount } from "@/lib/saisie-montant";
import { newRequestId } from "@/lib/ticket";
import { PAYMENT_METHODS, REFERENCE_REQUIRED, type PaymentMethod } from "../../../shared/caisse";
import type { Key } from "@/i18n/translate";
import { Montant } from "../comptoir";
import { Case, SELECT } from "../reglages/elements";

const BLOCKER_KEYS: Record<CreditBlocker, Key> = {
  lignes: "avoir.bloque_lignes",
  motif: "avoir.bloque_motif",
  ecart: "avoir.bloque_ecart",
  reference: "avoir.bloque_reference",
};

/**
 * « Émettre un avoir » (sous-projet 5 § 6.1), dans la fiche d'une facture :
 * lignes encore à reprendre avec − et + (ou « Tout reprendre »), « Remettre
 * en stock » pour un produit, motif obligatoire, montant de l'avoir calculé
 * comme le serveur (remise au prorata), remboursement par un ou plusieurs
 * moyens (un seul porte tout le montant). L'identifiant de l'avoir est tiré
 * à l'ouverture et gardé : un renvoi après une coupure ne crée jamais un
 * second avoir. Émis, l'avoir ne se modifie plus.
 */
export function FormulaireAvoir({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: (note: Invoice) => void }) {
  const { t, lang } = useI18n();
  const [draft, setDraft] = useState<CreditDraft>(() => startCredit(invoice, newRequestId()));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Impression directe : case « Imprimer le ticket », cochée par défaut, si une imprimante est réglée.
  const settings = useLoad(() => api<SaleSettings>("GET", "/api/sales/settings"), ["settings"]);
  const printer = settings.data?.printer === true;
  const [print, setPrint] = useState(true);
  const preview = creditPreview(invoice, draft);
  const stop = creditBlocker(invoice, draft);
  // Correctif tâche 6, joint (report de la tâche 3) : l'acompte déjà versé et déduit à l'encaissement
  // (fiche-facture.tsx l'affiche sous « Versements ») se rappelle ici, près du remboursement.
  // Mineur 4 (relecture finale) : seulement quand l'avoir reprend toute la facture (toutes les
  // quantités) ; un avoir partiel ne rembourse pas forcément l'acompte, la phrase induirait en erreur.
  const acompte = completesInvoice(invoice, draft) ? (invoice.deposits ?? [])[0] ?? null : null;
  const several = draft.refunds.length > 1;
  const refunded = several ? draft.refunds.reduce((sum, r) => sum + r.amount, 0) : preview.total_ttc;

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const done = await api<{ credit_note: Invoice }>("POST", "/api/credit-notes", { ...creditBody(invoice, draft), ...(printer && print ? { print: true } : {}) });
      keepOutcome("credit", done.credit_note.id, done.credit_note);
      onDone(done.credit_note);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("erreur.reseau"));
    } finally {
      setSending(false);
    }
  };

  const label = aroundAmount(t("avoir.valider", { montant: formatPrice(preview.total_ttc, lang) }), formatPrice(preview.total_ttc, lang));

  return (
    <section aria-labelledby="avoir-titre" className="space-y-4 rounded-sm border border-foreground p-4">
      <div className="space-y-1">
        <h3 id="avoir-titre" className="font-serif text-2xl leading-tight">{t("avoir.titre")}</h3>
        <p className="text-sm text-muted-foreground">{t("avoir.aide")}</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h4 className="etiquette text-encre-grise">{t("facture.lignes")}</h4>
          <Button variant="ghost" className="-mr-3" onClick={() => setDraft(takeAll(invoice, draft))}>{t("avoir.tout_reprendre")}</Button>
        </div>
        <ul className="divide-y divide-border border-y border-filet">
          {draft.lines.map((d) => {
            const line = invoice.lines.find((l) => l.id === d.line_id)!;
            const name = pickText(lang, line.label_fr, line.label_en);
            return (
              <li key={d.line_id} className="space-y-1 py-2">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium">{name}</span>
                    <span className="block text-sm text-muted-foreground">{t("facture.quantite_prix", { quantite: remainingOf(line), prix: formatPrice(line.unit_price, lang) })}</span>
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="outline" size="icon" aria-label={t("avoir.moins", { designation: name })} disabled={d.quantity === 0} onClick={() => setDraft(setQuantity(invoice, draft, d.line_id, d.quantity - 1))}><Minus aria-hidden="true" /></Button>
                    <span className="chiffres w-14 text-center text-lg" aria-live="polite">{t("avoir.sur", { quantite: d.quantity, reste: remainingOf(line) })}</span>
                    <Button variant="outline" size="icon" aria-label={t("avoir.plus", { designation: name })} disabled={d.quantity >= remainingOf(line)} onClick={() => setDraft(setQuantity(invoice, draft, d.line_id, d.quantity + 1))}><Plus aria-hidden="true" /></Button>
                  </div>
                </div>
                {line.kind === "product" && (
                  <Case id={`avoir-stock-${d.line_id}`} label={t("avoir.remettre_stock")} checked={d.restock} disabled={d.quantity === 0} onChange={(on) => setDraft(setRestock(invoice, draft, d.line_id, on))} />
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="avoir-motif">{t("avoir.motif")}</Label>
        <Textarea id="avoir-motif" rows={2} maxLength={200} value={draft.reason} placeholder={t("avoir.motif_exemple")} onInput={(e: Event) => setDraft(setReason(draft, (e.currentTarget as HTMLTextAreaElement).value))} />
      </div>

      <dl className="space-y-1 border-t border-filet pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="etiquette">{t("avoir.montant")}</dt>
          <dd className="chiffres font-serif text-3xl"><Montant valeur={formatPrice(preview.total_ttc, lang)} /></dd>
        </div>
        {invoice.fiscal.tva_active && preview.total_ttc > 0 && (
          <div className="flex justify-between gap-3 text-sm text-muted-foreground">
            <dt>{vatLabel(invoice.fiscal.tva_taux, lang)}</dt>
            <dd className="chiffres-tabulaires"><Montant valeur={formatPrice(preview.total_tva, lang)} /></dd>
          </div>
        )}
      </dl>

      <div className="space-y-2">
        <h4 className="etiquette text-encre-grise">{t("avoir.remboursement")}</h4>
        {acompte && <p className="text-sm text-muted-foreground">{t("avoir.remboursement_acompte", { numero: acompte.number, montant: formatPrice(acompte.amount, lang) })}</p>}
        {preview.total_ttc === 0 ? (
          <p className="text-sm text-muted-foreground">{t("avoir.rien_a_rembourser")}</p>
        ) : (
          <>
            {draft.refunds.map((r, i) => (
              <div key={i} className="grid gap-2 rounded-sm border border-filet p-2 @md:grid-cols-[1fr_8rem_1fr_auto] @md:items-end">
                <div className="space-y-1">
                  <Label htmlFor={`avoir-moyen-${i}`}>{t("avoir.moyen")}</Label>
                  <select id={`avoir-moyen-${i}`} className={SELECT} value={r.method} onChange={(e: Event) => setDraft(setRefund(draft, i, { method: (e.currentTarget as HTMLSelectElement).value as PaymentMethod }))}>
                    {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{methodLabel(m, lang)}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`avoir-montant-${i}`}>{t("avoir.montant_rembourse")}</Label>
                  <Input
                    id={`avoir-montant-${i}`}
                    inputMode="numeric"
                    className="chiffres-tabulaires text-right"
                    disabled={!several}
                    value={several ? (r.amount ? formatAmount(r.amount, lang) : "") : formatAmount(preview.total_ttc, lang)}
                    onInput={(e: Event) => setDraft(setRefund(draft, i, { amount: typeAmount(e, r.amount, lang) }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`avoir-reference-${i}`}>{REFERENCE_REQUIRED.includes(r.method) ? t("caisse.reference_obligatoire") : t("caisse.reference")}</Label>
                  <Input id={`avoir-reference-${i}`} maxLength={64} value={r.reference} onInput={(e: Event) => setDraft(setRefund(draft, i, { reference: (e.currentTarget as HTMLInputElement).value }))} />
                </div>
                {several && (
                  <Button variant="ghost" size="icon" aria-label={t("avoir.retirer_moyen", { moyen: methodLabel(r.method, lang) })} onClick={() => setDraft(removeRefund(draft, i))}><X aria-hidden="true" /></Button>
                )}
              </div>
            ))}
            {draft.refunds.length < PAYMENT_METHODS.length && (
              <Button variant="outline" onClick={() => setDraft(addRefund(draft))}>{t("avoir.ajouter_moyen")}</Button>
            )}
            {several && (
              <p className="text-sm text-muted-foreground">{t("avoir.reparti", { rembourse: formatPrice(refunded, lang), total: formatPrice(preview.total_ttc, lang) })}</p>
            )}
          </>
        )}
      </div>

      {printer && <Case id="avoir-imprimer" label={t("caisse.imprimer_ticket")} checked={print} disabled={sending} onChange={setPrint} />}
      {error && <p role="alert" className="rounded-sm border border-encre-rouge p-3 text-sm text-encre-rouge">{error}</p>}
      <div className="grid gap-2">
        <Button className="h-auto min-h-16 whitespace-normal text-base" disabled={stop !== null || sending} onClick={send}>
          {sending ? t("caisse.emission") : <>{label[0]}<span className="chiffres">{label[1]}</span>{label[2]}</>}
        </Button>
        {stop && <p className="text-center text-sm text-muted-foreground">{t(BLOCKER_KEYS[stop])}</p>}
        <Button variant="ghost" disabled={sending} onClick={onClose}>{t("commun.annuler")}</Button>
      </div>
    </section>
  );
}
