import { X } from "lucide-preact";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/provider";
import { MAX_TAG_LENGTH, MAX_TAGS, parseTagInput, shownTags, tagSuggestions } from "@/lib/crm";
import { cn } from "@/lib/utils";
import type { TagCount } from "../../types";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Une puce d'étiquette : sobre, sans couleur (décision 3), filet et fond de touche. */
export const PUCE = "inline-flex max-w-full items-center truncate rounded-sm border border-filet bg-muted px-1.5 py-0.5 text-xs text-foreground";

/** Étiquettes d'une cliente en puces ; `max` en montre quelques-unes et compte le reste (« +2 »). */
export function PucesEtiquettes({ tags, max }: { tags: string[]; max?: number }) {
  const { t } = useI18n();
  if (tags.length === 0) return null;
  const { shown, more } = max === undefined ? { shown: tags, more: 0 } : shownTags(tags, max);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((tag) => <span key={tag} className={PUCE}>{tag}</span>)}
      {more > 0 && <span className={PUCE}>{t("crm.plus", { count: more })}</span>}
    </span>
  );
}

/**
 * Saisie des étiquettes (formulaire de la cliente, décision 3) : puces
 * retirables (44 px), champ qui ajoute à Entrée ou à la virgule, étiquettes
 * existantes proposées pendant la frappe ; dix au plus.
 */
export function SaisieEtiquettes({ id, tags, onChange, draft, onDraft, existing }: {
  id: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  draft: string;
  onDraft: (text: string) => void;
  existing: TagCount[];
}) {
  const { t } = useI18n();
  const full = tags.length >= MAX_TAGS;
  const suggestions = full ? [] : tagSuggestions(draft, existing, tags);
  const take = (text: string) => {
    const read = parseTagInput(text, tags);
    onChange(read.tags);
    onDraft(read.rest);
  };
  return (
    <div className="space-y-2">
      {tags.length > 0 && (
        <ul aria-label={t("crm.etiquettes")} className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                aria-label={t("crm.retirer_etiquette", { etiquette: tag })}
                onClick={() => onChange(tags.filter((x) => x !== tag))}
                className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-sm border border-filet bg-muted px-3 text-sm transition-colors duration-200 hover:border-foreground", FOCUS)}
              >
                {tag}
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        value={draft}
        disabled={full}
        maxLength={MAX_TAG_LENGTH * MAX_TAGS}
        placeholder={full ? t("crm.etiquettes_max") : t("crm.ajouter_etiquette")}
        onInput={(e: Event) => {
          const value = (e.target as HTMLInputElement).value;
          if (value.includes(",")) take(value);
          else onDraft(value);
        }}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === "Enter") { e.preventDefault(); take(`${draft},`); }
        }}
      />
      <p className="text-xs text-muted-foreground">{t("crm.etiquette_aide")}</p>
      {suggestions.length > 0 && (
        <div className="space-y-1">
          <p className="etiquette text-encre-grise">{t("crm.etiquettes_existantes")}</p>
          <ul className="flex flex-wrap gap-2">
            {suggestions.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  onClick={() => take(`${tag},`)}
                  className={cn("inline-flex min-h-11 items-center rounded-sm border border-dashed border-filet px-3 text-sm transition-colors duration-200 hover:bg-muted", FOCUS)}
                >
                  {tag}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
