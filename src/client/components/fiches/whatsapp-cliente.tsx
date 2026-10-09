import { useState } from "preact/hooks";
import { api } from "../../api";
import { useApp } from "../../context";
import { useEnvoi } from "../../hooks/use-envoi";
import type { Client } from "../../types";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Erreur, Succes } from "../champ";
import { SELECT } from "../reglages/elements";
import { FenetreEnvoiProduit } from "../produits/envoi-produit";

/**
 * Messages sur la fiche cliente (sous-projet 7 § 2 et § 3), réception et
 * gérante : canal des messages (WhatsApp, SMS, aucun), langue de ses
 * messages, message libre envoyé un à un. Images des produits : « Joindre un
 * produit » (photo et message prérempli).
 */
const CHANNELS = [["whatsapp", "cliente.canal.whatsapp"], ["sms", "cliente.canal.sms"], ["none", "cliente.canal.aucun"]] as const;

export function WhatsappCliente({ client }: { client: Client }) {
  const { updateClient } = useApp();
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [joindre, setJoindre] = useState(false);
  // Vague C (passe V 1.0) : canal et langue grisés pendant l'enregistrement ; un double appui ne part qu'une fois.
  const preference = useEnvoi();

  const change = async (data: Partial<Client>) => {
    setError(null);
    setOk(null);
    try {
      await preference.lancer("preference", () => updateClient(client.id, data));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const send = async () => {
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      await api("POST", `/api/clients/${client.id}/whatsapp`, { text });
      setText("");
      setOk(t("cliente.message_en_file"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const hasPhone = Boolean(client.phone.trim());
  return (
    <section className="space-y-3 border-t border-filet pt-4">
      <h3 className="etiquette text-encre-grise">{t("cliente.messages")}</h3>
      <div className="space-y-1.5">
        <p id={`canal-${client.id}`} className="etiquette leading-snug text-encre-grise">{t("cliente.canal")}</p>
        <div role="group" aria-labelledby={`canal-${client.id}`} className="flex flex-wrap gap-2">
          {CHANNELS.map(([value, key]) => (
            <Button key={value} type="button" variant={client.channel === value ? "default" : "outline"} className="min-h-11" aria-pressed={client.channel === value} disabled={preference.occupe} onClick={() => void change({ channel: value })}>
              {t(key)}
            </Button>
          ))}
        </div>
        {client.channel === "whatsapp" && <p className="text-xs text-muted-foreground">{t("cliente.canal.whatsapp_aide")}</p>}
        {client.channel === "sms" && <p className="text-xs text-muted-foreground">{t("cliente.canal.sms_aide")}</p>}
      </div>
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor={`whatsapp-langue-${client.id}`}>{t("cliente.langue_messages")}</Label>
        <select id={`whatsapp-langue-${client.id}`} className={SELECT} disabled={preference.occupe} value={client.language} onChange={(e) => void change({ language: (e.currentTarget as HTMLSelectElement).value as Client["language"] })}>
          <option value="">{t("cliente.langue_institut")}</option>
          <option value="fr">{t("langue.nom.fr")}</option>
          <option value="en">{t("langue.nom.en")}</option>
        </select>
      </div>
      {hasPhone ? (
        <div className="space-y-2">
          <Label htmlFor={`whatsapp-message-${client.id}`}>{t("cliente.message_whatsapp")}</Label>
          <Textarea id={`whatsapp-message-${client.id}`} rows={3} maxLength={1000} value={text} onInput={(e: Event) => setText((e.currentTarget as HTMLTextAreaElement).value)} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || !text.trim()} onClick={() => void send()}>{t("cliente.envoyer_whatsapp")}</Button>
            <Button variant="outline" onClick={() => setJoindre(true)}>{t("whatsapp.joindre_produit")}</Button>
          </div>
          {joindre && <FenetreEnvoiProduit clientId={client.id} onClose={() => setJoindre(false)} />}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("cliente.sans_numero_whatsapp")}</p>
      )}
      <Erreur message={error} />
      <Succes message={ok} />
    </section>
  );
}
