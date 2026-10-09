import { useState } from "preact/hooks";
import { api } from "../../api";
import type { OutboxReply } from "../../lib/api-types";
import { dateHeure, offlineText, outboxStatus, outboxType } from "../../lib/libelles";
import { useLoad } from "../../hooks/use-load";
import { useEnvoi } from "../../hooks/use-envoi";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Erreur } from "../champ";
import { Case, Rubrique } from "./elements";
import { cn } from "@/lib/utils";

/** Envois en attente ou en échec, avec leur raison (traduite par le serveur) et « Réessayer » (spec 2 § 4 et § 5). */
export function FileEnvoi() {
  const { t, lang } = useI18n();
  const { data, error: loadError, reload } = useLoad(() => api<OutboxReply>("GET", "/api/outbox"), ["outbox"], { reloadOnLang: true });
  const [tout, setTout] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Vague C (passe V 1.0) : un verrou par ligne ; un double appui ne relance pas deux fois (plus d'erreur « non relançable »).
  const envoi = useEnvoi();

  const relancer = async (id: number) => {
    setError(null);
    try {
      await envoi.lancer(String(id), async () => {
        await api("POST", `/api/outbox/${id}/retry`);
        await reload();
      });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const items = (data?.items ?? []).filter((i) => tout || i.status !== "sent");

  return (
    <Rubrique titre={t("reglages.rubrique.file_envoi")} description={t("file.description")}>
      {data && <p className="text-sm">{data.online ? t("file.internet_ok") : `${offlineText(data.pending, lang)}.`}</p>}
      <Erreur message={error ?? loadError} />
      <Case id="file-tout" label={t("file.tout")} checked={tout} onChange={setTout} />
      {data && items.length === 0 && <p className="text-sm text-encre-grise">{t("file.vide")}</p>}
      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colonne.envoi")}</TableHead><TableHead>{t("colonne.etat")}</TableHead><TableHead>{t("colonne.essais")}</TableHead>
              <TableHead>{t("colonne.prochain_essai")}</TableHead><TableHead>{t("colonne.derniere_erreur")}</TableHead><TableHead>{t("colonne.cree_le")}</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id} className="registre">
                <TableCell>{outboxType(i.kind, lang)}</TableCell>
                <TableCell className={cn(i.status === "failed" && "text-encre-rouge")}>{outboxStatus(i.status, lang, i.manual)}</TableCell>
                <TableCell className="chiffres-tabulaires">{i.attempts}</TableCell>
                <TableCell className="chiffres-tabulaires">{i.status === "pending" ? dateHeure(i.next_attempt_at, lang) : ""}</TableCell>
                <TableCell className="max-w-xs text-sm text-encre-grise">{i.last_error}</TableCell>
                <TableCell className="chiffres-tabulaires">{dateHeure(i.created_at, lang)}</TableCell>
                <TableCell className="text-right">
                  {i.status === "failed" && <Button size="sm" variant="outline" disabled={envoi.enCours(String(i.id))} onClick={() => void relancer(i.id)}>{t("etat.reessayer")}</Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Rubrique>
  );
}
