import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { useI18n } from "@/i18n/provider"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-sidebar/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

/** Nom du bouton de fermeture, lu par les lecteurs d'écran, dans la langue de l'écran. */
function CloseLabel() {
  return <>{useI18n().t("commun.fermer")}</>
}

/**
 * Fenêtre. Sous 768 px, une fenêtre de formulaire occupe tout l'écran (zones
 * sûres comprises), titre en haut et actions en bas, fixes ; à partir de
 * 768 px, carte centrée à filet cuir. `compact` garde une carte centrée même
 * au téléphone (confirmation brève : supprimer, mot de passe). À l'ouverture,
 * le focus va sur la fenêtre, pas dans le premier champ (pas de texte
 * surligné ni de clavier qui surgit) ; `focusChamp` rend la main au champ
 * marqué `autoFocus` quand la saisie est la seule action (mot de passe).
 */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { compact?: boolean; focusChamp?: boolean }
>(({ className, children, compact = false, focusChamp = false, ...props }, ref) => {
  // Structure en colonne : l'en-tête (DialogHeader) et le pied (DialogFooter),
  // s'ils sont présents, restent hors de la zone qui défile. Un pied "sticky"
  // au sein d'une grille pouvait recouvrir la fin du corps (relecture 1,
  // constat D12) : avec flex-col, le corps (flex-1 min-h-0 overflow-y-auto)
  // ne peut plus jamais passer sous le pied, qui garde sa propre place.
  const items = React.Children.toArray(children) as React.ReactNode[];
  const isOf = (child: React.ReactNode, type: unknown) => React.isValidElement(child) && (child as { type?: unknown }).type === type;
  const header = items.filter((child) => isOf(child, DialogHeader));
  const footer = items.filter((child) => isOf(child, DialogFooter));
  const body = items.filter((child) => !header.includes(child) && !footer.includes(child));
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-compact={compact ? "" : undefined}
        className={cn(
          "group/fenetre fixed z-50 flex flex-col gap-4 bg-card duration-200 focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          compact
            ? "inset-x-4 top-[50%] max-h-[calc(100dvh-2rem)] translate-y-[-50%] rounded-sm border border-foreground p-6"
            : "inset-0 pb-[calc(1rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[calc(1rem+env(safe-area-inset-top))]",
          "md:inset-auto md:left-[50%] md:top-[50%] md:max-h-[90vh] md:max-h-[calc(100dvh-2rem)] md:w-full md:max-w-lg md:translate-x-[-50%] md:translate-y-[-50%] md:rounded-sm md:border md:border-foreground md:p-6 md:data-[state=closed]:zoom-out-95 md:data-[state=open]:zoom-in-95",
          className
        )}
        {...props}
        onOpenAutoFocus={(event: Event) => {
          const own = (props as { onOpenAutoFocus?: (event: Event) => void }).onOpenAutoFocus;
          if (own) return own(event);
          if (focusChamp) return;
          event.preventDefault();
          (event.target as HTMLElement | null)?.focus?.({ preventScroll: true });
        }}
        onEscapeKeyDown={(event: KeyboardEvent) => {
          // Échap ferme d'abord un calendrier ouvert (ChampDate), pas la fenêtre.
          if ((event.target as Element | null)?.closest?.("[data-calendrier-ouvert]")) event.preventDefault();
          (props as { onEscapeKeyDown?: (event: KeyboardEvent) => void }).onEscapeKeyDown?.(event);
        }}
      >
        {header}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">{body}</div>
        {footer}
        <DialogPrimitive.Close className="absolute right-[max(0.5rem,env(safe-area-inset-right))] top-[calc(0.5rem+env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none group-data-[compact]/fenetre:right-2 group-data-[compact]/fenetre:top-2 data-[state=open]:bg-accent data-[state=open]:text-muted-foreground md:right-2 md:top-2">
          <X className="h-4 w-4" />
          <span className="sr-only"><CloseLabel /></span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // Titre à gauche partout, à l'écart de la croix ; au téléphone, filet sous l'en-tête fixe.
      "flex shrink-0 flex-col gap-1.5 pr-12 text-left max-md:border-b max-md:border-filet max-md:pb-4 group-data-[compact]/fenetre:border-0 group-data-[compact]/fenetre:pb-0",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // Le pied est désormais hors de la zone qui défile (voir DialogContent) :
      // il n'a plus besoin d'être "sticky", il garde toujours sa place.
      // Au téléphone : actions pleine largeur, l'action principale en haut, filet au-dessus du pied fixe.
      "flex shrink-0 flex-col-reverse gap-2 max-md:border-t max-md:border-filet max-md:pt-4 group-data-[compact]/fenetre:border-0 group-data-[compact]/fenetre:pt-0 md:flex-row md:justify-end",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "font-serif text-lg font-medium leading-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
