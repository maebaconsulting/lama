import type { FunctionComponent } from "preact";
import { ChevronLeft, ChevronRight } from "lucide-preact";
import { useAuth } from "../../auth-context";
import { useApp } from "../../context";
import { sectionFor, sectionsFor, type SectionId } from "../../lib/roles";
import { pathFor } from "../../lib/routes";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/utils";
import { AEnvoyer } from "./a-envoyer";
import { Caisse } from "./caisse";
import { Comptes } from "./comptes";
import { Connexions } from "./connexions";
import { FileEnvoi } from "./file-envoi";
import { Fidelite } from "./fidelite";
import { Heure } from "./heure";
import { Formation } from "./formation";
import { useFormation } from "../../formation-context";
import { Institut } from "./institut";
import { Journal } from "./journal";
import { MonCompte } from "./mon-compte";
import { Postes } from "./postes";
import { Sauvegardes } from "./sauvegardes";
import { EnLigne } from "./en-ligne";
import { Import } from "./import";
import { Whatsapp } from "./whatsapp";

/** Toutes les rubriques des Réglages (spec 2 § 4). */
export const RUBRIQUES: Record<SectionId, FunctionComponent> = {
  "mon-compte": MonCompte,
  institut: Institut,
  caisse: Caisse,
  fidelite: Fidelite,
  whatsapp: Whatsapp,
  "en-ligne": EnLigne,
  import: Import,
  comptes: Comptes,
  postes: Postes,
  "a-envoyer": AEnvoyer,
  "file-envoi": FileEnvoi,
  sauvegardes: Sauvegardes,
  heure: Heure,
  formation: Formation,
  connexions: Connexions,
  journal: Journal,
};

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Réglages (sous-projet 4 § 7.1) : dès que le cadre fait 42 rem (largeur
 * réelle, rail et panneau compris, retouche 2), la liste des rubriques
 * permises à gauche et la rubrique ouverte à droite, séparées par un filet ;
 * plus étroit (téléphone, tablette en portrait rail déployé), `/reglages`
 * montre la liste seule, une rubrique s'ouvre sur toute la largeur avec
 * « Tous les réglages » pour revenir. Adresse de la rubrique dans la langue en
 * cours ; une adresse interdite est corrigée par `app.tsx`.
 */
export function Reglages({ section }: { section: string | null }) {
  const { account } = useAuth();
  const { navigate } = useApp();
  const { t, lang } = useI18n();
  const formation = useFormation();
  const current = sectionFor(account.role, section, formation);
  const Rubrique = RUBRIQUES[current];
  const go = (href: string) => (e: Event) => { e.preventDefault(); navigate(href); };

  // Seuil de 42 rem : cadre de 580 px à 820 px rail déployé (motif du téléphone),
  // 756 px rail replié, 940 px et plus au-delà (deux colonnes). Le conteneur ne
  // porte pas `hors-panneau` : la marge du panneau posé ne change pas le motif,
  // c'est la règle de styles.css qui efface alors la liste des rubriques.
  return (
    <div className="@container/reglages mx-auto max-w-6xl">
      <div className="hors-panneau @2xl/reglages:flex @2xl/reglages:gap-8 @2xl/reglages:px-8 @2xl/reglages:py-6">
        {/* Fiche ouverte dans le panneau posé (768 à 1279 px) : la liste s'efface, la rubrique garde sa largeur (styles.css). */}
        <nav aria-label={t("reglages.rubriques")} className={cn("rubriques-reglages px-4 py-6 @2xl/reglages:w-56 @2xl/reglages:shrink-0 @2xl/reglages:p-0", section !== null && "hidden @2xl/reglages:block")}>
          <h1 className="font-serif text-3xl leading-tight">{t("menu.reglages")}</h1>
          <ul className="mt-5 flex flex-col divide-y divide-border rounded-sm border border-filet bg-card @2xl/reglages:divide-y-0 @2xl/reglages:border-0 @2xl/reglages:bg-transparent">
            {sectionsFor(account.role, formation).map((s) => {
              const href = pathFor("reglages", lang, s.id);
              const active = s.id === current;
              return (
                <li key={s.id}>
                  <a
                    href={href}
                    aria-current={s.id === current ? "page" : undefined}
                    onClick={go(href)}
                    className={cn(
                      "flex min-h-12 items-center justify-between gap-3 px-4 text-base transition-colors duration-200 hover:bg-muted @2xl/reglages:rounded-sm @2xl/reglages:border-l-2 @2xl/reglages:border-transparent @2xl/reglages:px-3 @2xl/reglages:text-sm",
                      FOCUS,
                      active && "@2xl/reglages:border-primary @2xl/reglages:bg-muted @2xl/reglages:font-medium",
                    )}
                  >
                    <span className="min-w-0">{t(s.labelKey)}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-encre-grise @2xl/reglages:hidden" aria-hidden="true" />
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        {/* Rubrique sur la page blanche, sans cadre (retouche 5) : un filet vertical la sépare des rubriques. */}
        <section className={cn("min-w-0 flex-1 px-4 pb-8 pt-2 @2xl/reglages:border-l @2xl/reglages:border-filet @2xl/reglages:p-0 @2xl/reglages:pl-8", section === null && "hidden @2xl/reglages:block")}>
          <a
            href={pathFor("reglages", lang)}
            onClick={go(pathFor("reglages", lang))}
            className={cn("-ml-2 mb-3 inline-flex min-h-11 items-center gap-1 rounded-sm px-2 text-sm text-encre-grise hover:text-foreground @2xl/reglages:hidden", FOCUS)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {t("reglages.retour")}
          </a>
          {Rubrique && <Rubrique />}
        </section>
      </div>
    </div>
  );
}
