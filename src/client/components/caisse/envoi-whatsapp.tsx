import { useState } from "preact/hooks";
import { MessageCircle } from "lucide-preact";
import { api, ApiError } from "../../api";
import { useAuth } from "../../auth-context";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { canSeeManual } from "@/lib/roles";
import type { DocumentKind } from "@/lib/whatsapp";
import { Erreur, Succes } from "../champ";

/**
 * « Envoyer par WhatsApp » une facture (ticket), un avoir ou un reçu
 * d'acompte (sous-projet 7, vague 2), pour la réception et la gérante : le
 * document est mis en file, son PDF sera produit au moment de l'envoi ; sans
 * fournisseur ou en échec, il ira dans « À envoyer à la main ». `queued` :
 * case cochée à l'encaissement, `true` mis en file, `false` refusé (le bouton
 * reste pour réessayer), absent si la case n'était pas cochée. Une fois le
 * document en file, le bouton devient « Renvoyer » : chaque appui envoie un PDF.
 */
export function EnvoiWhatsapp({ kind, id, queued }: { kind: DocumentKind; id: number; queued?: boolean }) {
  const { account } = useAuth();
  const { t } = useI18n();
  const [ok, setOk] = useState<string | null>(queued === true ? t("whatsapp.document_en_file") : null);
  const [error, setError] = useState<string | null>(queued === false ? t("whatsapp.document_non_mis_en_file") : null);
  const [busy, setBusy] = useState(false);
  if (!canSeeManual(account.role)) return null;

  const send = async () => {
    if (busy) return;
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      await api("POST", "/api/whatsapp/documents", { kind, id });
      setOk(t("whatsapp.document_en_file"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("erreur.reseau"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className="h-auto min-h-12 w-full gap-2 whitespace-normal leading-tight" disabled={busy} onClick={() => void send()}>
        <MessageCircle className="h-4 w-4" aria-hidden="true" />
        {t(ok ? "whatsapp.renvoyer_document" : "whatsapp.envoyer_document")}
      </Button>
      <Succes message={ok} />
      <Erreur message={error} />
    </div>
  );
}
