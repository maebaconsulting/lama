import { useState } from "preact/hooks";
import { X } from "lucide-preact";
import { api, ApiError } from "../../api";
import { useAuth } from "../../auth-context";
import { useLoad } from "../../hooks/use-load";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/provider";
import type { Key } from "@/i18n/translate";
import {
  addDepositPayment, awaitsManager, canSettle, canTakeDeposit, depositBlocker, depositBody, removeDepositPayment, setDepositAmount, setDepositPayment, settleBlocker, settleBody,
  startDeposit, startSettle, type DepositBlocker, type DepositDraft, type SettleDraft,
} from "@/lib/acompte";
import { aroundAmount, methodLabel } from "@/lib/caisse-texte";
import type { Deposit, SaleSettings } from "@/lib/caisse-types";
import { formatPrice, modeSaisieMontant } from "@/lib/format";
import { typeAmount } from "@/lib/saisie-montant";
import { ChampMontant } from "./champ-montant";
import { newRequestId } from "@/lib/ticket";
import { depositSource } from "@/lib/ticket-pdf";
import type { Appointment } from "../../types";
import { PAYMENT_METHODS, REFERENCE_REQUIRED, type PaymentMethod } from "../../../shared/caisse";
import { EtatErreur, Montant } from "../comptoir";
import { Case, SELECT } from "../reglages/elements";
import { keepOutcome } from "@/lib/impression";
import { BoutonsTicket } from "./boutons-ticket";
import { EnvoiWhatsapp } from "./envoi-whatsapp";

const BLOCKER_KEYS: Record<DepositBlocker, Key> = {
  montant: "acompte.bloque_montant",
  plafond: "acompte.bloque_plafond",
  ecart: "acompte.bloque_ecart",
  reference: "acompte.bloque_reference",
};

/**
 * Ce que l'acompte est devenu, en une phrase. Mineur 5 (relecture finale) :
 * en attente sur un rendez-vous annulé ou la cliente absente, il ne se
 * « déduit » plus de rien ; la gérante décide (rembourser ou garder).
 */
function statusText(t: (key: Key, values?: Record<string, string | number>) => string, d: Deposit, appointmentStatus: string): string {
  if (d.status === "applied") return t("acompte.statut.applied", { numero: d.applied_invoice_number ?? "" });
  if (d.status === "kept") return t("acompte.statut.kept", { motif: d.settle_reason });
  if (d.status === "held" && (appointmentStatus === "cancelled" || appointmentStatus === "no_show")) return t("acompte.statut.held_attente");
  return t(`acompte.statut.${d.status}` as Key);
}

/**
 * Acomptes d'un rendez-vous (sous-projet 5 § 6.2), dans sa fiche, pour la
 * gérante et la réception : chaque reçu (numéro, montant, ce qu'il est
 * devenu, « Imprimer » et « Télécharger ») ; « Encaisser un acompte » sur un
 * rendez-vous à venir si la gérante a activé les acomptes ; « Rembourser » ou
 * « Garder » (gérante) quand le rendez-vous est annulé ou la cliente absente.
 * Rien n'est montré quand il n'y a ni acompte ni geste possible.
 */
export function AcompteRdv({ apt }: { apt: Appointment }) {
  const { t, lang } = useI18n();
  const { account } = useAuth();
  const settings = useLoad(() => api<SaleSettings>("GET", "/api/sales/settings"), ["settings"]);
  const list = useLoad(() => api<{ deposits: Deposit[] }>("GET", `/api/deposits?appointment_id=${apt.id}`).then((r) => r.deposits), ["invoices", "appointments"]);
  const [draft, setDraft] = useState<DepositDraft | null>(null);
  const [settle, setSettle] = useState<SettleDraft | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Impression directe : case « Imprimer le ticket », cochée par défaut, si une imprimante est réglée.
  const [print, setPrint] = useState(true);
  const deposits = list.data ?? [];
  const methods = settings.data?.methods ?? ["cash"];
  const canTake = list.data !== null && canTakeDeposit(account.role, settings.data, apt, deposits);
  // Lecture des acomptes en échec (V1-16) : un acompte en attente ne doit jamais devenir invisible.
  if (list.error && !list.data) return <EtatErreur message={list.error} onRetry={() => void list.reload()} />;
  if (deposits.length === 0 && !canTake) return null;

  const send = async (path: string, body: unknown) => {
    setSending(true);
    setError(null);
    try {
      const res = await api<{ deposit?: Deposit & { printed?: boolean; print_error?: string } }>("POST", path, body);
      if (res.deposit) keepOutcome("deposit", res.deposit.id, res.deposit);
      setDraft(null);
      setSettle(null);
      await list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("erreur.reseau"));
    } finally {
      setSending(false);
    }
  };

  const stop = draft ? depositBlocker(draft, apt.total_price) : null;
  const several = (draft?.payments.length ?? 0) > 1;
  const label = draft ? aroundAmount(t("acompte.valider", { montant: formatPrice(draft.amount, lang) }), formatPrice(draft.amount, lang)) : null;

  return (
    <section aria-labelledby={`acompte-titre-${apt.id}`} className="space-y-3 border-t border-filet pt-4">
      <h4 id={`acompte-titre-${apt.id}`} className="etiquette text-encre-grise">{t("acompte.titre")}</h4>
      {deposits.map((d) => (
        <div key={d.id} className="space-y-2 rounded-sm border border-filet p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="chiffres whitespace-nowrap text-sm">{d.number}</span>
            <span className="chiffres whitespace-nowrap font-serif text-xl"><Montant valeur={formatPrice(d.amount, lang)} /></span>
          </div>
          <p className="text-sm text-muted-foreground">{statusText(t, d, apt.status)}</p>
          <BoutonsTicket source={depositSource(d)} direct={{ kind: "deposit", id: d.id }} />
          {d.client_id !== null && <EnvoiWhatsapp kind="deposit" id={d.id} />}
          {awaitsManager(account.role, apt, d) && <p className="text-sm text-encre-rouge">{t("acompte.gerante_seule")}</p>}
          {canSettle(account.role, apt, d) && !settle && (
            <div className="space-y-2">
              <p className="text-sm text-encre-rouge">{t("acompte.annule_question")}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => { setError(null); setSettle(startSettle(d, "refund", newRequestId())); }}>{t("acompte.rembourser")}</Button>
                <Button variant="outline" onClick={() => { setError(null); setSettle(startSettle(d, "keep", newRequestId())); }}>{t("acompte.garder")}</Button>
              </div>
            </div>
          )}
          {canSettle(account.role, apt, d) && settle && (
            <div className="space-y-3 rounded-sm border border-foreground p-3">
              {settle.action === "refund" ? (
                <div className="grid gap-2 @md:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="acompte-rembourse-moyen">{t("acompte.moyen")}</Label>
                    <select id="acompte-rembourse-moyen" className={SELECT} value={settle.method} onChange={(e: Event) => setSettle({ ...settle, method: (e.currentTarget as HTMLSelectElement).value as PaymentMethod })}>
                      {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{methodLabel(m, lang)}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="acompte-rembourse-ref">{REFERENCE_REQUIRED.includes(settle.method) ? t("caisse.reference_obligatoire") : t("caisse.reference")}</Label>
                    <Input id="acompte-rembourse-ref" maxLength={64} value={settle.reference} onInput={(e: Event) => setSettle({ ...settle, reference: (e.currentTarget as HTMLInputElement).value })} />
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="acompte-motif">{t("acompte.motif")}</Label>
                  <Textarea id="acompte-motif" rows={2} maxLength={200} value={settle.reason} placeholder={t("acompte.motif_exemple")} onInput={(e: Event) => setSettle({ ...settle, reason: (e.currentTarget as HTMLTextAreaElement).value })} />
                </div>
              )}
              <Button className="h-auto min-h-16 w-full whitespace-normal text-base" disabled={sending || settleBlocker(settle) !== null} onClick={() => send(`/api/deposits/${d.id}/settle`, settleBody(d, settle))}>
                {settle.action === "refund" ? t("acompte.rembourser_valider", { montant: formatPrice(d.amount, lang) }) : t("acompte.garder_valider")}
              </Button>
              {settleBlocker(settle) && <p className="text-center text-sm text-muted-foreground">{t(settleBlocker(settle) === "motif" ? "acompte.bloque_motif" : "acompte.bloque_reference")}</p>}
              <Button variant="ghost" className="w-full" disabled={sending} onClick={() => setSettle(null)}>{t("commun.annuler")}</Button>
            </div>
          )}
        </div>
      ))}
      {canTake && !draft && (
        <Button variant="outline" className="w-full" onClick={() => { setError(null); setDraft(startDeposit(methods, newRequestId())); }}>{t("acompte.encaisser")}</Button>
      )}
      {canTake && draft && (
        <div className="space-y-3 rounded-sm border border-foreground p-3">
          <p className="text-sm text-muted-foreground">{t("acompte.aide")}</p>
          <div className="space-y-1">
            <Label htmlFor="acompte-montant">{t("acompte.montant")}</Label>
            <ChampMontant
              id="acompte-montant"
              inputMode={modeSaisieMontant()}
              className="chiffres-tabulaires h-12 text-right text-lg"
              amount={draft.amount}
              onInput={(e: Event, avant: string) => setDraft(setDepositAmount(draft, typeAmount(e, draft.amount, lang, avant)))}
            />
            {apt.total_price != null && <p className="text-xs text-muted-foreground">{t("acompte.plafond_aide", { montant: formatPrice(apt.total_price, lang) })}</p>}
          </div>
          <div className="space-y-2">
            <h5 className="etiquette text-encre-grise">{t("acompte.versements")}</h5>
            {draft.payments.map((p, i) => (
              <div key={i} className="grid gap-2 rounded-sm border border-filet p-2 @md:grid-cols-[1fr_8rem_1fr_auto] @md:items-end">
                <div className="space-y-1">
                  <Label htmlFor={`acompte-moyen-${i}`}>{t("acompte.moyen")}</Label>
                  <select id={`acompte-moyen-${i}`} className={SELECT} value={p.method} onChange={(e: Event) => setDraft(setDepositPayment(draft, i, { method: (e.currentTarget as HTMLSelectElement).value as PaymentMethod }))}>
                    {methods.map((m) => <option key={m} value={m}>{methodLabel(m, lang)}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`acompte-verse-${i}`}>{t("acompte.montant_verse")}</Label>
                  <ChampMontant
                    id={`acompte-verse-${i}`}
                    inputMode={modeSaisieMontant()}
                    className="chiffres-tabulaires text-right"
                    disabled={!several}
                    amount={several ? p.amount : draft.amount}
                    blankZero={several}
                    onInput={(e: Event, avant: string) => setDraft(setDepositPayment(draft, i, { amount: typeAmount(e, p.amount, lang, avant) }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`acompte-ref-${i}`}>{REFERENCE_REQUIRED.includes(p.method) ? t("caisse.reference_obligatoire") : t("caisse.reference")}</Label>
                  <Input id={`acompte-ref-${i}`} maxLength={64} value={p.reference} onInput={(e: Event) => setDraft(setDepositPayment(draft, i, { reference: (e.currentTarget as HTMLInputElement).value }))} />
                </div>
                {several && (
                  <Button variant="ghost" size="icon" aria-label={t("acompte.retirer_moyen", { moyen: methodLabel(p.method, lang) })} onClick={() => setDraft(removeDepositPayment(draft, i))}><X aria-hidden="true" /></Button>
                )}
              </div>
            ))}
            {draft.payments.length < methods.length && (
              <Button variant="outline" onClick={() => setDraft(addDepositPayment(draft, methods))}>{t("acompte.ajouter_moyen")}</Button>
            )}
          </div>
          {/* Retouche P3 (critique.md) : collé en bas du formulaire (motif de paiement.tsx), toujours
              visible au téléphone sans indice de défilement à deviner ; le panneau défile naturellement. */}
          <div className="sticky bottom-0 space-y-2 bg-background pb-1 pt-2">
            {settings.data?.printer === true && <Case id="acompte-imprimer" label={t("caisse.imprimer_ticket")} checked={print} disabled={sending} onChange={setPrint} />}
            <Button className="h-auto min-h-16 w-full whitespace-normal text-base" disabled={stop !== null || sending} onClick={() => send("/api/deposits", { ...depositBody(apt.id, draft), ...(settings.data?.printer === true && print ? { print: true } : {}) })}>
              {sending ? t("caisse.emission") : label && <>{label[0]}<span className="chiffres">{label[1]}</span>{label[2]}</>}
            </Button>
            {stop && <p className="text-center text-sm text-muted-foreground">{t(BLOCKER_KEYS[stop])}</p>}
          </div>
          <Button variant="ghost" className="w-full" disabled={sending} onClick={() => setDraft(null)}>{t("commun.annuler")}</Button>
        </div>
      )}
      {error && <p role="alert" className="rounded-sm border border-encre-rouge p-3 text-sm text-encre-rouge">{error}</p>}
    </section>
  );
}
