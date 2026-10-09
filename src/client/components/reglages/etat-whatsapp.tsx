import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import { useAuth } from "../../auth-context";
import { useLoad } from "../../hooks/use-load";
import { canLinkWhatsapp } from "../../lib/roles";
import { statusAlarming, statusText, type WhatsappStatus } from "../../lib/whatsapp";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { BoutonDestructif } from "../comptoir";
import { Erreur } from "../champ";

const POLL_MS = 5000;

/**
 * État de la session WhatsApp (sous-projet 7 § 4) : connecté avec le numéro,
 * QR code à scanner (relayé par lama, jamais demandé à WAHA par le
 * navigateur), session arrêtée, passerelle injoignable. « Démarrer la
 * session » et « Se déconnecter » pour l'administrateur et la gérante.
 */
export function EtatWhatsapp() {
  const { account } = useAuth();
  const { t, lang } = useI18n();
  const status = useLoad(() => api<WhatsappStatus>("GET", "/api/whatsapp/status"), ["outbox", "settings"]);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const state = status.data?.state;

  // QR à scanner ou session qui démarre : état (et QR) relus toutes les 5 s, le QR de WhatsApp changeant toutes les 20 s environ.
  useEffect(() => {
    if (state !== "qr" && state !== "demarrage") {
      setQr(null);
      return;
    }
    let live = true;
    const refresh = async () => {
      if (state === "qr") {
        try {
          const reply = await api<{ image: string }>("GET", "/api/whatsapp/qr");
          if (live) setQr(reply.image);
        } catch {
          if (live) setQr(null);
        }
      }
      if (live) await status.reload();
    };
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (path: string) => {
    setError(null);
    setBusy(true);
    try {
      await api("POST", path);
      await status.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!status.data) return <Erreur message={status.error} />;
  const commands = status.data.provider === "waha" && canLinkWhatsapp(account.role);
  return (
    <div className="space-y-4">
      <p role="status" className={statusAlarming(status.data) ? "text-sm text-encre-rouge" : "text-sm"}>{statusText(status.data, lang)}</p>
      {qr && state === "qr" && (
        <figure className="space-y-2">
          <img src={qr} alt={t("whatsapp.qr_alt")} width={240} height={240} className="h-60 w-60 rounded-sm border border-filet bg-white p-3 [image-rendering:pixelated]" />
          <figcaption className="max-w-prose text-xs text-muted-foreground">{t("whatsapp.qr_aide")}</figcaption>
        </figure>
      )}
      <Erreur message={error ?? status.error} />
      {commands && (state === "deconnecte" || state === "erreur") && (
        <div><Button disabled={busy} onClick={() => void run("/api/whatsapp/session/start")}>{t("whatsapp.demarrer")}</Button></div>
      )}
      {commands && (state === "connecte" || state === "qr") && (
        <BoutonDestructif libelle={t("whatsapp.deconnecter")} question={t("whatsapp.deconnecter_question")} disabled={busy} onConfirm={() => run("/api/whatsapp/session/logout")} />
      )}
    </div>
  );
}
