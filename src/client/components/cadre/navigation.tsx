import { AppNav } from "@clawnify/app/client";
import { Banknote, CalendarDays, Clock, Home, Package, Settings, Sparkles, Sun, UserCog, Users } from "lucide-preact";
import { api } from "../../api";
import { useAEnvoyer } from "../../hooks/use-a-envoyer";
import { useApp } from "../../context";
import { useAuth } from "../../auth-context";
import { useI18n } from "@/i18n/provider";
import type { Lang } from "@/i18n/translate";
import { railViews, viewLabelKey, type NavView } from "@/lib/cadre";
import { pathFor } from "@/lib/routes";
import type { View } from "../../types";

/** Icône de chaque rubrique ; l'accueil de la praticienne (« Ma journée ») prend le soleil. */
export const NAV_ICONS: Record<NavView, typeof CalendarDays> = {
  dashboard: Home,
  calendar: CalendarDays,
  appointments: Clock,
  caisse: Banknote,
  clients: Users,
  staff: UserCog,
  services: Sparkles,
  products: Package,
  reglages: Settings,
};

export function navIcon(view: NavView, role: string): typeof CalendarDays {
  return view === "dashboard" && role === "practitioner" ? Sun : NAV_ICONS[view];
}

/** Enregistre la langue choisie pour son propre compte (spec § 3.2) ; aucune donnée d'activité. */
export function saveOwnLang(lang: Lang): Promise<void> {
  return api("PUT", "/api/auth/me/language", { language: lang }).then(() => undefined);
}

/** Stock bas sur la rubrique Produits : aplat d'encre rouge, chiffre clair (règle du rouge sur cuir). */
export function CompteurStockBas() {
  const { stats } = useApp();
  const { tn } = useI18n();
  if (stats.low_stock_products <= 0) return null;
  return (
    <span role="img" aria-label={tn("stock_bas.pastille", stats.low_stock_products)} className="absolute -right-2 -top-2 inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-destructive bg-destructive px-1 text-xs leading-none text-destructive-foreground">
      {stats.low_stock_products}
    </span>
  );
}

/** Messages WhatsApp « À envoyer à la main » sur les Réglages (sous-projet 7 § 3), même aplat que le stock bas. */
export function CompteurAEnvoyer() {
  const count = useAEnvoyer();
  const { tn } = useI18n();
  if (count <= 0) return null;
  return (
    <span role="img" aria-label={tn("a_envoyer.pastille", count)} className="absolute -right-2 -top-2 inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-destructive bg-destructive px-1 text-xs leading-none text-destructive-foreground">
      {count}
    </span>
  );
}

/** Navigation fournie par l'hôte quand l'app est intégrée (mode agent de Clawnify), inchangée. */
export function NavigationIntegree({ currentView }: { currentView: View }) {
  const { navigate, stats } = useApp();
  const { account } = useAuth();
  const { t, lang } = useI18n();
  const ICONS: Record<NavView, string> = {
    dashboard: "home", calendar: "calendar-days", appointments: "clock", caisse: "banknote", clients: "users",
    staff: "users", services: "sparkles", products: "package", reglages: "settings",
  };
  return <AppNav title={t("marque.nom")} icon="calendar-days" active={currentView}
    groups={[{ items: railViews(account.role).map((view) => ({
      id: view, label: t(viewLabelKey(view, account.role)), href: pathFor(view, lang), icon: ICONS[view],
      home: view === "dashboard",
      count: view === "appointments" ? stats.appointments || undefined
        : view === "clients" ? stats.clients || undefined
        : view === "products" ? stats.low_stock_products || undefined : undefined,
    })) }]}
    onNavigate={(item) => navigate(item.href || "/")} />;
}
