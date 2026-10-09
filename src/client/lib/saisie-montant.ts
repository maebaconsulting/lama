import type { Lang } from "../i18n/translate.ts";
import { formatAmount, parseAmount } from "./format.ts";

/** Saisie d'un champ de montant groupé par milliers, reformaté à chaque frappe. */
export interface AmountEdit {
  amount: number;
  /** Texte à afficher : vide pour zéro, comme les champs qui l'utilisent. */
  text: string;
  /** Position du curseur dans `text`. */
  caret: number;
}

const isDigit = (ch: string | undefined) => ch !== undefined && ch >= "0" && ch <= "9";

/**
 * Reformate la saisie `raw` (curseur en `caret`) d'un champ qui valait
 * `previous`, et replace le curseur après le même nombre de chiffres
 * significatifs qu'avant le formatage : il ne saute plus en fin de champ quand
 * le nombre gagne ou perd un séparateur (restes de la V 1.0, point 2).
 * Effacer seulement un séparateur (Retour arrière juste après l'espace des
 * milliers, ou Suppr juste avant) efface le chiffre voisin, comme ailleurs.
 */
export function editAmount(raw: string, caret: number, previous: number, inputType: string, lang: Lang): AmountEdit {
  let text = raw;
  let at = Math.max(0, Math.min(caret, raw.length));
  if (inputType.startsWith("delete") && previous !== 0 && parseAmount(raw) === previous) {
    if (inputType === "deleteContentForward") {
      let j = at;
      while (j < text.length && !isDigit(text[j])) j++;
      if (j < text.length) text = text.slice(0, j) + text.slice(j + 1);
    } else {
      let j = at - 1;
      while (j >= 0 && !isDigit(text[j])) j--;
      if (j >= 0) { text = text.slice(0, j) + text.slice(j + 1); at = j; }
    }
  }
  const amount = parseAmount(text);
  const shown = amount ? formatAmount(amount, lang) : "";
  // Chiffres significatifs à gauche du curseur : les zéros de tête disparaissent au formatage.
  const digits = [...text].filter(isDigit).join("");
  const leadingZeros = digits.length - digits.replace(/^0+/, "").length;
  const left = [...text.slice(0, at)].filter(isDigit).length;
  let wanted = left - Math.min(left, leadingZeros);
  let next = 0;
  while (wanted > 0 && next < shown.length) {
    if (isDigit(shown[next])) wanted--;
    next++;
  }
  return { amount, text: shown, caret: next };
}

/**
 * Frappe dans un champ de montant groupé : réécrit le champ, replace le
 * curseur et rend le montant lu. Le texte écrit est celui que le rendu
 * suivant donnera, Preact ne le remplace donc pas (et le curseur reste).
 */
export function typeAmount(e: Event, previous: number, lang: Lang): number {
  const input = e.currentTarget as HTMLInputElement;
  const edit = editAmount(input.value, input.selectionStart ?? input.value.length, previous, (e as InputEvent).inputType ?? "", lang);
  input.value = edit.text;
  input.setSelectionRange(edit.caret, edit.caret);
  return edit.amount;
}
