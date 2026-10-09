import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../../api";
import { useApp } from "../../context";
import { useAuth } from "../../auth-context";
import { useLoad } from "../../hooks/use-load";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/provider";
import { correctionValue, entryText, nextTierText, pointsText, signedPoints, type LoyaltyEntry } from "@/lib/fidelite";
import { formatInstantDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Erreur } from "../champ";

type Loyalty = { balance: number; next_tier: { points: number; montant: number; missing: number } | null };

/**
 * Bloc « Fidélité » de la fiche cliente (mini CRM § 2) : rien si la synthèse
 * n'a pas de fidélité (fidélité inactive, praticienne : le serveur rend
 * `loyalty: null`). À monter avec `key={client.id}` : les écritures sont
 * chargées une fois par cliente, puis à chaque signal temps réel.
 */
export function FideliteCliente({ clientId }: { clientId: number }) {
  const { selectedClientSummary } = useApp();
  const loyalty = selectedClientSummary?.loyalty ?? null;
  return loyalty ? <BlocFidelite clientId={clientId} loyalty={loyalty} /> : null;
}

/** Solde, prochain palier, vingt dernières écritures ; « Corriger les points » pour la gérante. */
function BlocFidelite({ clientId, loyalty }: { clientId: number; loyalty: Loyalty }) {
  const { selectClient } = useApp();
  const { account } = useAuth();
  const { t, lang } = useI18n();
  const [correcting, setCorrecting] = useState(false);
  const read = useLoad(() => api<{ balance: number; entries: LoyaltyEntry[] }>("GET", `/api/clients/${clientId}/loyalty`), ["invoices", "selectedClient"]);
  const balance = read.data?.balance ?? loyalty.balance;
  // Solde du registre différent de celui de la synthèse (correction, vente) : on relit la fiche pour le palier et la tuile.
  useEffect(() => {
    if (read.data && read.data.balance !== loyalty.balance) void selectClient(clientId);
  }, [read.data?.balance, loyalty.balance, clientId]);
  return (
    <section className="space-y-3 border-t border-filet pt-4">
      <h3 className="etiquette text-encre-grise">{t("fidelite.titre")}</h3>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="chiffres text-2xl">{pointsText(balance, lang)}</p>
        <p className="text-sm text-muted-foreground">{nextTierText(loyalty.next_tier, lang)}</p>
      </div>
      <Erreur message={read.error} />
      {read.data && read.data.entries.length === 0 && <p className="text-sm text-muted-foreground">{t("fidelite.aucune_ecriture")}</p>}
      {read.data && read.data.entries.length > 0 && (
        <ul aria-label={t("fidelite.ecritures")} className="divide-y divide-border rounded-sm border border-filet bg-card">
          {read.data.entries.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 p-3 text-sm">
              <span className="min-w-0 space-y-0.5">
                <span className="block text-xs text-muted-foreground">{formatInstantDate(e.created_at, lang)}</span>
                <span className="block break-words">{entryText(e, lang)}</span>
              </span>
              <span className={cn("chiffres shrink-0 whitespace-nowrap", e.points < 0 && "text-encre-grise")}>{signedPoints(e.points, lang)}</span>
            </li>
          ))}
        </ul>
      )}
      {account.role === "manager" && <Button variant="outline" className="min-h-11" onClick={() => setCorrecting(true)}>{t("fidelite.corriger")}</Button>}
      {correcting && (
        <FenetreCorrection clientId={clientId} balance={balance} onClose={() => setCorrecting(false)} onDone={() => { setCorrecting(false); void read.reload(); void selectClient(clientId); }} />
      )}
    </section>
  );
}

/**
 * Correction à la main (décision 18) : ajouter ou retirer des points, motif
 * obligatoire ; nouveau solde montré avant. Écriture immuable sans clé
 * d'idempotence : garde synchrone `sending` contre le double envoi.
 */
function FenetreCorrection({ clientId, balance, onDone, onClose }: { clientId: number; balance: number; onDone: () => void; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [direction, setDirection] = useState<"ajouter" | "retirer">("ajouter");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const formId = `fidelite-correction-${clientId}`;
  const value = correctionValue(direction, text, note);
  const preview = "points" in value ? balance + value.points : null;
  const submit = async () => {
    if (sending.current) return;
    sending.current = true;
    if ("error" in value) {
      sending.current = false;
      setError(t(value.error));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/api/clients/${clientId}/loyalty`, value);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("fidelite.corriger")}</DialogTitle>
          <DialogDescription>{t("fidelite.corriger_aide")}</DialogDescription>
        </DialogHeader>
        <form id={formId} className="space-y-4" onSubmit={(e: Event) => { e.preventDefault(); void submit(); }}>
          <div role="group" aria-label={t("fidelite.sens")} className="grid grid-cols-2 gap-2">
            {(["ajouter", "retirer"] as const).map((d) => (
              <Button key={d} type="button" variant={direction === d ? "default" : "outline"} className="min-h-12" aria-pressed={direction === d} onClick={() => { setError(null); setDirection(d); }}>
                {t(d === "ajouter" ? "fidelite.ajouter" : "fidelite.retirer_points")}
              </Button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`fidelite-nombre-${clientId}`}>{t("fidelite.nombre_points")}</Label>
            <Input id={`fidelite-nombre-${clientId}`} type="text" inputMode="numeric" autoComplete="off" value={text} onInput={(e: Event) => { setError(null); setText((e.currentTarget as HTMLInputElement).value); }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`fidelite-motif-${clientId}`}>{t("fidelite.motif")}</Label>
            <Input id={`fidelite-motif-${clientId}`} maxLength={200} value={note} onInput={(e: Event) => { setError(null); setNote((e.currentTarget as HTMLInputElement).value); }} />
          </div>
          {preview !== null && <p className="text-sm" aria-live="polite">{t("fidelite.apercu_correction", { solde: pointsText(preview, lang) })}</p>}
          <Erreur message={error} />
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t("commun.annuler")}</Button>
          <Button type="submit" form={formId} disabled={busy}>{busy ? t("commun.enregistrement") : t("commun.enregistrer")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
