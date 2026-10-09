import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { ArrowLeft, X } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { escapeDecision, focusAfterClose, hasUnsavedText, shouldRestoreFocus } from "@/lib/panneau";

/** Fenêtres et menus ouverts par-dessus le panneau : ils traitent Échap eux-mêmes. */
const OVERLAYS = '[role="dialog"], [role="alertdialog"], [role="menu"]';
/** Champs dont le contenu serait perdu à la fermeture (note en cours). */
const DRAFTS = "input[data-brouillon], textarea[data-brouillon]";

/**
 * Panneau de détail (sous-projet 4 § 3.3), générique : à droite, un tiers de
 * la largeur et 360 px au moins, sur 768 px et plus, sans quitter la liste ou
 * l'agenda ; posé par-dessus l'écran (filet cuir) jusqu'à 1279 px pour ne pas
 * écraser l'agenda de la tablette, en colonne à partir de 1280 px ; plein écran
 * avec « Retour » sur téléphone. Échap le ferme où que
 * soit le focus, sauf si une note y est en cours de saisie. Son corps est un
 * conteneur (`@container`) : le contenu se met en page selon la largeur du
 * panneau, pas celle de l'écran.
 */
export function Panneau({ titre, onClose, children }: { titre: string; onClose: () => void; children: ComponentChildren }) {
  const { t } = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);
  const aside = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Échap refusée parce qu'une note est en cours : un message le dit.
  const [kept, setKept] = useState(false);

  // Élément qui avait le focus à l'ouverture (ligne, bloc de l'agenda), lu au
  // premier rendu, avant que le titre ne le prenne.
  const [opener] = useState(() => document.activeElement);

  // À l'ouverture, le focus passe au titre : lecteur d'écran et clavier suivent.
  // À la fermeture, il revient au déclencheur, sauf s'il est déjà ailleurs dans
  // l'écran (bouton du rail) : la personne garde sa place.
  useEffect(() => {
    heading.current?.focus();
    const panel = aside.current;
    return () => {
      const active = document.activeElement;
      if (!shouldRestoreFocus(active, document.body, Boolean(panel && active && panel.contains(active)))) return;
      const target = focusAfterClose(opener, document.body, document.querySelector("main"));
      if (target instanceof HTMLElement) {
        if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Échap écoutée sur tout le document : elle ferme aussi le panneau quand le
  // focus est resté dans la page (agenda, liste) à côté.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const panel = aside.current;
      if (!panel) return;
      const drafts = Array.from(panel.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(DRAFTS), (field) => field.value);
      const decision = escapeDecision(e, document.querySelector(OVERLAYS) !== null, hasUnsavedText(drafts));
      if (decision === "ignorer") return;
      e.preventDefault();
      if (decision === "garder") setKept(true);
      else close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <aside
      ref={aside}
      aria-labelledby="panneau-titre"
      onInput={() => setKept(false)}
      className="fixed inset-0 z-40 flex flex-col bg-background md:left-auto md:right-0 md:w-[calc(max(22.5rem,33vw)+env(safe-area-inset-right))] md:border-l md:border-foreground md:pr-[env(safe-area-inset-right)] xl:static xl:z-auto xl:shrink-0 xl:border-filet"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-filet bg-card pb-2 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-[calc(0.5rem+env(safe-area-inset-top))] md:pl-4 md:pr-2 md:pt-2">
        <Button variant="ghost" className="px-3 md:hidden" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("commun.retour")}
        </Button>
        <h2 id="panneau-titre" ref={heading} tabIndex={-1} className="min-w-0 flex-1 truncate font-serif text-lg focus:outline-none">{titre}</h2>
        <Button variant="ghost" size="icon" className="hidden md:inline-flex" aria-label={t("commun.fermer")} onClick={onClose}>
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </header>
      <p role="status" className={kept ? "shrink-0 border-b border-filet bg-muted px-4 py-2 text-sm" : "sr-only"}>
        {kept ? t("panneau.saisie_en_cours") : ""}
      </p>
      <div className="@container min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">{children}</div>
    </aside>
  );
}
