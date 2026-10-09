import { useState } from "preact/hooks";
import { Download, Printer } from "lucide-preact";
import { api, apiBlob, ApiError } from "../../api";
import { useLoad } from "../../hooks/use-load";
import type { SaleSettings } from "@/lib/caisse-types";
import { issueNotice, takeOutcome, type PrintKind, type PrintOutcome } from "@/lib/impression";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { invoiceSource, printsInFrame, type TicketSource } from "@/lib/ticket-pdf";

const FRAME_ID = "ticket-impression";
/** Les deux boutons du ticket : 48 px de haut au moins, texte sur deux lignes plutôt que coupé (retouche R2 vague 2). */
const BTN = "h-auto min-h-12 w-full gap-2 whitespace-normal text-center leading-tight";

/**
 * « Imprimer » et « Télécharger » le ticket PDF d'une facture ou d'un avoir
 * (§ 5.1), ou de tout autre ticket donné par `source` (clôture de caisse,
 * § 6.3). Avant
 * d'imprimer ou de télécharger, le PDF est demandé par la porte d'entrée
 * unique de l'API (`apiBlob`, jamais `fetch` ici) : un refus (facture
 * introuvable, panne de fabrication, réseau) affiche le message traduit du
 * serveur au lieu d'ouvrir un cadre ou un onglet sur une erreur brute.
 * Un succès imprime ou télécharge depuis une adresse d'objet, révoquée après
 * usage (après l'impression du cadre, ou l'ouverture de l'onglet sur iPhone
 * et iPad) ; le cadre caché de l'impression est retiré une fois utilisé.
 *
 * Impression directe (spec du 03/10/2026) : avec `direct` et une imprimante
 * réglée, « Imprimer » envoie le ticket à l'imprimante réseau par le serveur
 * (duplicata dès la deuxième fois) au lieu d'ouvrir le PDF ; `outcome` montre
 * le résultat de l'impression faite à l'émission (case « Imprimer le ticket »).
 */
export function BoutonsTicket({ invoice, source, className, direct, outcome }: {
  invoice?: { id: number; number: string }; source?: TicketSource; className?: string; direct?: { kind: PrintKind; id: number }; outcome?: PrintOutcome;
}) {
  const { t } = useI18n();
  const doc = source ?? invoiceSource(invoice!);
  // Lu une seule fois, au premier affichage : le résultat passé, ou celui gardé par le formulaire de l'avoir ou de l'acompte.
  const [notice] = useState(() => issueNotice(outcome ?? (direct ? takeOutcome(direct.kind, direct.id) : undefined)));
  const settings = useLoad(() => (direct ? api<SaleSettings>("GET", "/api/sales/settings") : Promise.resolve(null)), ["settings"]);
  const network = direct !== undefined && settings.data?.printer === true;
  const [done, setDone] = useState<string | null>(notice && "ok" in notice ? t(notice.ok) : null);
  const [error, setError] = useState<string | null>(notice && "error" in notice ? t("impression.non_imprime", { raison: notice.error }) : null);
  const [busy, setBusy] = useState<"imprimer" | "telecharger" | null>(null);

  const pdf = async (): Promise<Blob | null> => {
    setError(null);
    try {
      return await apiBlob(doc.path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("erreur.reseau"));
      return null;
    }
  };

  /** Impression directe : le serveur imprime, répond « duplicata » ou la raison de l'échec. */
  const printOnNetwork = async () => {
    setError(null);
    setDone(null);
    setBusy("imprimer");
    try {
      const res = await api<{ ok: true; duplicate: boolean }>("POST", "/api/print/documents", direct);
      setDone(t(res.duplicate ? "impression.duplicata_imprime" : "impression.imprime"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("erreur.reseau"));
    } finally {
      setBusy(null);
    }
  };

  const print = async () => {
    if (busy) return;
    if (network) return printOnNetwork();
    const ios = !printsInFrame(navigator.userAgent, navigator.maxTouchPoints);
    // Sur iPhone et iPad, l'onglet s'ouvre tout de suite, dans le geste du clic : ouvert après l'attente
    // du PDF, Safari le bloque en silence (sans « noopener », pour garder la poignée et lui donner l'adresse).
    const tab = ios ? window.open("", "_blank") : null;
    if (tab) tab.opener = null;
    setBusy("imprimer");
    const blob = await pdf();
    setBusy(null);
    if (!blob) {
      tab?.close();
      return;
    }
    const url = URL.createObjectURL(blob);
    if (ios) {
      if (tab) {
        tab.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        URL.revokeObjectURL(url);
      }
      return;
    }
    document.getElementById(FRAME_ID)?.remove();
    const frame = document.createElement("iframe");
    frame.id = FRAME_ID;
    frame.title = t("caisse.ticket_pdf");
    // Invisible mais rendu : un cadre `display: none` ne s'imprime pas partout.
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    frame.onload = () => {
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        URL.revokeObjectURL(url);
        frame.remove();
      };
      try {
        frame.contentWindow?.focus();
        // Nettoyage à la fin de l'impression, pas au chargement du cadre (Firefox n'attend pas la fin
        // de l'impression pour revenir de `print()`, une révocation immédiate viderait la boîte encore ouverte).
        frame.contentWindow?.addEventListener("afterprint", cleanup);
        frame.contentWindow?.print();
      } catch {
        // Adresse encore valide : jamais révoquée avant l'ouverture du repli.
        window.open(url, "_blank", "noopener");
      } finally {
        // Filet de sécurité si « afterprint » ne survient jamais.
        setTimeout(cleanup, 60000);
      }
    };
    frame.src = url;
    document.body.appendChild(frame);
  };

  const download = async () => {
    if (busy) return;
    setBusy("telecharger");
    const blob = await pdf();
    setBusy(null);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" className={BTN} onClick={print} disabled={busy !== null} aria-busy={busy === "imprimer" ? "true" : undefined}>
          <Printer className="h-4 w-4" aria-hidden="true" />
          {busy === "imprimer" ? t("caisse.preparation_ticket") : t("caisse.imprimer")}
        </Button>
        <Button type="button" variant="outline" className={BTN} onClick={download} disabled={busy !== null} aria-busy={busy === "telecharger" ? "true" : undefined}>
          <Download className="h-4 w-4" aria-hidden="true" />
          {busy === "telecharger" ? t("caisse.preparation_ticket") : t("caisse.telecharger")}
        </Button>
      </div>
      {/* Le bouton désactivé n'est pas annoncé : la zone d'état lit « Préparation du ticket… » (report de la vague 2). */}
      <p role="status" className="sr-only">{busy ? t("caisse.preparation_ticket") : ""}</p>
      {done && <p role="status" className="mt-2 text-sm text-muted-foreground">{done}</p>}
      {error && (
        <p role="alert" className="mt-2 rounded-sm border border-encre-rouge p-2 text-sm text-encre-rouge">
          {error}
        </p>
      )}
    </div>
  );
}
