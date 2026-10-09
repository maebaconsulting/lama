import type { ComponentChildren } from "preact";
import { MarqueCadre } from "@/components/brand";
import { LangSwitch } from "@/components/lang-switch";
import { useI18n } from "@/i18n/provider";
import { contenuMarque } from "@/lib/marque";
import { useMarque } from "../../marque-context";
import { useFormation } from "../../formation-context";
import { useDemo } from "../../demo-context";
import { cn } from "@/lib/utils";

/**
 * Écran d'entrée : couverture de cuir, marque lama blanche (règle du logo :
 * blanc sur fond noir, spec d'identité § 3.1), fiche de papier au centre et
 * bouton FR / EN, qui change la langue retenue par l'appareil (spec § 3.1).
 * Sous-projet 4 § 7.2 : zones sûres de l'iPhone respectées (encoche, barre
 * du bas, paysage), fiche bordée d'un filet pour se détacher du cuir en thème
 * sombre ; `large` pour le choix de la personne (cartes sur deux colonnes).
 */
export function Couverture({ titre, sousTitre, large = false, children }: { titre: string; sousTitre?: string; large?: boolean; children?: ComponentChildren }) {
  const { t } = useI18n();
  const etat = useMarque();
  const kind = contenuMarque("entree", etat, false).kind;
  const formation = useFormation();
  const demo = useDemo() !== null;
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center gap-8 overflow-y-auto bg-sidebar pb-[calc(2.5rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[calc(4.5rem+env(safe-area-inset-top))] text-sidebar-foreground">
      <LangSwitch className="absolute right-[max(1rem,env(safe-area-inset-right))] top-[calc(1rem+env(safe-area-inset-top))]" />
      <MarqueCadre place="entree" />
      <main className={cn("w-full rounded-sm border border-sidebar-border bg-card p-6 text-foreground", large ? "max-w-lg" : "max-w-sm")}>
        {/* Base de formation (D-18) : dite avant même la connexion, du même bleu nuit que le bandeau des pages. */}
        {formation && <p role="status" className="mb-4 rounded-sm bg-[#2E3A5C] px-3 py-2 text-sm text-[#FBF9F4]">{t(demo ? "demo.bandeau_court" : "formation.bandeau_court")}</p>}
        <h1 className="font-serif text-2xl">{titre}</h1>
        {sousTitre && <p className="mt-1 text-sm text-encre-grise">{sousTitre}</p>}
        {children && <div className="mt-6">{children}</div>}
      </main>
      {(kind === "logo" || kind === "nom") && <p className="text-xs text-sidebar-foreground/60">{t("marque.propulse")}</p>}
    </div>
  );
}
