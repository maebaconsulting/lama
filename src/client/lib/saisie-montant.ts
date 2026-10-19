import type { Lang } from "../i18n/translate.ts";
import { formatAmount, parseAmount } from "./format.ts";
import { deviseActive } from "../../shared/devise-active.ts";
import { formatEntier, separateurDecimal } from "../../shared/montants.ts";

/** Saisie d'un champ de montant groupé par milliers, reformaté à chaque frappe. */
export interface AmountEdit {
  amount: number;
  /** Texte à afficher : vide pour zéro, comme les champs qui l'utilisent. */
  text: string;
  /** Position du curseur dans `text`. */
  caret: number;
}

/** Texte affiché : milliers groupés ; pour une devise à centimes, la virgule et les décimales tapées restent telles quelles. */
function shownFor(text: string, amount: number, lang: Lang): string {
  const d = deviseActive();
  if (d.decimales === 0) return amount ? formatAmount(amount, lang) : "";
  const k = 10 ** d.decimales;
  const decimal = /[.,](\d{0,2})$/.exec(text.trim());
  const typedDecimals = decimal && !/[.,]\d{3}$/.test(text.trim()) ? decimal[1] : null;
  if (typedDecimals === null) return amount ? formatEntier(Math.floor(amount / k)) : "";
  return `${formatEntier(Math.floor(amount / k))}${separateurDecimal(lang)}${typedDecimals}`;
}

const isDigit = (ch: string | undefined) => ch !== undefined && ch >= "0" && ch <= "9";

/**
 * Reformate la saisie `raw` (curseur en `caret`) d'un champ qui valait
 * `previous`, et replace le curseur après le même nombre de chiffres
 * significatifs qu'avant le formatage : il ne saute plus en fin de champ quand
 * le nombre gagne ou perd un séparateur (restes de la V 1.0, point 2).
 * `previousText` : le texte que le champ affichait avant la frappe (sa value rendue).
 * Effacer seulement un séparateur (Retour arrière juste après l'espace des
 * milliers, ou Suppr juste avant) efface le chiffre voisin, comme ailleurs.
 */
export function editAmount(raw: string, caret: number, previous: number, inputType: string, lang: Lang, previousText: string): AmountEdit {
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
  // Devise à centimes : si la saisie précédente avait déjà le séparateur décimal et que l'insertion
  // ferait dépasser les décimales (« 15,515 »), elle est refusée, où que soit le curseur ; sans
  // séparateur avant (champ vide, collage de « 1.500 »), la lecture des milliers s'applique.
  const decimales = deviseActive().decimales;
  if (decimales > 0 && inputType.startsWith("insert") && /[.,]/.test(previousText)) {
    const apres = /[.,](\d+)$/.exec(raw);
    if (apres && apres[1].length > decimales) return { amount: previous, text: previousText, caret: previousText.length };
  }
  const amount = parseAmount(text);
  const shown = shownFor(text, amount, lang);
  // Curseur en fin de saisie : il y reste (après « 15, », le chiffre suivant va aux décimales).
  if (at >= text.length) return { amount, text: shown, caret: shown.length };
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
export function typeAmount(e: Event, previous: number, lang: Lang, previousText: string): number {
  const input = e.currentTarget as HTMLInputElement;
  const edit = editAmount(input.value, input.selectionStart ?? input.value.length, previous, (e as InputEvent).inputType ?? "", lang, previousText);
  input.value = edit.text;
  input.setSelectionRange(edit.caret, edit.caret);
  return edit.amount;
}

/**
 * Texte que le champ rend : le texte tapé (`saisi`, tel que `editAmount` l'a
 * écrit) tant qu'il se lit comme le montant, pour que « 15, » ne redevienne
 * pas « 15,00 » sous les doigts ; sinon le montant formaté (montant posé par
 * le programme, réinitialisation). `blankZero` : zéro rend un champ vide.
 */
export function texteRendu(saisi: string | null, amount: number, lang: Lang, blankZero: boolean): string {
  if (saisi !== null && parseAmount(saisi) === amount) return saisi;
  return blankZero && !amount ? "" : formatAmount(amount, lang);
}
