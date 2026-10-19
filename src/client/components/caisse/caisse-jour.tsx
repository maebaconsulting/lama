import { useEffect, useRef, useState } from "preact/hooks";
import { ChevronLeft, ChevronRight } from "lucide-preact";
import { api, ApiError } from "../../api";
import { useApp } from "../../context";
import { useDoualaClock } from "../../hooks/use-journee";
import { useLoad } from "../../hooks/use-load";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/provider";
import { canClose, differenceOf, documentGroups, movedMethods, parseCounted, shiftDay, signedPrice } from "@/lib/caisse-jour";
import { methodLabel } from "@/lib/caisse-texte";
import type { CashClosing, CashDay, ClosingSummary, SaleSettings } from "@/lib/caisse-types";
import { formatInstantTime, formatLongDate, formatPrice, modeSaisieMontant } from "@/lib/format";
import { closingSource } from "@/lib/ticket-pdf";
import { newRequestId } from "@/lib/ticket";
import { cn } from "@/lib/utils";
import { EtatChargement, EtatErreur, Montant } from "../comptoir";
import { BoutonsTicket } from "./boutons-ticket";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Écart dit en toutes lettres : « Aucun écart », « 1 000 F de plus que prévu », « 500 F de moins que prévu ». */
function useEcart() {
  const { t, lang } = useI18n();
  return (expected: number, counted: number) => {
    const d = differenceOf(expected, counted);
    if (d.kind === "juste") return t("caisse_jour.ecart_juste");
    return t(d.kind === "plus" ? "caisse_jour.ecart_plus" : "caisse_jour.ecart_moins", { montant: formatPrice(d.amount, lang) });
  };
}

/**
 * Ce qu'une période de caisse a vu passer : net par moyen (les espèces
 * toujours, les autres s'ils ont bougé ; reçu et remboursé sous le net quand
 * il y a eu un remboursement), nombre de factures et d'avoirs, pourboires dus
 * par praticienne.
 */
function Resume({ summary }: { summary: ClosingSummary }) {
  const { t, tn, lang } = useI18n();
  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
        {movedMethods(summary).map((m) => (
          // Retouche P2 (critique du 1er octobre 2026) : un nombre impair de moyens laissait le
          // dernier seul sur sa ligne (390 px) ; il occupe désormais toute la largeur. @3xl (4
          // colonnes) inchangé, `odd:last:` ne joue que sur une grille à deux colonnes.
          <li key={m.method} className="flex min-w-0 flex-col gap-1 rounded-sm bg-muted px-4 py-3 odd:last:col-span-2 @3xl:col-span-1">
            <span className="etiquette text-muted-foreground">{methodLabel(m.method, lang)}</span>
            <span className="chiffres font-serif text-2xl leading-tight"><Montant valeur={signedPrice(m.net, lang)} /></span>
            {m.refunded > 0 && (
              <span className="text-xs text-muted-foreground">{t("caisse_jour.recu_rembourse", { recu: formatPrice(m.received, lang), rembourse: formatPrice(m.refunded, lang) })}</span>
            )}
          </li>
        ))}
      </ul>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between gap-3">
          <dt>{tn("caisse_jour.factures", summary.invoices.count)}</dt>
          <dd className="chiffres-tabulaires"><Montant valeur={formatPrice(summary.invoices.total, lang)} /></dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>{tn("caisse_jour.avoirs", summary.credit_notes.count)}</dt>
          <dd className="chiffres-tabulaires"><Montant valeur={summary.credit_notes.total > 0 ? "\u2212" + formatPrice(summary.credit_notes.total, lang) : formatPrice(0, lang)} /></dd>
        </div>
        {/* Acomptes (vague 3b) : seulement s'il y en a eu ; leurs versements sont déjà dans les moyens ci-dessus. */}
        {summary.deposits.received.count > 0 && (
          <div className="flex justify-between gap-3">
            <dt>{tn("caisse_jour.acomptes", summary.deposits.received.count)}</dt>
            <dd className="chiffres-tabulaires"><Montant valeur={formatPrice(summary.deposits.received.total, lang)} /></dd>
          </div>
        )}
        {summary.deposits.refunded.count > 0 && (
          <div className="flex justify-between gap-3">
            <dt>{tn("caisse_jour.acomptes_rembourses", summary.deposits.refunded.count)}</dt>
            <dd className="chiffres-tabulaires"><Montant valeur={signedPrice(-summary.deposits.refunded.total, lang)} /></dd>
          </div>
        )}
      </dl>
      <div className="space-y-1">
        <h3 className="etiquette text-encre-grise">{t("caisse_jour.pourboires")}</h3>
        {summary.tips.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("caisse_jour.aucun_pourboire")}</p>
        ) : (
          <dl className="space-y-1 text-sm">
            {summary.tips.map((tip) => (
              <div key={tip.staff_id} className="flex justify-between gap-3">
                <dt className="min-w-0 truncate">{tip.staff_name}</dt>
                <dd className="chiffres-tabulaires"><Montant valeur={formatPrice(tip.amount, lang)} /></dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

/** Une clôture enregistrée : numéro, heure et personne, espèces attendues et comptées, écart, note, ticket imprimable (sur l'imprimante réseau si elle est réglée). */
function CarteCloture({ closing }: { closing: CashClosing }) {
  const { t, lang } = useI18n();
  const ecart = useEcart();
  return (
    <article className="space-y-4 rounded-sm border border-filet bg-card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-serif text-2xl leading-tight">{t("caisse_jour.cloture_n", { numero: closing.seq })}</h2>
        <p className="text-sm text-muted-foreground">{t("caisse_jour.cloture_detail", { heure: formatInstantTime(closing.closed_at, lang), nom: closing.account_name ?? "" })}</p>
      </header>
      <Resume summary={closing.summary} />
      <dl className="space-y-1 border-t border-filet pt-3 text-sm">
        <div className="flex justify-between gap-3"><dt>{t("caisse_jour.especes_attendues")}</dt><dd className="chiffres-tabulaires"><Montant valeur={signedPrice(closing.cash_expected, lang)} /></dd></div>
        <div className="flex justify-between gap-3"><dt>{t("caisse_jour.especes_comptees")}</dt><dd className="chiffres-tabulaires"><Montant valeur={formatPrice(closing.cash_counted, lang)} /></dd></div>
        <div className="flex justify-between gap-3 font-medium"><dt>{t("caisse_jour.ecart")}</dt><dd>{ecart(closing.cash_expected, closing.cash_counted)}</dd></div>
        {/* Retouche P2 (critique du 1er octobre 2026) : préfixée de « Note : », à parité avec le ticket imprimé (ticket.note). */}
        {closing.note && <p className="break-words pt-1 text-muted-foreground">{t("caisse_jour.note_texte", { note: closing.note })}</p>}
      </dl>
      <BoutonsTicket source={closingSource(closing)} direct={{ kind: "closing", id: closing.id }} />
    </article>
  );
}

/**
 * « Clôturer la caisse » : espèces attendues en grand, espèces comptées,
 * écart dit tout de suite, note facultative. L'identifiant de la clôture est
 * tiré à l'ouverture : un double appui ou un renvoi n'en crée pas deux. Le
 * serveur recalcule les espèces attendues au moment de l'enregistrement.
 */
function FormulaireCloture({ report, onClose, onDone }: { report: CashDay; onClose: () => void; onDone: () => void }) {
  const { t, lang } = useI18n();
  const ecart = useEcart();
  const [requestId] = useState(() => newRequestId());
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expected = report.open.summary.cash_expected;
  const value = parseCounted(counted);

  const send = async () => {
    if (value === null) return;
    setSending(true);
    setError(null);
    try {
      await api("POST", "/api/cash/closings", { request_id: requestId, day: report.day, cash_counted: value, note });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("erreur.reseau"));
    } finally {
      setSending(false);
    }
  };

  return (
    <section aria-labelledby="cloture-titre" className="space-y-4 rounded-sm border border-foreground p-4">
      <h2 id="cloture-titre" className="font-serif text-2xl leading-tight">{t("caisse_jour.cloturer")}</h2>
      <div className="flex items-baseline justify-between gap-3">
        <span className="etiquette">{t("caisse_jour.especes_attendues")}</span>
        <span className="chiffres font-serif text-3xl"><Montant valeur={signedPrice(expected, lang)} /></span>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cloture-especes">{t("caisse_jour.especes_comptees")}</Label>
        <Input id="cloture-especes" inputMode={modeSaisieMontant()} className="chiffres-tabulaires h-14 text-right text-2xl" value={counted} onInput={(e: Event) => setCounted((e.currentTarget as HTMLInputElement).value)} />
        <p role="status" className={cn("text-sm", value === null ? "text-muted-foreground" : "font-medium")}>
          {value === null ? t("caisse_jour.saisir_especes") : ecart(expected, value)}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cloture-note">{t("caisse_jour.note")}</Label>
        <Textarea id="cloture-note" rows={2} maxLength={500} value={note} placeholder={t("caisse_jour.note_exemple")} onInput={(e: Event) => setNote((e.currentTarget as HTMLTextAreaElement).value)} />
      </div>
      {error && <p role="alert" className="rounded-sm border border-encre-rouge p-3 text-sm text-encre-rouge">{error}</p>}
      <div className="grid gap-2">
        <Button className="h-16 text-base" disabled={value === null || sending} onClick={send}>{sending ? t("commun.enregistrement") : t("caisse_jour.enregistrer")}</Button>
        <Button variant="ghost" disabled={sending} onClick={onClose}>{t("commun.annuler")}</Button>
      </div>
    </section>
  );
}

/**
 * « Ouvrir le tiroir » (impression directe, spec du 03/10/2026) : le tiroir
 * ne s'ouvre jamais seul ; chaque ouverture est au journal des accès. Montré
 * seulement si une imprimante est réglée (le tiroir est branché sur elle).
 */
function BoutonTiroir() {
  const { t } = useI18n();
  const settings = useLoad(() => api<SaleSettings>("GET", "/api/sales/settings"), ["settings"]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (settings.data?.printer !== true) return null;
  const open = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await api("POST", "/api/print/drawer");
      setMessage({ ok: true, text: t("impression.tiroir_ouvert") });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : t("erreur.reseau") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <Button variant="outline" className="h-12 w-full @md:w-auto" disabled={busy} onClick={() => void open()}>{t("impression.ouvrir_tiroir")}</Button>
      {message && <p role={message.ok ? "status" : "alert"} className={cn("text-sm", message.ok ? "text-muted-foreground" : "text-encre-rouge")}>{message.text}</p>}
    </div>
  );
}

/**
 * Écran « Caisse du jour » (sous-projet 5 § 6.3), gérante et réception :
 * jour affiché (aujourd'hui par défaut, jours passés par les flèches), ce que
 * la caisse a vu passer depuis la dernière clôture (tout le jour s'il n'y en
 * a pas), « Clôturer la caisse », chaque clôture enregistrée et son ticket,
 * section « Après clôture » pour ce qui l'a suivie, et les factures et avoirs
 * du jour rangés par clôture, chacun ouvert dans le panneau.
 */
export function CaisseJour() {
  const { t, lang } = useI18n();
  const { openPanel } = useApp();
  const clock = useDoualaClock();
  const [day, setDay] = useState(clock.day);
  const [closing, setClosing] = useState(false);
  const report = useLoad(() => api<CashDay>("GET", `/api/cash/day?date=${day}`), ["invoices"]);
  // Autre jour choisi : la caisse de ce jour est demandée, le formulaire de clôture refermé.
  const shown = useRef(day);
  useEffect(() => {
    if (shown.current === day) return;
    shown.current = day;
    setClosing(false);
    void report.reload();
  }, [day]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = report.data && report.data.day === day ? report.data : null;
  const closed = data !== null && data.closings.length > 0;

  return (
    <div className="@container mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="space-y-3">
        <h1 className="font-serif text-3xl leading-tight">{t("caisse_jour.titre")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" aria-label={t("caisse_jour.jour_precedent")} onClick={() => setDay(shiftDay(day, -1))}><ChevronLeft aria-hidden="true" /></Button>
          <p className="min-w-0 flex-1 text-center text-sm @md:flex-none @md:px-2">{formatLongDate(day, lang)}</p>
          <Button variant="outline" size="icon" aria-label={t("caisse_jour.jour_suivant")} disabled={day >= clock.day} onClick={() => setDay(shiftDay(day, 1))}><ChevronRight aria-hidden="true" /></Button>
          {day !== clock.day && <Button variant="ghost" onClick={() => setDay(clock.day)}>{t("caisse_jour.aujourdhui")}</Button>}
        </div>
        <BoutonTiroir />
      </header>

      {report.error && !data ? <EtatErreur message={report.error} onRetry={report.reload} /> : !data ? <EtatChargement /> : (
        <>
          {data.closings.map((c) => <CarteCloture key={c.id} closing={c} />)}

          <section aria-labelledby="caisse-ouverte" className="space-y-4">
            <div className="space-y-1">
              <h2 id="caisse-ouverte" className="etiquette text-encre-grise">{t(closed ? "caisse_jour.apres_cloture" : "caisse_jour.encaisse")}</h2>
              {closed && <p className="text-sm text-muted-foreground">{t(data.open.count > 0 ? "caisse_jour.apres_cloture_aide" : "caisse_jour.rien_depuis")}</p>}
            </div>
            {(!closed || data.open.count > 0) && <Resume summary={data.open.summary} />}
            {canClose(data, clock.day) && !closing && (
              <Button className="h-16 w-full text-base" onClick={() => setClosing(true)}>{t("caisse_jour.cloturer")}</Button>
            )}
            {closing && <FormulaireCloture key={day} report={data} onClose={() => setClosing(false)} onDone={() => { setClosing(false); void report.reload(); }} />}
          </section>

          <section aria-labelledby="caisse-documents" className="space-y-3">
            <h2 id="caisse-documents" className="etiquette text-encre-grise">{t("caisse_jour.documents")}</h2>
            {data.documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("caisse_jour.vide")}</p>
            ) : documentGroups(data).map((g) => (
              <div key={g.closing?.id ?? "ouvert"} className="space-y-1">
                <h3 className="text-sm text-muted-foreground">{g.closing ? t("caisse_jour.cloture_n", { numero: g.closing.seq }) : t("caisse_jour.non_cloture")}</h3>
                <ul className="divide-y divide-border rounded-sm border border-filet bg-card">
                  {g.documents.map((d) => (
                    <li key={d.id}>
                      <button type="button" onClick={() => openPanel("invoice", d.id)} className={cn("flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left transition-colors duration-200 hover:bg-muted", FOCUS)}>
                        <span className="min-w-0">
                          <span className="chiffres block font-medium">{d.number}</span>
                          <span className="block truncate text-sm text-muted-foreground">
                            {formatInstantTime(d.issued_at, lang)} · {d.kind === "credit_note" ? t("caisse_jour.avoir_de", { numero: d.credited_number ?? "" }) : d.client_name ?? t("facture.sans_cliente")}
                          </span>
                        </span>
                        <span className="chiffres whitespace-nowrap"><Montant valeur={d.kind === "credit_note" ? "\u2212" + formatPrice(d.total_ttc, lang) : formatPrice(d.total_ttc, lang)} /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
