import { api } from "../../api";
import type { CampaignRow } from "../../lib/campagnes";
import { dateHeure } from "../../lib/libelles";
import { useLoad } from "../../hooks/use-load";
import { useI18n } from "@/i18n/provider";
import { Erreur } from "../champ";
import { Bloc } from "./elements";

/**
 * Liste des campagnes de la rubrique Messages (mini CRM, décision 27) :
 * les vingt dernières, la plus récente d'abord, avec leurs envois partis,
 * en attente et à envoyer à la main, rechargée quand la file change.
 */
export function Campagnes() {
  const { t, tn, lang } = useI18n();
  const { data, error } = useLoad(() => api<{ campaigns: CampaignRow[] }>("GET", "/api/campaigns"), ["outbox"]);
  return (
    <Bloc titre={t("campagnes.titre")}>
      <p className="max-w-prose text-sm text-encre-grise">{t("campagnes.aide")}</p>
      <Erreur message={error} />
      {data && data.campaigns.length === 0 && <p className="text-sm text-muted-foreground">{t("campagnes.aucune")}</p>}
      {data && data.campaigns.length > 0 && (
        <ul className="max-w-2xl divide-y divide-border rounded-sm border border-filet">
          {data.campaigns.map((c) => (
            <li key={c.id} className="space-y-1 px-3 py-3">
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{c.tag}</span>
                <span className="chiffres-tabulaires text-xs text-muted-foreground">{dateHeure(c.created_at, lang)}</span>
              </p>
              <p className="line-clamp-2 text-sm text-encre-grise">{c.text_fr}</p>
              <p className="chiffres-tabulaires text-xs text-muted-foreground">
                {tn("campagne.destinataires", c.recipients)} · {tn("campagnes.exclues", c.excluded)} · {t("campagnes.envois", { sent: c.sent, pending: c.pending, manual: c.manual })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Bloc>
  );
}
