import { useEffect, useRef, useState } from "preact/hooks";
import { Check, Plus, X } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/provider";
import { formatPrice } from "@/lib/format";
import { addLibre, choicesFor, isChosen, quantityFromText, removeDraft, setDraftQuantity, toggleChoice, type DraftSupplement } from "@/lib/supplements";
import { cn } from "@/lib/utils";
import type { Product, Service } from "../../types";
import { ChampsLibre } from "./libre";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Quantité d'un produit en supplément : texte local, vidable pour retaper, borné de 1 à 99 en quittant le champ. */
function ChampQuantite({ label, value, onChange }: { label: string; value: number; onChange: (quantity: number) => void }) {
  const [text, setText] = useState(String(value));
  return (
    <Input
      type="number" min="1" max="99" className="w-16" aria-label={label} value={text}
      onInput={(e: Event) => {
        const next = (e.currentTarget as HTMLInputElement).value;
        setText(next);
        const q = quantityFromText(next, value, false);
        if (q !== null && q !== value) onChange(q);
      }}
      onBlur={() => {
        const q = quantityFromText(text, value, true) as number;
        setText(String(q));
        if (q !== value) onChange(q);
      }}
    />
  );
}

/**
 * Suppléments sous une prestation d'un rendez-vous (spec du 18/10/2026 § 3.3) : on coche les
 * suppléments possibles (quantité pour un produit) ; « Supplément libre » ajoute une demande
 * hors catalogue avec ses minutes. Un article déjà posé mais qui n'est plus proposé (liste
 * changée, article désactivé) reste visible et retirable. Rend la nouvelle liste par `onChange`.
 */
export function ChoixSupplements({ serviceId, nom, list, catalog, onChange }: {
  serviceId: number;
  nom: string;
  list: DraftSupplement[];
  catalog: { services: Service[]; products: Product[] };
  onChange: (next: DraftSupplement[]) => void;
}) {
  const { t, lang } = useI18n();
  const [libre, setLibre] = useState(false);
  const saisie = useRef<HTMLDivElement>(null);
  // À l'ouverture de la saisie libre, le curseur va au libellé.
  useEffect(() => { if (libre) saisie.current?.querySelector("input")?.focus(); }, [libre]);
  const choix = choicesFor(serviceId, catalog, lang);
  const propose = (d: DraftSupplement) => choix.some((c) => c.kind === d.kind && c.ref_id === d.ref_id);
  return (
    <fieldset className="min-w-0 space-y-2 border-l border-filet pl-3">
      <legend className="text-sm text-encre-grise">{t("rdv.supplements_de", { nom })}</legend>
      {choix.length > 0 && (
        <ul className="divide-y divide-border rounded-sm border border-filet">
          {choix.map((c) => {
            const on = isChosen(list, c);
            const at = list.findIndex((d) => d.kind === c.kind && d.ref_id === c.ref_id);
            return (
              <li key={`${c.kind}${c.ref_id}`} className="flex items-center gap-2 px-3">
                <button type="button" aria-pressed={on} className={cn("flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left text-sm", FOCUS)} onClick={() => onChange(toggleChoice(list, c))}>
                  <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border", on ? "border-foreground bg-foreground text-background" : "border-encre-grise")} aria-hidden="true">
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1 break-words">{c.label}</span>
                  <span className="chiffres-tabulaires shrink-0 text-muted-foreground">
                    {c.minutes > 0 && `${t("commun.minutes", { min: c.minutes })} · `}{formatPrice(c.price, lang)}
                  </span>
                </button>
                {on && c.kind === "product" && (
                  <ChampQuantite label={t("rdv.quantite_de", { nom: c.label })} value={list[at].quantity} onChange={(q) => onChange(setDraftQuantity(list, at, q))} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {list.map((d, i) => (d.kind === "libre" || !propose(d)) && (
        <div key={`${d.kind}${d.ref_id ?? ""}${i}`} className="flex items-center gap-2 text-sm">
          <Plus className="h-3 w-3 shrink-0 text-encre-grise" aria-hidden="true" />
          <span className="min-w-0 flex-1 break-words">{d.label}</span>
          <span className="chiffres-tabulaires text-muted-foreground">{t("commun.minutes", { min: d.minutes })}{d.price > 0 && <>{" · "}{formatPrice(d.price * d.quantity, lang)}</>}</span>
          <Button variant="ghost" size="icon" aria-label={t("supplement.retirer", { nom: d.label })} onClick={() => onChange(removeDraft(list, i))}><X aria-hidden="true" /></Button>
        </div>
      ))}
      {libre
        ? (
          <div ref={saisie} className="space-y-2">
            <ChampsLibre minutes onAdd={(l) => { onChange(addLibre(list, l)); setLibre(false); }} />
            <Button variant="ghost" className="h-11 w-full" onClick={() => setLibre(false)}>{t("commun.annuler")}</Button>
          </div>
        )
        : <Button variant="outline" className="h-11" onClick={() => setLibre(true)}><Plus aria-hidden="true" />{t("supplement.ajouter_libre")}</Button>}
    </fieldset>
  );
}
