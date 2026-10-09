import type { ComponentChildren } from "preact";
import { Search } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Page d'une liste de fiches (sous-projet 4 § 6) : titre, bouton cuir
 * « Nouveau… » pour les rôles autorisés, recherche en haut, puis la liste.
 * Conteneur (`@container`) : les lignes se mettent en page selon la largeur
 * réelle de la page, panneau posé compris (`hors-panneau`, 768 à 1279 px).
 */
export function PageFiches({ titre, action, recherche, filtres, children }: {
  titre: string;
  action?: { libelle: string; onClick: () => void } | null;
  recherche?: { valeur: string; onInput: (valeur: string) => void; placeholder: string } | null;
  /** Rangée de filtres sous la recherche (puces d'étiquettes des clientes, mini CRM). */
  filtres?: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    // Largeur de lecture bornée (64 rem) : nom et prix d'une ligne restent à portée d'œil sur grand écran.
    <div className="hors-panneau @container flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-serif text-3xl leading-tight">{titre}</h1>
        {action && (
          <Button onClick={action.onClick}>{action.libelle}</Button>
        )}
      </header>
      {recherche && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            aria-label={recherche.placeholder}
            className="pl-9"
            placeholder={recherche.placeholder}
            value={recherche.valeur}
            onInput={(e: Event) => recherche.onInput((e.target as HTMLInputElement).value)}
          />
        </div>
      )}
      {filtres}
      {children}
    </div>
  );
}

/**
 * Liste de fiches : cartes empilées tant qu'elle est étroite, lignes denses à
 * filet à partir de 36 rem de large (dense dès la tablette, panneau posé
 * compris). Le filet est le bas de chaque ligne (`LigneFiche`) : `divide-y`,
 * de spécificité nulle, était écrasé par la bordure de la ligne.
 */
export function ListeFiches({ libelle, children }: { libelle: string; children: ComponentChildren }) {
  return (
    <ul aria-label={libelle} className="flex min-w-0 flex-col gap-2 @xl:gap-0 @xl:rounded-sm @xl:border @xl:border-filet @xl:bg-card">
      {children}
    </ul>
  );
}

/**
 * Une fiche dans sa liste : toucher la ligne ouvre la fiche dans le panneau ;
 * plus de petites icônes sur chaque ligne (§ 6). `secondaire` passe sous le
 * nom tant que la liste fait moins de 56 rem (tablette en portrait), en
 * colonne au-delà ; `fin` (prix, stock, badge) reste à droite ; `apres` (lien
 * d'appel) est hors du bouton, jamais imbriqué dedans ; `avant` (photo
 * touchable d'un produit, images des produits) aussi, devant le bouton.
 */
export function LigneFiche({ titre, detail, secondaire, fin, pastille, avant, attenue = false, actif = false, onOpen, apres }: {
  titre: string;
  detail?: ComponentChildren;
  secondaire?: ComponentChildren;
  fin?: ComponentChildren;
  pastille?: ComponentChildren;
  avant?: ComponentChildren;
  attenue?: boolean;
  actif?: boolean;
  onOpen: () => void;
  apres?: ComponentChildren;
}) {
  const bouton = (
    <button
      type="button"
      onClick={onOpen}
      aria-current={actif ? "true" : undefined}
      className={cn(
        "flex min-h-12 min-w-0 flex-1 items-center gap-3 p-3 text-left transition-colors duration-200 hover:bg-muted @xl:px-4 @xl:py-2",
        FOCUS,
        attenue && "text-muted-foreground",
      )}
    >
      {pastille}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", !attenue && "font-medium")}>{titre}</span>
        {detail && <span className="block truncate text-sm text-muted-foreground">{detail}</span>}
        {secondaire && <span className="block truncate text-sm text-muted-foreground @4xl:hidden">{secondaire}</span>}
      </span>
      {secondaire && <span className="hidden w-48 shrink-0 truncate text-sm text-muted-foreground @4xl:block">{secondaire}</span>}
      {/* Largeur minimale en ligne dense : prix et stock restent alignés d'une ligne à l'autre ; un badge long (« Bloqué jusqu'à 06:45 ») tient sur une ligne. */}
      {fin && <span className="flex shrink-0 flex-col items-end gap-1 text-right text-sm @xl:w-auto @xl:min-w-32 @xl:whitespace-nowrap">{fin}</span>}
    </button>
  );
  return (
    <li className={cn(
      "flex min-w-0 flex-col rounded-sm border border-filet bg-card @xl:flex-row @xl:items-center @xl:rounded-none @xl:border-x-0 @xl:border-t-0 @xl:last:border-b-0 @xl:bg-transparent",
      actif && "bg-muted @xl:bg-muted",
    )}>
      {avant ? <div className="flex min-w-0 flex-1 items-center pl-1 @xl:pl-2">{avant}{bouton}</div> : bouton}
      {apres && <div className="flex shrink-0 items-center border-t border-filet px-1 @xl:border-0">{apres}</div>}
    </li>
  );
}
