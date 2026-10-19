import type { ComponentProps, RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { CalendarDays } from "lucide-preact";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/provider";
import type { Key } from "@/i18n/translate";
import { type Borne, timeSlots } from "@/lib/creneaux";
import { dateFromText, dateToText, dateWithin, timeToText } from "@/lib/saisie-date";
import { cn } from "@/lib/utils";
import { Calendrier } from "./calendrier";
import { SELECT } from "./reglages/elements";

type Props = Omit<ComponentProps<typeof Input>, "type" | "value" | "onChange" | "onInput" | "placeholder"> & {
  id: string;
  /** Valeur de l'API : `aaaa-mm-jj` (date) ou `hh:mm` (heure) ; vide si rien de lisible n'est saisi. */
  value: string;
  onValue: (value: string) => void;
};

interface Format {
  parse: (text: string) => string | null;
  print: (value: string) => string;
  hintKey: Key;
  /** Message d'une saisie refusée (illisible, ou hors bornes). */
  invalidKey: (text: string) => Key;
}

/**
 * Champ texte au format de l'institut, quelle que soit la langue du
 * navigateur (voir `lib/saisie-date.ts`). Transmet la valeur de l'API dès que
 * la saisie est lisible, une valeur vide sinon ; une saisie illisible est
 * signalée au navigateur (`setCustomValidity`), ce qui bloque l'envoi d'un
 * formulaire validé. La saisie reste telle quelle à la bascule de langue.
 */
function ChampTexte({
  format,
  value,
  onValue,
  inputRef,
  tactile,
  text,
  setText,
  visible,
  errorId,
  setShown,
  ...props
}: Props & {
  format: Format;
  inputRef: RefObject<HTMLInputElement>;
  tactile: boolean;
  /** État de la saisie, porté par `ChampDate` : le message d'erreur s'affiche hors de ce composant, sous le champ. */
  text: string;
  setText: (text: string) => void;
  visible: boolean;
  errorId: string;
  setShown: (shown: boolean) => void;
}) {
  const { t } = useI18n();
  const ref = inputRef;
  return (
    <Input
      {...props}
      ref={ref}
      type="text"
      inputMode={tactile ? "none" : "numeric"}
      autoComplete="off"
      placeholder={t(format.hintKey)}
      aria-invalid={visible || undefined}
      aria-describedby={visible ? errorId : undefined}
      className={cn(props.className, visible && "border-encre-rouge")}
      value={text}
      onInput={(e: Event) => {
        const next = (e.currentTarget as HTMLInputElement).value;
        setText(next);
        onValue(format.parse(next) ?? "");
        // Saisie redevenue lisible : l'attente reprend, la prochaine erreur attendra de nouveau la sortie du champ.
        if (format.parse(next) !== null) setShown(false);
      }}
      onBlur={() => {
        const parsed = format.parse(text);
        // Message montré seulement si la saisie n'est pas vide et reste illisible (décision 11).
        setShown(text.trim() !== "" && parsed === null);
        if (parsed !== null) setText(format.print(parsed));
      }}
      onInvalid={() => setShown(true)}
    />
  );
}

/** Vrai sur un appareil tactile (téléphone, tablette) : le toucher ouvre le calendrier, pas le clavier. */
function useTactile(): boolean {
  const query = () => typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)") : null;
  const [tactile, setTactile] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const media = query();
    if (!media) return;
    const change = () => setTactile(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return tactile;
}

/**
 * Date `jj/mm/aaaa` dans les deux langues ; valeur `aaaa-mm-jj`. Saisie au
 * clavier conservée sur ordinateur ; le clic ou le toucher sur le champ, ou
 * l'icône à droite, ouvre le calendrier (`calendrier.tsx`). Sur un appareil
 * tactile, `inputMode="none"` évite le clavier (le champ reste validé par le
 * navigateur, ce que `readOnly` empêcherait : `required` serait ignoré).
 * Bornes facultatives `min` et `max` (`aaaa-mm-jj`).
 */
export function ChampDate({ min, max, ...props }: Props & { min?: string; max?: string }) {
  const { t, lang } = useI18n();
  const tactile = useTactile();
  const [ouvert, setOuvert] = useState(false);
  const [focusGrid, setFocusGrid] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  // Conteneur du champ et de son icône : c'est sur lui que le calendrier s'ancre, pas sur `wrap`
  // qui porte aussi le message d'erreur (celui-ci reste sous le champ, hors de cet ancrage).
  const field = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const panelId = `${props.id}-calendrier`;
  // Une date lisible mais hors bornes est refusée comme une date illisible.
  const format: Format = {
    parse: (text: string) => dateWithin(text, min, max),
    print: dateToText,
    hintKey: "saisie.date_format",
    invalidKey: (text: string) => (dateFromText(text) ? "saisie.date_hors_bornes" : "saisie.date_invalide"),
  };

  const [text, setText] = useState(() => format.print(props.value));
  const invalid = text.trim() !== "" && format.parse(text) === null;

  // Valeur changée par l'écran (remise à zéro, autre jour) : le texte suit,
  // sauf si la valeur vide vient justement d'une saisie en cours illisible.
  useEffect(() => {
    const parsed = format.parse(text);
    if (parsed === props.value || (props.value === "" && parsed === null)) return;
    setText(format.print(props.value));
  }, [props.value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    input.current?.setCustomValidity(invalid ? t(format.invalidKey(text)) : "");
  }, [invalid, text, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Saisie refusée : le message est écrit sous le champ et relié à lui (§ 7.3), pas seulement confié au
  // navigateur ; montré une fois le champ quitté ou le formulaire envoyé, pas à chaque chiffre tapé.
  const [shown, setShown] = useState(false);
  const visible = invalid && shown;
  const errorId = `${props.id}-erreur`;

  const open = (grid: boolean) => {
    setFocusGrid(grid);
    setOuvert(true);
  };
  const close = useCallback((refocus: boolean) => {
    setOuvert(false);
    if (refocus) input.current?.focus();
  }, []);

  return (
    <div
      ref={wrap}
      className="min-w-0"
      data-calendrier-ouvert={ouvert ? "" : undefined}
      onFocusOut={(event: FocusEvent) => {
        // Tab hors du champ et du panneau : fermeture. Sans cible (clic sur une zone
        // non focalisable, bouton sous Safari), le clic dehors s'en charge déjà.
        const next = event.relatedTarget as Node | null;
        if (ouvert && next && !wrap.current?.contains(next)) setOuvert(false);
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.target !== input.current) return;
        if (event.key === "Escape" && ouvert) { event.preventDefault(); close(true); }
        if (event.key === "ArrowDown" && event.altKey) { event.preventDefault(); open(true); }
      }}
    >
      <div ref={field} className="relative min-w-0">
        <ChampTexte
          format={format}
          inputRef={input}
          tactile={tactile}
          text={text}
          setText={setText}
          visible={visible}
          errorId={errorId}
          setShown={setShown}
          role="combobox"
          aria-haspopup="dialog"
          aria-expanded={ouvert}
          aria-controls={ouvert ? panelId : undefined}
          onClick={() => { if (!ouvert) open(false); }}
          {...props}
          className={cn("pr-11", props.className)}
        />
        <button
          type="button"
          className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-sm text-encre-grise hover:text-foreground disabled:opacity-50"
          aria-label={t("calendrier.ouvrir")}
          aria-haspopup="dialog"
          aria-expanded={ouvert}
          disabled={props.disabled}
          onClick={() => (ouvert ? close(true) : open(true))}
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
        </button>
        {ouvert && field.current && (
          <Calendrier
            id={panelId}
            value={props.value}
            min={min}
            max={max}
            anchor={field.current}
            focusGrid={focusGrid}
            onClose={close}
            onPick={(day: string) => { props.onValue(day); close(true); }}
          />
        )}
      </div>
      {/* Ligne réservée (retouche 1) : toujours rendue, vide hors erreur, pour que rien ne se déplace au premier appui sur un bouton d'envoi voisin. */}
      <p id={errorId} aria-hidden={!visible} className="mt-1 min-h-5 text-sm text-encre-rouge">{visible ? t(format.invalidKey(text)) : ""}</p>
    </div>
  );
}

type HeureProps = {
  id: string;
  /** Valeur de l'API `hh:mm`, ou vide. */
  value: string;
  onValue: (value: string) => void;
  /** Début d'un horaire (07:00 à 22:45) ou fin (07:15 à 23:00). */
  borne?: Borne;
  className?: string;
  required?: boolean;
  disabled?: boolean;
};

/**
 * Heure sur 24 h dans les deux langues ; valeur `hh:mm`. Liste déroulante
 * native de créneaux de 15 minutes (16 px, 44 px de haut : style SELECT),
 * dans la police de l'interface aux chiffres alignés (sous-projet 7, vague 2) ;
 * une valeur existante hors grille y est ajoutée à sa place (`lib/creneaux.ts`).
 */
export function ChampHeure({ borne = "debut", value, onValue, className, ...props }: HeureProps) {
  const { t } = useI18n();
  const current = timeToText(value);
  return (
    <select
      {...props}
      className={cn(SELECT, "tabular-nums", className)}
      value={current}
      onChange={(event: Event) => onValue((event.currentTarget as HTMLSelectElement).value)}
    >
      {!current && <option value="">{t("saisie.heure_choisir")}</option>}
      {timeSlots(borne, value).map((slot) => <option key={slot} value={slot}>{slot}</option>)}
    </select>
  );
}
