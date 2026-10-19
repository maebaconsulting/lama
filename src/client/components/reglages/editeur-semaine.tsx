import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { avecPause, JOURS, type Jour, type Plage, type Semaine } from "../../../shared/horaires";
import { ChampHeure } from "../champ-date";

/** « 09:00–12:00, 13:00–19:00 », ou le libellé du jour vide (« Fermé », « Repos »). */
export function resumeJour(plages: Plage[], vide: string): string {
  return plages.length ? plages.map(([a, b]) => `${a}–${b}`).join(", ") : vide;
}

/**
 * Éditeur d'une semaine (spec du 16/10/2026 § 4.1), pour l'institut (`vide` = « Fermé »)
 * comme pour une praticienne (« Repos ») : une case par jour, une plage, et une pause
 * de midi facultative (deux plages au plus).
 */
export function EditeurSemaine({ id, valeur, onChange, vide }: { id: string; valeur: Semaine; onChange: (s: Semaine) => void; vide: "ferme" | "repos" }) {
  const { t } = useI18n();
  const setJour = (j: Jour, plages: Plage[]) => onChange({ ...valeur, [j]: plages });
  return (
    <div className="space-y-3">
      {JOURS.map((j) => {
        const plages = valeur[j];
        const ouvert = plages.length > 0;
        const nom = t(`jour.${j}`);
        const change = (i: number, bord: 0 | 1) => (v: string) =>
          setJour(j, plages.map((p, k) => (k === i ? (bord === 0 ? [v, p[1]] : [p[0], v]) : p)) as Plage[]);
        return (
          <div key={j} className="grid gap-2 border-b border-filet pb-3 @md:grid-cols-[8rem_1fr]">
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input id={`${id}-${j}`} type="checkbox" checked={ouvert} onChange={() => setJour(j, ouvert ? [] : [["09:00", "19:00"]])} />
              {nom}
            </label>
            {ouvert ? (
              <div className="flex flex-wrap items-center gap-2">
                {plages.map((p, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <ChampHeure id={`${id}-${j}-${i}-debut`} aria-label={t("horaires.debut", { jour: nom })} value={p[0]} onValue={change(i, 0)} />
                    <span aria-hidden="true">–</span>
                    <ChampHeure id={`${id}-${j}-${i}-fin`} borne="fin" aria-label={t("horaires.fin", { jour: nom })} value={p[1]} onValue={change(i, 1)} />
                  </span>
                ))}
                {plages.length === 1 ? (
                  <Button type="button" variant="outline" disabled={avecPause(plages[0]).length === 1} onClick={() => setJour(j, avecPause(plages[0]))}>{t("horaires.ajouter_pause")}</Button>
                ) : (
                  <Button type="button" variant="outline" onClick={() => setJour(j, [[plages[0][0], plages[1][1]]])}>{t("horaires.retirer_pause")}</Button>
                )}
              </div>
            ) : (
              <p className="flex min-h-11 items-center text-sm text-muted-foreground">{t(vide === "ferme" ? "horaires.ferme" : "horaires.repos")}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
