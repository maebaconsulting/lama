import { useEffect, useRef, useState } from "preact/hooks";
import { ChevronLeft, X } from "lucide-preact";
import { api, ApiError } from "../../api";
import { useAuth } from "../../auth-context";
import { useLoad } from "../../hooks/use-load";
import type { Client } from "../../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/provider";
import { aroundAmount, blockerText, changeText, discountLabel, methodLabel } from "@/lib/caisse-texte";
import type { Invoice, SaleSettings } from "@/lib/caisse-types";
import { formatAmount, formatPrice } from "@/lib/format";
import {
  blocker, cashSuggestions, chooseMethod, padAction, padKeys, paymentsBody, pressKey, removeEntry, saisiePave, setReference, setTendered, settlementOf, startPayment, type KeyPlace, type PaymentDraft,
} from "@/lib/paiement";
import { lostSaleVerdict, saleLookupPath, type LostSaleVerdict } from "@/lib/reprise-vente";
import { saleBody, type Ticket } from "@/lib/ticket";
import { cn } from "@/lib/utils";
import { canSeeManual } from "@/lib/roles";
import { ticketChoice } from "@/lib/whatsapp";
import { separateurDecimal } from "../../../shared/montants";
import { PAYMENT_METHODS, REFERENCE_REQUIRED, type Totals } from "../../../shared/caisse";
import { useConfirmation } from "../auth/confirmation";
import { Montant } from "../comptoir";
import { Approbation } from "./approbation";
import { Case } from "../reglages/elements";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";
/** Gros sélecteur de 64 px : moyen choisi en ivoire, filet cuir. */
const moyen = (actif: boolean) => cn(
  "min-h-16 rounded-sm border px-2 text-sm leading-tight transition-colors duration-200",
  actif ? "border-foreground bg-muted font-medium" : "border-filet bg-card hover:bg-muted",
  FOCUS,
);

/**
 * Où tombe une frappe du clavier physique (voir `padAction`) : champ de
 * saisie, fenêtre ouverte ou autre partie de l'écran (rail, panneau), touche
 * du pavé ou montant rapide (`data-pave`), autre bouton ou lien de l'étape,
 * ou reste de la page.
 */
function placeOf(target: EventTarget | null, root: HTMLElement | null): KeyPlace {
  if (!(target instanceof HTMLElement) || target === document.body) return "libre";
  if (target.closest('[role="dialog"]') || (root !== null && !root.contains(target))) return "fenetre";
  if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return "champ";
  if (target.closest("[data-pave]")) return "pave";
  if (target.closest("button, a, [role='button']")) return "controle";
  return "libre";
}

/**
 * Paiement et émission (sous-projet 5 § 4.2) : montant à payer en grand,
 * moyens activés par la gérante, versements, « reçu » et « reste à payer » ;
 * espèces : calculatrice, montants rapides et « À rendre » en très grand avec
 * les coupures ; carte et paiements mobiles : reste proposé et référence.
 * « Valider et émettre la facture » envoie la vente avec son `request_id` ;
 * une réponse perdue se renvoie telle quelle et rend la facture déjà émise.
 * À partir de 42 rem : récapitulatif à gauche, calculatrice à droite, « À
 * rendre » en bas de la colonne de gauche ; au téléphone, une colonne dont le
 * pavé entier tient à 390 × 844, « À rendre » dans le pied collant juste
 * au-dessus de « Valider » (emplacement de hauteur fixe : le pavé ne bouge
 * plus quand le montant dépasse le dû). Au poste fixe, le clavier physique
 * tape sur le pavé tant que l'étape est affichée (chiffres, Retour arrière,
 * Entrée).
 */
export function Paiement({ ticket, totals, settings, clientName, onBack, onIssued, onStale, onPending, resume }: {
  ticket: Ticket;
  totals: Totals;
  settings: SaleSettings;
  clientName: string | null;
  onBack: () => void;
  onIssued: (invoice: Invoice) => void;
  /**
   * Total refusé par le serveur (prix ou stock changés) : l'écran recharge le
   * catalogue. `due`, présent pour un refus « total », est le montant dû
   * recalculé par le serveur (mineur 2 de la relecture finale) : affiché
   * tout de suite, sans attendre le rechargement, pour qu'un prix de
   * prestation changé ne reboucle pas sur le même refus.
   */
  onStale: (due?: number) => void;
  /**
   * Issue d'un envoi encore inconnue (spec § 7) : partie tout de suite à
   * l'envoi, elle le reste après une réponse perdue (statut 0 ou 500 et
   * plus), jusqu'à une facture ou un refus explicite du serveur. L'écran
   * « Vente » la garde avec le ticket pour geler sa modification même après
   * un aller-retour sur l'écran.
   */
  onPending: (pending: boolean) => void;
  /**
   * Vrai si l'écran « Vente » a été quitté puis rouvert pendant que l'issue
   * d'un envoi restait inconnue (§ 7, relecture de la tâche 6) : `sending`
   * et `error` repartent de zéro à ce remontage, alors que la demande
   * d'origine reste sans réponse connue. Reprend donc directement dans
   * l'état « réponse perdue », pour que « Retour au ticket » reste
   * désactivé et que l'aide à la reprise s'affiche tout de suite.
   */
  resume: boolean;
}) {
  const { t, lang } = useI18n();
  const confirm = useConfirmation();
  const due = totals.due;
  const methods = PAYMENT_METHODS.filter((m) => (settings.methods ?? []).includes(m));
  const [draft, setDraft] = useState<PaymentDraft>(() => startPayment(methods));
  const [sending, setSending] = useState(false);
  // Vérification d'une vente perdue en cours (report de la vague 2) : rien n'est envoyé, seulement lu.
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<{ message: string; retry: boolean } | null>(() => (resume ? { message: t("erreur.reseau"), retry: true } : null));
  const [approval, setApproval] = useState<{ refused: string | null } | null>(null);
  // Case « Envoyer par WhatsApp » (sous-projet 7, vague 2) : la cliente du ticket est lue pour son numéro et son
  // accord (réception et gérante ; la praticienne ne lit pas le numéro des clientes) ; `null` tant que la personne n'y a pas touché.
  const { account } = useAuth();
  const clientId = canSeeManual(account.role) ? ticket.client_id : null;
  const client = useLoad(() => (clientId === null ? Promise.resolve(null) : api<{ client: Client }>("GET", `/api/clients/${clientId}`).then((r) => r.client)), ["clients"]);
  const [whatsappChoice, setWhatsappChoice] = useState<boolean | null>(null);
  const choice = ticketChoice(client.data);
  const whatsapp = choice.offered && (whatsappChoice ?? choice.checked);
  // Impression directe : case « Imprimer le ticket », cochée par défaut, seulement si une imprimante est réglée.
  const [printChoice, setPrintChoice] = useState(true);
  const print = settings.printer === true && printChoice;

  const s = settlementOf(draft, due);
  const stop = blocker(draft, due);
  const active = draft.active === null ? null : draft.entries[draft.active];
  const current = active ?? { method: draft.method, amount: 0, reference: "", proposed: true };
  const cash = current.method === "cash";
  // Au téléphone, la liste des versements n'apparaît qu'à partir de deux (paiement mixte) : un seul se lit déjà dans l'afficheur.
  const plusieurs = draft.entries.filter((e) => e.amount > 0).length > 1;
  // Tant que l'issue d'un envoi est inconnue (parti, réponse perdue), seule la même demande peut repartir : retour au ticket bloqué (§ 7).
  const retourBloque = sending || checking || error?.retry === true;

  /**
   * Envoie la vente ; la même demande (même `request_id`) peut être renvoyée
   * sans risque. `onPending` est prévenu dès le départ (issue inconnue tant
   * que la réponse n'est pas là), puis à chaque issue devenue certaine : une
   * facture, un refus explicite, ou toujours inconnue pour une réponse
   * perdue (§ 7), qu'il faut alors garder avec le ticket.
   */
  const send = async (manager?: { login: string; password: string }) => {
    setSending(true);
    onPending(true);
    setError(null);
    const body = { ...saleBody(ticket), payments: paymentsBody(draft, due), ...(manager ? { approval: manager } : {}), ...(whatsapp ? { whatsapp: true } : {}), ...(print ? { print: true } : {}) };
    try {
      const done = await confirm(() => api<{ invoice: Invoice }>("POST", "/api/sales", body));
      if (done) {
        setApproval(null);
        onPending(false);
        onIssued(done.invoice);
      } else {
        // Mot de passe de confirmation annulé : aucune demande n'est partie.
        onPending(false);
      }
    } catch (err) {
      const e = err as ApiError;
      if (e instanceof ApiError && e.code === "approbation") {
        setApproval({ refused: manager ? e.message : null });
        onPending(false);
      } else {
        // Coupure ou refus (prix, stock) pendant l'approbation : la fenêtre se referme pour que l'erreur redevienne visible ;
        // le renvoi sans « approval » la rouvrira si la vente n'a toujours pas été émise (le replay passe avant l'approbation).
        setApproval(null);
        if (e instanceof ApiError && (e.code === "total" || e.code === "stock")) onStale(e.code === "total" ? (e.body as { due?: number } | null)?.due : undefined);
        setError({ message: e.message, retry: e instanceof ApiError && (e.status === 0 || e.status >= 500) });
        // Réponse perdue (statut 0 ou 500 et plus) : l'issue reste inconnue même une fois l'envoi terminé (§ 7).
        onPending(e instanceof ApiError && (e.status === 0 || e.status >= 500));
      }
    } finally {
      setSending(false);
    }
  };

  /**
   * Reprise d'une vente dont l'issue est inconnue (§ 7, report de la vague 2) :
   * le serveur dit, sans rien émettre, si la facture existe. Émise : elle
   * s'affiche. Absente : le ticket est dégelé et une phrase le dit. Inconnue
   * (serveur toujours injoignable) : le gel et le message restent.
   */
  const lookup = async (): Promise<LostSaleVerdict> => {
    setChecking(true);
    try {
      const found = await api<{ invoice: Invoice }>("GET", saleLookupPath(ticket.request_id));
      onPending(false);
      onIssued(found.invoice);
      return "emise";
    } catch (err) {
      const verdict = lostSaleVerdict(err);
      if (verdict === "absente") {
        onPending(false);
        setError({ message: t("caisse.vente_absente"), retry: false });
      }
      return verdict;
    } finally {
      setChecking(false);
    }
  };

  /** « Réessayer l'envoi » : la vente n'est renvoyée que si le serveur dit qu'elle n'a pas été émise. */
  const retry = async () => {
    if ((await lookup()) === "absente") await send();
  };

  // Écran rouvert pendant qu'une issue restait inconnue : vérification tout de suite, sans attendre un geste.
  useEffect(() => {
    if (resume) void lookup();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Clavier physique (retouche 7) : chiffres et Retour arrière sur le pavé,
   * Entrée pour « Valider et émettre » seulement s'il est actif. L'écouteur
   * n'existe que pendant l'étape de paiement, et pas pendant la fenêtre
   * d'approbation ; la référence de transaction garde sa frappe.
   */
  const racine = useRef<HTMLDivElement>(null);
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  onKeyRef.current = (e: KeyboardEvent) => {
    const action = padAction(e, placeOf(e.target, racine.current));
    if (action === null) return;
    // Entrée sur une touche du pavé cliquée à la souris : valider, jamais rappuyer la touche.
    e.preventDefault();
    if (action === "valider") {
      // Touche maintenue : un seul envoi.
      if (stop === null && !sending && !checking && !e.repeat) void (error?.retry ? retry() : send());
      return;
    }
    // Retouche C (décision du 30/09/2026) : à dû nul, ni moyens ni pavé ; le clavier n'ouvre plus de versement.
    if (!sending && due > 0) setDraft((d) => pressKey(d, action, due));
  };
  useEffect(() => {
    if (approval) return;
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [approval]);

  /**
   * Relecture, mineur 2 (retouche C) : si le dû tombe à 0 pendant l'étape
   * (refus « total », `onStale(0)`, prix repassé à 0 F au catalogue) alors
   * qu'un versement était déjà saisi, le brouillon garderait cette entrée :
   * `blocker` renverrait « trop » et « Valider » resterait inactif alors
   * qu'il n'y a plus rien à régler. Le brouillon est donc vidé dès que le
   * dû devient nul.
   */
  useEffect(() => {
    if (due === 0) setDraft(startPayment(methods));
  }, [due]); // eslint-disable-line react-hooks/exhaustive-deps

  const libelleSaisie = cash ? t("caisse.recu_especes") : t("caisse.paye_par", { moyen: methodLabel(current.method, lang) });

  return (
    <div ref={racine} className="flex min-h-0 flex-1 flex-col overflow-y-auto @2xl:flex-row @2xl:overflow-hidden">
      {/* Au téléphone, les deux colonnes se fondent en une seule (display: contents) et l'ordre suit la maquette. */}
      <section className="contents @2xl:flex @2xl:min-h-0 @2xl:min-w-0 @2xl:flex-1 @2xl:flex-col @2xl:gap-5 @2xl:overflow-y-auto @2xl:p-6">
        {/* Tablette : « Retour au ticket » écrit et nom de la cliente ; au téléphone, chevron sur la ligne du titre (la cliente est au ticket). */}
        <div className="order-1 hidden items-center justify-between gap-3 @2xl:flex">
          <Button variant="ghost" className="-ml-3" disabled={retourBloque} onClick={onBack}><ChevronLeft aria-hidden="true" /> {t("caisse.retour_ticket")}</Button>
          {clientName && <span className="min-w-0 truncate text-sm text-muted-foreground">{clientName}</span>}
        </div>
        <div className="order-2 flex items-center gap-1 border-b border-filet px-4 pb-2 pt-2 @2xl:flex-col @2xl:items-stretch @2xl:gap-4 @2xl:px-0 @2xl:pb-5 @2xl:pt-0">
          <Button variant="ghost" size="icon" className="-ml-3 @2xl:hidden" aria-label={t("caisse.retour_ticket")} disabled={retourBloque} onClick={onBack}><ChevronLeft aria-hidden="true" /></Button>
          <h1 className="font-serif text-3xl leading-tight">{t("caisse.paiement")}</h1>
          <div className="ml-auto flex items-baseline justify-between gap-3 @2xl:ml-0">
            <span className="etiquette hidden text-encre-grise @2xl:inline">{t("caisse.a_payer")}</span>
            <span className="chiffres text-right font-serif text-3xl leading-none @2xl:text-5xl"><Montant valeur={formatPrice(due, lang)} /></span>
          </div>
        </div>
        {/* Téléphone : les quatre moyens sur une rangée (64 px gardés) ; colonne étroite de la tablette : deux par rangée. */}
        <div className="order-3 space-y-2 px-4 pt-3 @2xl:p-0">
          {due > 0 ? (
            <>
              <h2 className="etiquette sr-only text-encre-grise @2xl:not-sr-only">{t("caisse.moyen_paiement")}</h2>
              <div role="group" aria-label={t("caisse.moyen_paiement")} className="grid grid-cols-4 gap-2 @2xl:grid-cols-2 @4xl:grid-cols-4">
                {methods.map((m) => (
                  <button key={m} type="button" aria-pressed={current.method === m} className={moyen(current.method === m)} onClick={() => setDraft(chooseMethod(draft, m, due))}>
                    {methodLabel(m, lang)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            // Retouche C (décision du 30/09/2026) : dû nul (remise de 100 %, prestation offerte), aucun versement à saisir.
            <p className="text-sm text-muted-foreground">{t("caisse.rien_a_encaisser")}</p>
          )}
        </div>
        {/* Relecture, mineur 1 (retouche C) : à dû nul, ce bloc entier reste caché (titre, « Aucun versement
            pour l'instant. », « Reçu », « Reste à payer »), sous peine de contredire « Rien à encaisser ». */}
        {due > 0 && (
          <div className={cn("order-4 space-y-2 px-4 pt-3 @2xl:block @2xl:p-0", !plusieurs && "hidden")}>
            <h2 className="etiquette text-encre-grise">{t("caisse.versements")}</h2>
            {draft.entries.every((e) => e.amount === 0) ? (
              <p className="text-sm text-muted-foreground">{t("caisse.aucun_versement")}</p>
            ) : (
              <ul aria-label={t("caisse.versements")} className="divide-y divide-border border-b border-filet">
                {draft.entries.map((e, i) => e.amount > 0 && (
                  <li key={i} className={cn("flex min-h-12 items-center gap-3 py-1", draft.active === i && "font-medium")}>
                    <span className="min-w-0 flex-1">
                      <span className="block">{methodLabel(e.method, lang)}</span>
                      {e.reference && <span className="block truncate text-xs text-muted-foreground">{e.reference}</span>}
                      {s.invalid.includes(i) && <span className="block text-xs text-encre-rouge">{t("caisse.versement_trop")}</span>}
                    </span>
                    <span className="chiffres whitespace-nowrap text-lg">{formatAmount(e.amount, lang)}</span>
                    <Button variant="outline" size="icon" aria-label={t("caisse.retirer_versement", { moyen: methodLabel(e.method, lang) })} onClick={() => setDraft(removeEntry(draft, i))}>
                      <X aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <dl className="space-y-1 text-sm text-muted-foreground">
              <div className="flex justify-between gap-3"><dt>{t("caisse.recu")}</dt><dd className="chiffres-tabulaires text-base"><Montant valeur={formatPrice(s.received, lang)} /></dd></div>
              <div className="flex justify-between gap-3"><dt>{t("caisse.reste")}</dt><dd className={cn("chiffres-tabulaires text-base", s.remaining > 0 && "text-foreground")}><Montant valeur={formatPrice(s.remaining, lang)} /></dd></div>
            </dl>
          </div>
        )}
        {s.change > 0 && (
          // Tablette : en bas de la colonne de gauche (maquette). Colonne étroite (portrait) : le montant passe sous les coupures au lieu de les écraser.
          <div role="status" className="order-5 hidden flex-wrap items-end justify-between gap-x-4 gap-y-2 rounded-sm bg-primary p-6 text-primary-foreground @2xl:mt-auto @2xl:flex">
            <div className="min-w-[10rem] flex-1">
              <p className="etiquette">{t("caisse.a_rendre")}</p>
              <p className="mt-1 text-sm opacity-80">{changeText(s.change, lang)}</p>
            </div>
            <p className="chiffres ml-auto text-right font-serif text-4xl leading-none @5xl:text-5xl"><Montant valeur={formatPrice(s.change, lang)} /></p>
          </div>
        )}
      </section>

      <section className="contents @2xl:flex @2xl:min-h-0 @2xl:w-[24rem] @2xl:shrink-0 @2xl:flex-col @2xl:gap-3 @2xl:overflow-y-auto @2xl:border-l @2xl:border-filet @2xl:p-6">
        {/* Téléphone : libellé lu seulement (le moyen choisi est en ivoire juste au-dessus), comme la maquette. */}
        {/* Retouche C (décision du 30/09/2026) : dû nul, ni afficheur, ni montants rapides ou référence, ni pavé. */}
        {due > 0 && (
          <div className="order-6 space-y-2 px-4 pt-3 @2xl:p-0">
            <p id="caisse-saisie" className="etiquette sr-only text-encre-grise @2xl:not-sr-only">{libelleSaisie}</p>
            <output aria-labelledby="caisse-saisie" className="flex min-h-16 items-center justify-end rounded-sm border border-foreground px-4 font-serif text-4xl">
              <span className="chiffres">{saisiePave(current, lang)}</span>
            </output>
          </div>
        )}
        {due > 0 && (
          <div className="order-7 px-4 pt-2 @2xl:p-0">
            {cash ? (
              <div className="grid grid-cols-4 gap-2 @2xl:grid-cols-2">
                {cashSuggestions(draft, due).map((amount, i) => {
                  const exact = aroundAmount(t("caisse.montant_exact", { montant: formatAmount(amount, lang) }), formatAmount(amount, lang));
                  // Retouche P3 (critique du 1er octobre 2026) : au téléphone, le montant restait lisible dans
                  // l'afficheur juste au-dessus, mais le préréglage perdait le sien ; réintroduit, compacté.
                  const exactCourt = aroundAmount(t("caisse.exact_court", { montant: formatAmount(amount, lang) }), formatAmount(amount, lang));
                  return (
                    <button key={i} type="button" data-pave className={cn(moyen(active?.method === "cash" && active.amount === amount), "min-h-12 px-1")} onClick={() => setDraft(setTendered(draft, amount, due))}>
                      {i === 0 ? (
                        <>
                          <span className="text-xs leading-tight @2xl:hidden">{exactCourt[0]}<span className="chiffres">{exactCourt[1]}</span>{exactCourt[2]}</span>
                          <span className="hidden @2xl:inline">{exact[0]}<span className="chiffres text-lg">{exact[1]}</span>{exact[2]}</span>
                        </>
                      ) : <span className="chiffres text-lg">{formatAmount(amount, lang)}</span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="caisse-reference">{REFERENCE_REQUIRED.includes(current.method) ? t("caisse.reference_obligatoire") : t("caisse.reference")}</Label>
                <Input
                  id="caisse-reference"
                  value={current.reference}
                  maxLength={64}
                  disabled={draft.active === null}
                  onInput={(e: Event) => { if (draft.active !== null) setDraft(setReference(draft, draft.active, (e.currentTarget as HTMLInputElement).value)); }}
                />
              </div>
            )}
          </div>
        )}
        {due > 0 && (
          <div className="order-8 grid grid-cols-3 gap-1.5 px-4 pt-2 @2xl:gap-2 @2xl:p-0">
            {padKeys().map((k) => (
              <Button
                key={k}
                type="button"
                variant="outline"
                data-pave
                aria-label={k === "virgule" ? t("caisse.touche_virgule") : undefined}
                className={cn("h-16 border-filet px-1", k === "effacer" ? "text-sm" : "font-serif text-3xl")}
                onClick={() => setDraft(pressKey(draft, k, due))}
              >
                {k === "effacer" ? t("caisse.effacer") : k === "virgule" ? separateurDecimal(lang) : k}
              </Button>
            ))}
          </div>
        )}
        {/* Au téléphone, « Valider et émettre » reste en bas de l'écran ; « À rendre » juste au-dessus, dans un emplacement de hauteur fixe. */}
        <div className="sticky bottom-0 order-9 space-y-2 bg-background px-4 pb-2 pt-2 @2xl:static @2xl:mt-auto @2xl:bg-transparent @2xl:p-0">
          {settings.printer === true && (
            <Case id="caisse-imprimer" label={t("caisse.imprimer_ticket")} checked={printChoice} disabled={retourBloque} onChange={setPrintChoice} />
          )}
          {choice.offered && (
            <Case id="caisse-whatsapp" label={t("caisse.envoyer_whatsapp")} checked={whatsapp} disabled={retourBloque} onChange={setWhatsappChoice} />
          )}
          {error && (
            <div role="alert" className="space-y-2 rounded-sm border border-encre-rouge p-3 text-sm text-encre-rouge">
              <p>{error.message}</p>
              {error.retry && <p>{t("caisse.reessayer_aide")}</p>}
            </div>
          )}
          <div className="flex h-14 flex-col justify-center @2xl:hidden">
            {s.change > 0 ? (
              <div role="status" className="flex h-full items-center justify-between gap-3 rounded-sm bg-primary px-4 text-primary-foreground">
                <div className="min-w-0">
                  <p className="etiquette">{t("caisse.a_rendre")}</p>
                  <p className="truncate text-sm opacity-80">{changeText(s.change, lang, true)}</p>
                </div>
                <p className="chiffres shrink-0 font-serif text-3xl leading-none"><Montant valeur={formatPrice(s.change, lang)} /></p>
              </div>
            ) : stop && <p className="text-center text-sm text-muted-foreground">{blockerText(stop, s.remaining, lang)}</p>}
          </div>
          <Button className="h-16 w-full text-base" disabled={stop !== null || sending || checking} onClick={() => (error?.retry ? retry() : send())}>
            {checking ? t("caisse.verification") : sending ? t("caisse.emission") : error?.retry ? t("caisse.reessayer") : t("caisse.valider")}
          </Button>
          {/* Tablette : ce qui bloque sous le bouton ; au téléphone, seulement si « À rendre » occupe déjà l'emplacement (paiement mixte). */}
          {stop && <p className={cn("text-center text-sm text-muted-foreground", s.change > 0 ? "" : "hidden @2xl:block")}>{blockerText(stop, s.remaining, lang)}</p>}
        </div>
      </section>

      {approval && (
        <Approbation
          cap={settings.discount_cap ?? 0}
          discount={{ label: ticket.discount ? discountLabel(ticket.discount, lang) : "", amount: totals.discount_amount }}
          total={totals.total_ttc}
          refused={approval.refused}
          pending={sending}
          onApprove={(login, password) => send({ login, password })}
          onClose={() => setApproval(null)}
        />
      )}
    </div>
  );
}
