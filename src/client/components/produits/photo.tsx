import { useRef, useState } from "preact/hooks";
import { useI18n } from "@/i18n/provider";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { productImageUrl, productInitial } from "@/lib/produits";
import { cn } from "@/lib/utils";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";
/** Fenêtre plein écran sur fond blanc, à toutes les largeurs ; croix et Échap viennent de la fenêtre commune. */
const PLEIN_ECRAN = "bg-white text-[#161514] md:inset-0 md:left-0 md:top-0 md:max-h-none md:w-auto md:max-w-none md:translate-x-0 md:translate-y-0 md:rounded-none md:border-0";

/** Ce qu'il faut d'un produit pour montrer sa photo. */
export type AvecPhoto = { id: number; image_version?: number | null };

/**
 * Vignette carrée d'un produit (images des produits, spec § 2) : sa photo sur
 * fond blanc, ou une pastille neutre avec son initiale quand il n'en a pas ou
 * qu'elle ne se charge pas (session expirée, fichier disparu). Décorative :
 * le nom du produit est toujours écrit à côté.
 */
export function Vignette({ product, nom, taille = "h-10 w-10" }: { product: AvecPhoto; nom: string; taille?: string }) {
  const url = productImageUrl(product);
  const [broken, setBroken] = useState<string | null>(null);
  if (url && broken !== url) {
    return <img src={url} alt="" loading="lazy" onError={() => setBroken(url)} className={cn(taille, "shrink-0 rounded-sm border border-filet bg-white object-contain")} />;
  }
  return (
    <span aria-hidden="true" className={cn(taille, "flex shrink-0 items-center justify-center rounded-sm border border-filet bg-muted font-serif text-base text-encre-grise")}>
      {productInitial(nom)}
    </span>
  );
}

/** Vignette touchable (liste Produits) : ouvre la vue en grand ; zone de 48 px autour de la vignette de 40 px. */
export function PhotoTouchable({ product, nom }: { product: AvecPhoto; nom: string }) {
  const { t } = useI18n();
  const [ouverte, setOuverte] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOuverte(true)} aria-label={t("produit.voir_photo", { nom })} className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-sm", FOCUS)}>
        <Vignette product={product} nom={nom} />
      </button>
      {ouverte && <VueEnGrand product={product} nom={nom} onClose={() => setOuverte(false)} />}
    </>
  );
}

/** Vue en grand, pour montrer le produit à la cliente sur la tablette : plein écran, fond blanc, fermeture par la croix ou Échap. */
export function VueEnGrand({ product, nom, onClose }: { product: AvecPhoto; nom: string; onClose: () => void }) {
  const { t } = useI18n();
  const url = productImageUrl(product);
  // Élément qui avait le focus à l'ouverture : la fenêtre n'a pas de déclencheur Radix, le focus lui revient à la fermeture.
  const opener = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);
  const [broken, setBroken] = useState<string | null>(null);
  if (!url) return null;
  const retourFocus = (e: Event) => {
    e.preventDefault();
    if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
  };
  return (
    <Dialog open onOpenChange={(o: boolean) => { if (!o) onClose(); }}>
      <DialogContent className={PLEIN_ECRAN} onCloseAutoFocus={retourFocus}>
        <DialogTitle className="sr-only">{nom}</DialogTitle>
        <DialogDescription className="sr-only">{t("produit.photo_en_grand")}</DialogDescription>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
          {broken === url ? (
            <>
              <p className="font-serif text-xl">{nom}</p>
              <p className="text-sm text-[#6e6a64]">{t("produit.photo_indisponible")}</p>
            </>
          ) : (
            <img src={url} alt={nom} onError={() => setBroken(url)} className="max-h-full max-w-full object-contain" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
