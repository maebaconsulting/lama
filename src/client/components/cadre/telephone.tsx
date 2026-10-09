import { useEffect, useState } from "preact/hooks";
import { Download, Lock, LogOut, MoreHorizontal, UserRound } from "lucide-preact";
import { useApp } from "../../context";
import { useAuth } from "../../auth-context";
import { useI18n } from "@/i18n/provider";
import { moreViews, phoneTabs, viewLabelKey } from "@/lib/cadre";
import { ROLE_KEYS } from "@/lib/roles";
import { pathFor } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { MarqueCadre } from "@/components/brand";
import { ChoixTheme } from "@/components/choix-theme";
import { LangSwitch } from "@/components/lang-switch";
import { useInstaller } from "@/components/installer-lama";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { View } from "../../types";
import { CompteurAEnvoyer, CompteurStockBas, navIcon, saveOwnLang } from "./navigation";

/** En-tête cuir réduit du téléphone : la marque lama blanche, zones sûres comprises. */
export function EnTeteTelephone() {
  return (
    <header className="flex shrink-0 items-center gap-2 bg-sidebar pb-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[calc(0.5rem+env(safe-area-inset-top))] text-sidebar-foreground md:hidden">
      <MarqueCadre place="telephone" />
    </header>
  );
}

const TAB = "relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-xs transition-colors duration-200 focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-ring";

/**
 * Rubriques restantes, compte, FR / EN, thème, installation sur l'écran
 * d'accueil (PWA, P-06) et déconnexion (§ 3.3), dans une feuille de cuir.
 * `installer` est absent quand lama est déjà installé ou ne peut pas l'être.
 */
function Plus({ currentView, installer }: { currentView: View; installer: (() => void) | null }) {
  const { navigate, setError } = useApp();
  const { account, session, logout } = useAuth();
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const views = moreViews(account.role);
  const poste = session?.kind === "poste";
  const active = (views as View[]).includes(currentView);

  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, []);

  const go = (to: string) => { navigate(to); setOpen(false); };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" aria-current={active ? "page" : undefined} className={cn(TAB, active ? "bg-sidebar-accent text-sidebar-foreground" : "text-sidebar-foreground/70")}>
          <span className="relative flex"><MoreHorizontal className="h-5 w-5" aria-hidden="true" />{views.includes("reglages") && <CompteurAEnvoyer />}</span>
          <span className="max-w-full truncate">{t("cadre.plus")}</span>
        </button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className="bottom-0 left-0 top-auto flex max-h-[85dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 border-t border-sidebar-border bg-sidebar p-0 text-sidebar-foreground sm:rounded-none [&>button]:right-[max(0.5rem,env(safe-area-inset-right))] [&>button]:top-2 [&>button]:text-sidebar-foreground"
      >
        {/* Un seul enfant : le pied partagé des fenêtres (ui/dialog.tsx) n'ajoute aucun écart. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-4">
          <DialogTitle className="etiquette pr-12 text-sidebar-foreground/60">{t("cadre.plus")}</DialogTitle>
          {views.length > 0 && (
            <ul className="mt-3 space-y-1">
              {views.map((view) => {
                const Icon = navIcon(view, account.role);
                return (
                  <li key={view}>
                    <button
                      type="button"
                      aria-current={currentView === view ? "page" : undefined}
                      onClick={() => go(pathFor(view, lang))}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-3 rounded-sm px-3 text-left text-sm tracking-[0.04em] transition-colors duration-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring",
                        currentView === view ? "bg-sidebar-accent text-sidebar-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
                      )}
                    >
                      <span className="relative flex"><Icon className="h-5 w-5" aria-hidden="true" />{view === "products" && <CompteurStockBas />}{view === "reglages" && <CompteurAEnvoyer />}</span>
                      <span className="min-w-0 flex-1 truncate">{t(viewLabelKey(view, account.role))}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4 space-y-4 border-t border-sidebar-border pt-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 max-w-full">
                <p className="truncate text-sm text-sidebar-foreground">{account.display_name}</p>
                <p className="etiquette whitespace-nowrap text-sidebar-foreground/60">{t(ROLE_KEYS[account.role])}</p>
              </div>
              <LangSwitch onChange={saveOwnLang} onError={setError} />
            </div>
            <button
              type="button"
              onClick={() => go(pathFor("reglages", lang, "mon-compte"))}
              className="flex min-h-11 w-full items-center gap-3 rounded-sm px-3 text-left text-sm text-sidebar-foreground/80 transition-colors duration-200 hover:bg-sidebar-accent/60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring"
            >
              <UserRound className="h-5 w-5" aria-hidden="true" />
              {t("reglages.rubrique.mon_compte")}
            </button>
            <ChoixTheme surface="couverture" onError={setError} />
            {installer && (
              <button
                type="button"
                onClick={() => { setOpen(false); installer(); }}
                className="flex min-h-11 w-full items-center gap-3 rounded-sm px-3 text-left text-sm text-sidebar-foreground/80 transition-colors duration-200 hover:bg-sidebar-accent/60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring"
              >
                <Download className="h-5 w-5" aria-hidden="true" />
                {t("installation.entree")}
              </button>
            )}
            <button
              type="button"
              onClick={() => { setOpen(false); void logout(); }}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-sm border border-sidebar-border text-sm text-sidebar-foreground transition-colors duration-200 hover:bg-sidebar-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring"
            >
              {poste ? <Lock className="h-4 w-4" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
              {poste ? t("menu.verrouiller") : t("menu.deconnexion")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Barre d'onglets du téléphone (§ 3.3) : quatre destinations au plus selon le rôle, puis « Plus ». */
export function OngletsTelephone({ currentView }: { currentView: View }) {
  const { navigate } = useApp();
  const { account } = useAuth();
  const { t, lang } = useI18n();
  const installation = useInstaller();
  return (
    <nav
      aria-label={t("menu.navigation")}
      className="fixed inset-x-0 bottom-0 z-30 flex bg-sidebar pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] text-sidebar-foreground md:hidden"
    >
      {phoneTabs(account.role).map((view) => {
        const Icon = navIcon(view, account.role);
        const active = currentView === view;
        return (
          <button
            key={view}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => navigate(pathFor(view, lang))}
            className={cn(TAB, active ? "bg-sidebar-accent text-sidebar-foreground" : "text-sidebar-foreground/70")}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span className="max-w-full truncate">{t(viewLabelKey(view, account.role))}</span>
          </button>
        );
      })}
      <Plus currentView={currentView} installer={installation.visible ? installation.installer : null} />
      {/* Hors de la feuille « Plus », qui se ferme : la fenêtre des gestes iOS reste ouverte. */}
      {installation.fenetre}
    </nav>
  );
}
