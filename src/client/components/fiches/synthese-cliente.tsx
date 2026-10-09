import { useI18n } from "@/i18n/provider";
import { pickText } from "@/lib/bilingual";
import { keyFigures } from "@/lib/crm";
import { formatInstantDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClientSummary } from "../../types";
import { ChiffreCle } from "../comptoir";
import { LigneDetail, PastilleEncre } from "./corps-fiche";

/**
 * Chiffres clés et habitudes de la fiche (mini CRM § 1, Écran 3 et 4) :
 * tuiles en deux colonnes au téléphone, sur une ligne quand le panneau est
 * large ; la praticienne ne voit que les visites (le serveur retire les
 * montants). Habitudes : prestations habituelles, praticienne préférée,
 * achats ; la section disparaît quand il n'y a rien à dire.
 */
export function SyntheseCliente({ summary }: { summary: ClientSummary }) {
  const { t, tn, lang } = useI18n();
  const figures = keyFigures(summary, lang);
  const columns = figures.length >= 4 ? "@lg:grid-cols-4" : figures.length === 3 ? "@lg:grid-cols-3" : "";
  const habits = summary.usual_services.length > 0 || summary.favorite_staff !== null || summary.products.length > 0;
  return (
    <>
      <section aria-label={t("crm.chiffres")} className={cn("grid grid-cols-2 gap-2", columns)}>
        {figures.map((f) => <ChiffreCle key={f.id} valeur={f.value} libelle={f.label} />)}
      </section>

      {habits && (
        <section className="space-y-3 border-t border-filet pt-4">
          <h3 className="etiquette text-encre-grise">{t("crm.habitudes")}</h3>
          <dl className="grid gap-4 @md:grid-cols-2">
            {summary.usual_services.length > 0 && (
              <LigneDetail libelle={t("crm.prestations_habituelles")}>
                <ul className="space-y-0.5">
                  {summary.usual_services.map((s) => (
                    <li key={s.name}>{t("crm.fois", { nom: pickText(lang, s.name, s.name_en), count: s.count })}</li>
                  ))}
                </ul>
              </LigneDetail>
            )}
            {summary.favorite_staff && (
              <LigneDetail libelle={t("crm.praticienne_preferee")}>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                  <PastilleEncre color={summary.favorite_staff.color} />
                  <span>{summary.favorite_staff.name}</span>
                  <span className="text-muted-foreground">{tn("crm.visites_avec", summary.favorite_staff.count)}</span>
                </span>
              </LigneDetail>
            )}
            {summary.products.length > 0 && (
              <div className="@md:col-span-2">
                <LigneDetail libelle={t("crm.achats")}>
                  <ul className="space-y-0.5">
                    {summary.products.map((p) => (
                      <li key={p.label_fr}>
                        {t("crm.achat_dernier", { produit: pickText(lang, p.label_fr, p.label_en), count: p.quantity, date: formatInstantDate(p.last, lang) })}
                      </li>
                    ))}
                  </ul>
                </LigneDetail>
              </div>
            )}
          </dl>
        </section>
      )}
    </>
  );
}
