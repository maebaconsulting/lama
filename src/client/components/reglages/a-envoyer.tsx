import { useState } from "preact/hooks";
import { api, apiBlob, ApiError } from "../../api";
import { dateHeure } from "../../lib/libelles";
import { documentPdfPath, manualAttachment, manualOpenKey, manualTypeLabel, smsLink, waLink, type ManualItem, type MessageDocument, type MessageProduct } from "../../lib/whatsapp";
import { photoFileName, productImageUrl } from "../../lib/produits";
import { useLoad } from "../../hooks/use-load";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Erreur } from "../champ";
import { Rubrique } from "./elements";

/**
 * « À envoyer à la main » (sous-projet 7 § 3) : messages WhatsApp abandonnés
 * ou sans fournisseur, pour la réception et la gérante. « Ouvrir WhatsApp »
 * (lien wa.me, message prérempli), puis « Marquer comme envoyé » ou « Ignorer ».
 * Vague 2 : « Ouvrir WhatsApp » suspend d'abord l'envoi automatique d'un
 * message encore en attente (pas de double envoi), et n'ouvre rien si la
 * file est justement en train de l'envoyer. Ticket, avoir ou reçu : le PDF
 * est d'abord téléchargé, la réception le joint dans la conversation.
 * Images des produits : un produit avec photo propose « Télécharger la photo
 * et ouvrir WhatsApp », jamais les SMS.
 */
export function AEnvoyer() {
  const { t, lang } = useI18n();
  const { data, error: loadError, reload } = useLoad(() => api<{ items: ManualItem[] }>("GET", "/api/whatsapp/manual"), ["outbox"], { reloadOnLang: true });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const resolve = async (id: number, action: "sent" | "ignored") => {
    setError(null);
    setBusy(id);
    try {
      await api("POST", `/api/whatsapp/manual/${id}`, { action });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** Enregistre un fichier téléchargé sous le nom donné. */
  const save = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** PDF du document, téléchargé sous son numéro (même adresse que « Télécharger »). */
  const download = async (doc: MessageDocument) => save(await apiBlob(documentPdfPath(doc)), `${doc.number}.pdf`);

  /** Photo du produit (images des produits), téléchargée sous le nom du produit (même adresse que la vignette). */
  const downloadPhoto = async (product: MessageProduct) => {
    const blob = await apiBlob(productImageUrl(product)!);
    save(blob, photoFileName(product.name, blob.type));
  };

  /**
   * L'onglet s'ouvre tout de suite, dans le geste du clic (ouvert après
   * l'attente, Safari le bloque en silence), puis reçoit le lien wa.me une
   * fois l'envoi automatique suspendu par le serveur ; refus (message en
   * train de partir, déjà traité) : l'onglet vide se referme et la raison
   * s'affiche.
   */
  const open = async (item: ManualItem) => {
    if (busy !== null) return;
    setError(null);
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    setBusy(item.id);
    try {
      await api("POST", `/api/whatsapp/manual/${item.id}/open`);
      if (item.document) await download(item.document);
      else if (manualAttachment(item) === "photo") await downloadPhoto(item.product!);
      const link = waLink(item.to, item.text);
      if (tab) tab.location.href = link;
      else window.location.assign(link);
    } catch (err) {
      tab?.close();
      setError(err instanceof ApiError ? err.message : t("erreur.reseau"));
    } finally {
      setBusy(null);
      await reload();
    }
  };

  /** « Ouvrir les SMS » : même suspension de l'envoi automatique, puis l'appli SMS de la tablette s'ouvre (lien sms:, même onglet). */
  const openSms = async (item: ManualItem) => {
    if (busy !== null) return;
    setError(null);
    setBusy(item.id);
    try {
      await api("POST", `/api/whatsapp/manual/${item.id}/open`);
      window.location.assign(smsLink(item.to, item.text));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("erreur.reseau"));
    } finally {
      setBusy(null);
      await reload();
    }
  };

  return (
    <Rubrique titre={t("reglages.rubrique.a_envoyer")} description={t("a_envoyer.description")}>
      <Erreur message={error ?? loadError} />
      {data && data.items.length === 0 && <p className="text-sm text-encre-grise">{t("a_envoyer.vide")}</p>}
      {data && data.items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {data.items.map((item) => (
            <li key={item.id} className="space-y-3 rounded-sm border border-filet bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="font-medium">{item.client_name}</p>
                <p className="chiffres-tabulaires text-xs text-muted-foreground">{manualTypeLabel(item.type, lang)} · {dateHeure(item.created_at, lang)}</p>
              </div>
              <p className="whitespace-pre-line text-sm">{item.text}</p>
              <p className="text-xs text-encre-rouge">{t("a_envoyer.raison", { raison: item.reason })}</p>
              {item.document && <p className="text-xs text-muted-foreground">{t("a_envoyer.joindre", { numero: item.document.number })}</p>}
              {manualAttachment(item) === "photo" && <p className="text-xs text-muted-foreground">{t("a_envoyer.joindre_photo")}</p>}
              <div className="flex flex-wrap gap-2">
                <Button className="min-h-11" disabled={busy === item.id} onClick={() => void open(item)}>{t(manualOpenKey(item))}</Button>
                {manualAttachment(item) === null && item.to && <Button variant="outline" className="min-h-11" disabled={busy === item.id} onClick={() => void openSms(item)}>{t("a_envoyer.ouvrir_sms")}</Button>}
                <Button variant="outline" className="min-h-11" disabled={busy === item.id} onClick={() => void resolve(item.id, "sent")}>{t("a_envoyer.envoye")}</Button>
                <Button variant="ghost" className="min-h-11" disabled={busy === item.id} onClick={() => void resolve(item.id, "ignored")}>{t("a_envoyer.ignorer")}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Rubrique>
  );
}
