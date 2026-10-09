import { useState } from "preact/hooks";
import { useApp } from "../context";
import { useAuth } from "../auth-context";
import { useI18n } from "@/i18n/provider";
import { pickText } from "@/lib/bilingual";
import { isOpen, productCommands } from "@/lib/fiches";
import { formatPrice } from "@/lib/format";
import { productImageUrl } from "@/lib/produits";
import type { Product } from "../types";
import { EtatVide, Montant } from "./comptoir";
import { CreateProduct } from "./create-product";
import { LigneFiche, ListeFiches, PageFiches } from "./fiches/liste-fiches";
import { Pagination } from "./pagination";
import { PhotoTouchable, Vignette } from "./produits/photo";

/** Vrai si le stock est au seuil d'alerte ou en dessous. */
export const isLowStock = (p: Pick<Product, "stock" | "low_stock_alert">) => p.stock <= p.low_stock_alert;

/** Badge « Stock bas » à l'encre rouge, au trait (jamais en pastille pleine). */
export function BadgeStockBas() {
  const { t } = useI18n();
  return <span className="etiquette inline-flex items-center rounded-sm border border-encre-rouge px-2 py-0.5 text-encre-rouge">{t("tableau.stock_bas")}</span>;
}

/**
 * Produits (sous-projet 4 § 6) : recherche côté serveur (noms français et
 * anglais, marque, référence, sans accents) ; chaque produit en carte (nom,
 * marque, prix, stock, badge « Stock bas »), sa fiche dans le panneau ;
 * « Nouveau produit » pour la gérante. Images des produits : vignette de 40 px
 * devant le nom, touchable vers la vue en grand ; sans photo, pastille avec
 * l'initiale.
 */
export function ProductList() {
  const { products, productsPag, setProductsPage, productsSearch, setProductsSearch, openPanel, panel } = useApp();
  const { account } = useAuth();
  const { t, lang } = useI18n();
  const commands = productCommands(account.role);
  const [creating, setCreating] = useState(false);

  return (
    <PageFiches
      titre={t("menu.produits")}
      action={commands.manage ? { libelle: t("produit.ajouter"), onClick: () => setCreating(true) } : null}
      recherche={{ valeur: productsSearch, onInput: setProductsSearch, placeholder: t("produit.rechercher") }}
    >
      {products.length === 0 ? (
        <EtatVide
          message={productsSearch ? t("produit.aucun") : t("produit.aucun_encore")}
          action={commands.manage && !productsSearch ? { libelle: t("produit.ajouter"), onClick: () => setCreating(true) } : undefined}
        />
      ) : (
        <ListeFiches libelle={t("menu.produits")}>
          {products.map((p) => {
            const low = isLowStock(p);
            const nom = pickText(lang, p.name, p.name_en);
            return (
              <LigneFiche
                key={p.id}
                titre={nom}
                detail={p.brand || undefined}
                secondaire={<>{t("produit.en_stock", { stock: p.stock })}{low && <> <BadgeStockBas /></>}</>}
                fin={
                  <span className="chiffres whitespace-nowrap font-medium"><Montant valeur={formatPrice(p.price, lang)} /></span>
                }
                avant={productImageUrl(p) ? <PhotoTouchable product={p} nom={nom} /> : undefined}
                pastille={productImageUrl(p) ? undefined : <Vignette product={p} nom={nom} />}
                actif={isOpen(panel, "product", p.id)}
                onOpen={() => openPanel("product", p.id)}
              />
            );
          })}
        </ListeFiches>
      )}
      <Pagination pag={productsPag} setPage={setProductsPage} />
      {creating && <CreateProduct onClose={() => setCreating(false)} />}
    </PageFiches>
  );
}
