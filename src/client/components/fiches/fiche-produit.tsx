import { useState } from "preact/hooks";
import { Minus, Plus } from "lucide-preact";
import { useApp } from "../../context";
import { useAuth } from "../../auth-context";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { pickText } from "@/lib/bilingual";
import { productCommands, stockAfter } from "@/lib/fiches";
import { EMPTY, formatPrice } from "@/lib/format";
import { canSeeManual } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { Montant } from "../comptoir";
import { CreateProduct } from "../create-product";
import { BadgeStockBas, isLowStock } from "../product-list";
import { FenetreEnvoiProduit } from "../produits/envoi-produit";
import { PhotoProduit } from "../produits/photo-produit";
import { ACTION, EnTeteFiche, LigneDetail, SuppressionFiche } from "./corps-fiche";

/**
 * Fiche d'un produit dans le panneau (sous-projet 4 § 6) : prix, stock avec
 * ses boutons − et + (gérante et réception ; un appui à la fois, jamais sous
 * zéro), seuil d'alerte, marque, catégorie, référence, coût ; pour la
 * gérante : Modifier et Supprimer. Images des produits : bloc Photo (dépôt
 * et retrait par la gérante).
 */
export function FicheProduit() {
  const { selectedProduct: product, updateProduct, deleteProduct, closePanel, setError } = useApp();
  const { account } = useAuth();
  const { t, lang } = useI18n();
  const commands = productCommands(account.role);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  if (!product) return null;
  const name = pickText(lang, product.name, product.name_en);
  const other = lang === "fr" ? product.name_en : product.name;
  const low = isLowStock(product);

  /** − ou + : le stock enregistré est relu dans la fiche ; boutons inactifs pendant l'envoi (double appui). */
  const adjust = async (delta: number) => {
    setSaving(true);
    try {
      await updateProduct(product.id, { stock: stockAfter(product.stock, delta) });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 p-4">
      <EnTeteFiche titre={name} sousTitre={other && other !== name ? other : undefined} />
      <PhotoProduit product={product} nom={name} gerer={commands.photo} />

      <section aria-label={t("colonne.stock")} className={cn("space-y-3 rounded-sm border bg-card p-4", low ? "border-encre-rouge" : "border-filet")}>
        <div className="flex items-center justify-between gap-3">
          <p className="etiquette text-encre-grise">{t("colonne.stock")}</p>
          {low && <BadgeStockBas />}
        </div>
        <div className="flex items-center justify-between gap-3">
          {commands.adjustStock && (
            <Button variant="outline" size="icon" className="h-12 w-12" aria-label={t("produit.retirer_un")} disabled={saving || product.stock <= 0} onClick={() => adjust(-1)}>
              <Minus className="h-5 w-5" aria-hidden="true" />
            </Button>
          )}
          <p className="flex-1 text-center" aria-live="polite">
            <span className={cn("font-sans text-4xl font-medium tabular-nums", low && "text-encre-rouge")}>{product.stock}</span>
          </p>
          {commands.adjustStock && (
            <Button variant="outline" size="icon" className="h-12 w-12" aria-label={t("produit.ajouter_un")} disabled={saving} onClick={() => adjust(1)}>
              <Plus className="h-5 w-5" aria-hidden="true" />
            </Button>
          )}
        </div>
        <p className="text-center text-sm text-muted-foreground">{t("produit.seuil_alerte", { seuil: product.low_stock_alert })}</p>
      </section>

      {commands.manage && (
        <Button variant="outline" className={cn(ACTION, "w-full")} onClick={() => setEditing(true)}>{t("commun.modifier")}</Button>
      )}

      {canSeeManual(account.role) && (
        <Button variant="outline" className={cn(ACTION, "w-full")} onClick={() => setEnvoi(true)}>{t("whatsapp.envoyer_a_cliente")}</Button>
      )}

      <dl className="grid gap-4 border-t border-filet pt-4 @md:grid-cols-2">
        <LigneDetail libelle={t("produit.prix_de_vente")}><span className="chiffres text-lg font-medium"><Montant valeur={formatPrice(product.price, lang)} /></span></LigneDetail>
        {product.cost !== undefined && <LigneDetail libelle={t("colonne.cout")}><span className="chiffres"><Montant valeur={formatPrice(product.cost, lang)} /></span></LigneDetail>}
        <LigneDetail libelle={t("colonne.marque")}>{product.brand || EMPTY}</LigneDetail>
        <LigneDetail libelle={t("colonne.categorie")}>{pickText(lang, product.category, product.category_en) || EMPTY}</LigneDetail>
        <LigneDetail libelle={t("produit.sku")}>{product.sku || EMPTY}</LigneDetail>
      </dl>

      {commands.manage && (
        <SuppressionFiche
          question={t("produit.supprimer_question", { nom: name })}
          onDelete={async () => { await deleteProduct(product.id); closePanel(); }}
        />
      )}

      {editing && <CreateProduct key={product.id} product={product} onClose={() => setEditing(false)} />}
      {envoi && <FenetreEnvoiProduit productId={product.id} onClose={() => setEnvoi(false)} />}
    </div>
  );
}
