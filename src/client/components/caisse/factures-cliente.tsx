import { api } from "../../api";
import { useApp } from "../../context";
import { useLoad } from "../../hooks/use-load";
import { useI18n } from "@/i18n/provider";
import { signedPrice } from "@/lib/caisse-jour";
import type { InvoiceSummary } from "@/lib/caisse-types";
import { formatInstant, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EtatErreur, Montant } from "../comptoir";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Factures et avoirs d'une cliente, du plus récent au plus ancien (sous-projet
 * 5 § 6.1), dans sa fiche : c'est de là qu'une facture d'un autre jour se
 * retrouve pour un avoir. Chaque document s'ouvre dans le panneau ; un avoir
 * s'écrit en négatif, une facture reprise le dit. Gérante et réception
 * seulement (la fiche ne monte ce bloc que pour elles).
 */
export function FacturesCliente({ clientId }: { clientId: number }) {
  const { openPanel } = useApp();
  const { t, lang } = useI18n();
  const loaded = useLoad(() => api<{ invoices: InvoiceSummary[] }>("GET", `/api/invoices?client_id=${clientId}`).then((r) => r.invoices), ["invoices"]);
  const docs = loaded.data;
  return (
    <section className="space-y-2 border-t border-filet pt-4">
      <h3 className="etiquette text-encre-grise">{t("cliente.factures")}</h3>
      {loaded.error && !docs ? <EtatErreur message={loaded.error} onRetry={loaded.reload} /> : !docs ? null : docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("cliente.aucune_facture")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-sm border border-filet bg-card">
          {docs.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => openPanel("invoice", d.id)} className={cn("flex min-h-12 w-full items-start justify-between gap-3 p-3 text-left transition-colors duration-200 hover:bg-muted", FOCUS)}>
                <span className="min-w-0 space-y-0.5">
                  <span className="chiffres block font-medium">{d.number}</span>
                  <span className="block text-sm text-muted-foreground">
                    {formatInstant(d.issued_at, lang)}
                    {d.kind === "credit_note" && d.credited_number ? ` · ${t("caisse_jour.avoir_de", { numero: d.credited_number })}` : ""}
                  </span>
                  {d.kind === "invoice" && d.credited_total > 0 && (
                    <span className="block text-sm text-muted-foreground">
                      {d.cancelled === 1 ? t("facture.reprise_entiere") : t("facture.reprise_partielle", { montant: formatPrice(d.credited_total, lang) })}
                    </span>
                  )}
                </span>
                <span className="chiffres whitespace-nowrap"><Montant valeur={d.kind === "credit_note" ? signedPrice(-d.total_ttc, lang) : formatPrice(d.total_ttc, lang)} /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
