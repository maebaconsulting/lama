import { useRef, useState } from "preact/hooks";
import { api, apiUpload } from "../../api";
import { useApp } from "../../context";
import { useDemo } from "../../demo-context";
import type { Product } from "../../types";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { PRODUCT_IMAGE_MAX_BYTES, productImageUrl } from "@/lib/produits";
import { cn } from "@/lib/utils";
import { Erreur, Succes } from "../champ";
import { ConfirmerSuppression } from "../confirmer-suppression";
import { VueEnGrand } from "./photo";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Bloc « Photo » de la fiche d'un produit (images des produits, spec § 2) :
 * aperçu sur fond blanc, toucher pour la vue en grand ; la gérante dépose,
 * remplace ou retire (ConfirmerSuppression, comme les autres boutons rouges), refus du serveur
 * affichés comme pour le logo ; les autres rôles la voient sans la changer.
 */
export function PhotoProduit({ product, nom, gerer }: { product: Product; nom: string; gerer: boolean }) {
  const { t } = useI18n();
  const { refreshProduct } = useApp();
  // Démonstration publique (DP-06) : aucune photo reçue ni retirée.
  const demo = useDemo() !== null;
  const fichier = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirmer, setConfirmer] = useState(false);
  const [grand, setGrand] = useState(false);
  const [broken, setBroken] = useState<string | null>(null);
  const url = productImageUrl(product);

  const deposer = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setOk(null);
    setError(null);
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
      setError(t("image.trop_lourd"));
      return;
    }
    setPending(true);
    try {
      await apiUpload("PUT", `/api/products/${product.id}/image`, file);
      await refreshProduct(product.id);
      setOk(t("produit.photo_enregistree"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  /** Lancé par ConfirmerSuppression : la fenêtre reste ouverte, boutons grisés, jusqu'à la fin de la requête (V1-29). */
  const retirer = async () => {
    setOk(null);
    setError(null);
    setPending(true);
    try {
      await api("DELETE", `/api/products/${product.id}/image`);
      await refreshProduct(product.id);
      setOk(t("produit.photo_retiree"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-label={t("produit.photo")} className="space-y-3">
      <p className="etiquette text-encre-grise">{t("produit.photo")}</p>
      <div className="flex h-48 items-center justify-center rounded-sm border border-filet bg-white p-3">
        {/* Photo absente ou qui ne se charge pas : « Aucune photo », jamais une image cassée. */}
        {url && broken !== url ? (
          <button type="button" onClick={() => setGrand(true)} aria-label={t("produit.voir_photo", { nom })} className={cn("flex h-full w-full items-center justify-center", FOCUS)}>
            <img src={url} alt="" onError={() => setBroken(url)} className="max-h-full max-w-full object-contain" />
          </button>
        ) : (
          <span className="text-sm text-[#6e6a64]">{t("produit.photo_aucune")}</span>
        )}
      </div>
      {gerer && demo && <p className="text-xs text-muted-foreground">{t("demo.fichiers_coupes")}</p>}
      {gerer && !demo && (
        <>
          <p className="text-xs text-muted-foreground">{t("produit.photo_conseil")}</p>
          <input ref={fichier} type="file" accept="image/png,image/jpeg" className="hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => void deposer(e)} data-testid="photo-produit-fichier" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => fichier.current?.click()}>
              {t(url ? "produit.photo_remplacer" : "produit.photo_deposer")}
            </Button>
            {url && <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirmer(true)}>{t("produit.photo_retirer")}</Button>}
          </div>
          <Erreur message={error} />
          <Succes message={ok} />
        </>
      )}
      {confirmer && (
        <ConfirmerSuppression
          titre={t("produit.photo_retirer_confirmer")}
          detail={nom}
          action={t("produit.photo_retirer")}
          onConfirm={retirer}
          onClose={() => setConfirmer(false)}
        />
      )}
      {grand && <VueEnGrand product={product} nom={nom} onClose={() => setGrand(false)} />}
    </section>
  );
}
