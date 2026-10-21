import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { ChevronsLeft, ChevronsRight, Download, Lock, LogOut, UserRound } from "lucide-preact";
import { useApp } from "../../context";
import { useAuth } from "../../auth-context";
import { readRailExpanded, writeRailExpanded } from "@/i18n/device-lang";
import { useI18n } from "@/i18n/provider";
import { createLongPressGate } from "@/lib/appui-long";
import { railViews, viewLabelKey } from "@/lib/cadre";
import { ROLE_KEYS } from "@/lib/roles";
import { pathFor } from "@/lib/routes";
import { THEME_PREFS } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { MarqueCadre } from "@/components/brand";
import { LangSwitch } from "@/components/lang-switch";
import { useInstaller } from "@/components/installer-lama";
import { THEME_ICONS, THEME_KEYS, useChoixTheme } from "@/components/choix-theme";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTheme } from "../../theme-provider";
import type { View } from "../../types";
import { CompteurAEnvoyer, CompteurStockBas, PastilleMiseAJour, navIcon, saveOwnLang } from "./navigation";

const LONG_PRESS_MS = 500;
const HINT_AFTER_PRESS_MS = 1500;

type Hint = { label: string; top: number } | null;

/**
 * Libellé d'un bouton du rail replié (§ 3.3) : au survol, au focus clavier et
 * à l'appui long. Posé en position fixe à droite du rail, il n'est jamais
 * rogné par le défilement du rail. Le clic qui suit un appui long est ignoré
 * (`ignoreClick`, décision D6) : le libellé s'affiche sans ouvrir l'écran.
 */
function useRailHint() {
  const [hint, setHint] = useState<Hint>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gate = useRef(createLongPressGate(LONG_PRESS_MS));
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const show = (label: string, el: Element) => {
    const rect = el.getBoundingClientRect();
    setHint({ label, top: rect.top + rect.height / 2 });
  };
  const handlers = (label: string) => ({
    onMouseEnter: (e: MouseEvent) => show(label, e.currentTarget as Element),
    onMouseLeave: () => setHint(null),
    onFocus: (e: FocusEvent) => { if ((e.currentTarget as Element).matches(":focus-visible")) show(label, e.currentTarget as Element); },
    onBlur: () => setHint(null),
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType !== "touch") { gate.current.cancel(); return; }
      const el = e.currentTarget as Element;
      clear();
      gate.current.press(e.timeStamp);
      timer.current = setTimeout(() => show(label, el), LONG_PRESS_MS);
    },
    onPointerUp: () => { clear(); timer.current = setTimeout(() => setHint(null), HINT_AFTER_PRESS_MS); },
    onPointerCancel: () => { clear(); gate.current.cancel(); setHint(null); },
    onContextMenu: (e: Event) => e.preventDefault(),
  });
  const ignoreClick = (e: MouseEvent) => gate.current.ignoreClick(e.timeStamp, e.detail === 0);
  return { hint, handlers, ignoreClick };
}

const ITEM = "relative flex min-h-11 w-full items-center gap-3 rounded-sm font-sans text-sm tracking-[0.04em] transition-colors duration-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring";

function RailButton({ label, icon: Icon, expanded, active = false, onClick, hint, ignoreClick, extra, extraLabel, ariaExpanded }: {
  label: string;
  icon: typeof ChevronsLeft;
  expanded: boolean;
  active?: boolean;
  onClick: () => void;
  hint: ReturnType<typeof useRailHint>["handlers"];
  ignoreClick: ReturnType<typeof useRailHint>["ignoreClick"];
  extra?: ComponentChildren;
  /** Ce que dit le compteur posé sur l'icône, ajouté au nom du bouton replié. */
  extraLabel?: string;
  ariaExpanded?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={expanded ? undefined : extraLabel ? `${label}, ${extraLabel}` : label}
      aria-current={active ? "page" : undefined}
      aria-expanded={ariaExpanded}
      onClick={(e: MouseEvent) => { if (!expanded && ignoreClick(e)) return; onClick(); }}
      {...(expanded ? {} : hint(label))}
      className={cn(
        ITEM,
        expanded ? "justify-start px-3" : "justify-center",
        active ? "bg-sidebar-accent text-sidebar-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
      )}
    >
      <span className="relative flex">
        <Icon className="h-5 w-5" aria-hidden="true" />
        {extra}
      </span>
      {expanded && <span className="min-w-0 flex-1 text-left leading-tight">{label}</span>}
    </button>
  );
}

/** Choix du thème depuis le rail : un bouton, trois choix dans un menu. */
function MenuTheme({ expanded, hint }: { expanded: boolean; hint: ReturnType<typeof useRailHint>["handlers"] }) {
  const { pref } = useTheme();
  const { setError } = useApp();
  const { t } = useI18n();
  const choose = useChoixTheme((message) => setError(message));
  const Icon = THEME_ICONS[pref];
  // Décision C2 : une seule chaîne traduite (« Thème : Clair », « Theme: Light »).
  const label = t("theme.actuel", { nom: t(THEME_KEYS[pref]) });
  const { onMouseEnter, onMouseLeave, onFocus, onBlur } = hint(label);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          {...(expanded ? {} : { onMouseEnter, onMouseLeave, onFocus, onBlur })}
          className={cn(ITEM, expanded ? "justify-start px-3" : "justify-center", "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground")}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
          {expanded && <span className="min-w-0 flex-1 text-left leading-tight">{label}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="min-w-48">
        <DropdownMenuLabel className="etiquette text-muted-foreground">{t("theme.choix")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={pref} onValueChange={(value: string) => choose(THEME_PREFS.find((p) => p === value) ?? "system")}>
          {THEME_PREFS.map((code) => (
            <DropdownMenuRadioItem key={code} value={code} className="min-h-11">{t(THEME_KEYS[code])}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Rail de 768 px et plus (sous-projet 4 § 3.3) : cuir, 64 px, icônes des
 * rubriques permises au rôle ; déployé avec ses libellés au choix de
 * l'appareil. En pied : compte, FR / EN, thème, déconnexion. Quand la hauteur
 * manque (iPhone en paysage, 393 px), c'est tout le rail qui défile : logo,
 * rubriques et pied restent atteignables.
 */
export function Rail({ currentView, folded = false }: { currentView: View; folded?: boolean }) {
  const { navigate, setError, stats } = useApp();
  const { account, session, logout } = useAuth();
  const { t, tn, lang } = useI18n();
  const lowStock = stats.low_stock_products;
  const [stored, setStored] = useState(() => readRailExpanded());
  // Replié tant qu'un panneau est posé par-dessus la page (railFolded) ; le choix de l'appareil reste enregistré.
  const expanded = stored && !folded;
  const { hint, handlers, ignoreClick } = useRailHint();
  const poste = session?.kind === "poste";
  const installation = useInstaller();

  const toggle = () => {
    const next = !expanded;
    setStored(next);
    writeRailExpanded(next);
  };

  return (
    <aside className={cn(
      "hidden h-full shrink-0 flex-col overflow-y-auto overflow-x-hidden bg-sidebar pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] text-sidebar-foreground md:flex",
      // L'encoche de l'iPhone en paysage s'ajoute aux 64 px des icônes au lieu d'être prise dessus.
      expanded ? "w-[calc(15rem+env(safe-area-inset-left))]" : "w-[calc(4rem+env(safe-area-inset-left))]",
    )}>
      <div className="flex shrink-0 flex-col items-center gap-2 px-2 pb-3 pt-4">
        <MarqueCadre place={expanded ? "rail" : "replie"} />
      </div>
      <nav aria-label={t("menu.navigation")} className="flex-1 space-y-1 px-2 py-2">
        {railViews(account.role).map((view) => (
          <RailButton
            key={view}
            label={t(viewLabelKey(view, account.role))}
            icon={navIcon(view, account.role)}
            expanded={expanded}
            active={currentView === view}
            onClick={() => navigate(pathFor(view, lang))}
            hint={handlers}
            ignoreClick={ignoreClick}
            extra={view === "products" ? <CompteurStockBas /> : view === "reglages" ? <><CompteurAEnvoyer /><PastilleMiseAJour /></> : undefined}
            extraLabel={view === "products" && lowStock > 0 ? tn("stock_bas.pastille", lowStock) : undefined}
          />
        ))}
      </nav>
      <div className="flex shrink-0 flex-col gap-1 border-t border-sidebar-border px-2 py-3">
        {expanded && (
          <div className="min-w-0 px-3 pb-1">
            <p className="truncate text-sm text-sidebar-foreground">{account.display_name}</p>
            <p className="etiquette whitespace-nowrap text-sidebar-foreground/60">{t(ROLE_KEYS[account.role])}</p>
          </div>
        )}
        <RailButton
          label={t("reglages.rubrique.mon_compte")}
          icon={UserRound}
          expanded={expanded}
          onClick={() => navigate(pathFor("reglages", lang, "mon-compte"))}
          hint={handlers}
          ignoreClick={ignoreClick}
        />
        <div className={cn("flex", expanded ? "px-1" : "justify-center")}>
          <LangSwitch vertical={!expanded} onChange={saveOwnLang} onError={setError} />
        </div>
        <MenuTheme expanded={expanded} hint={handlers} />
        {installation.visible && (
          <RailButton
            label={t("installation.entree")}
            icon={Download}
            expanded={expanded}
            onClick={installation.installer}
            hint={handlers}
            ignoreClick={ignoreClick}
          />
        )}
        <RailButton
          label={poste ? t("menu.verrouiller") : t("menu.deconnexion")}
          icon={poste ? Lock : LogOut}
          expanded={expanded}
          onClick={() => void logout()}
          hint={handlers}
          ignoreClick={ignoreClick}
        />
        {!folded && <RailButton
          label={expanded ? t("cadre.replier") : t("cadre.deployer")}
          icon={expanded ? ChevronsLeft : ChevronsRight}
          expanded={expanded}
          ariaExpanded={expanded}
          onClick={toggle}
          hint={handlers}
          ignoreClick={ignoreClick}
        />}
      </div>
      {installation.fenetre}
      {hint && !expanded && (
        <div
          aria-hidden="true"
          style={{ top: hint.top }}
          className="pointer-events-none fixed left-[calc(4rem+env(safe-area-inset-left)+0.5rem)] z-50 -translate-y-1/2 whitespace-nowrap rounded-sm border border-sidebar-border bg-sidebar px-3 py-2 text-sm text-sidebar-foreground"
        >
          {hint.label}
        </div>
      )}
    </aside>
  );
}
