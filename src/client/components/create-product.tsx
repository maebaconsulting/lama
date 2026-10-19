import { useState } from "preact/hooks";
import { useApp } from "../context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/provider";
import { modeSaisieMontant, parseAmount, texteSaisie } from "@/lib/format";
import { amountProblem, lowStockValue, nameProblem } from "@/lib/forms";
import type { Product } from "../types";
import { Erreur } from "./champ";

/** Produit : création, ou modification de `product`. Nom et catégorie ont leur version anglaise facultative juste en dessous (spec § 5.2). */
export function CreateProduct({ onClose, product }: { onClose: () => void; product?: Product }) {
  const { addProduct, updateProduct } = useApp();
  const { t, lang } = useI18n();
  const [name, setName] = useState(product?.name ?? "");
  const [nameEn, setNameEn] = useState(product?.name_en ?? "");
  const [brand, setBrand] = useState(product?.brand ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [categoryEn, setCategoryEn] = useState(product?.category_en ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [price, setPrice] = useState(texteSaisie(product ? product.price : 0, lang));
  const [cost, setCost] = useState(texteSaisie(product ? product.cost ?? 0 : 0, lang));
  const [stock, setStock] = useState(String(product?.stock ?? 0));
  const [lowStockAlert, setLowStockAlert] = useState(String(product?.low_stock_alert ?? 5));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    const problem = nameProblem(name) ?? amountProblem(price, "prix") ?? amountProblem(cost, "cout");
    if (problem) { setError(t(problem)); return; }
    const data = {
      name: name.trim(), name_en: nameEn.trim(), brand, category: category.trim(), category_en: categoryEn.trim(), sku,
      price: parseAmount(price),
      cost: parseAmount(cost),
      stock: parseInt(stock) || 0,
      low_stock_alert: lowStockValue(lowStockAlert),
    };
    setSaving(true);
    try {
      if (product) await updateProduct(product.id, data);
      else await addProduct(data);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>{product ? t("produit.modifier_titre") : t("produit.ajouter")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fpr-nom">{t("donnee.nom_fr")}</Label>
            <Input id="fpr-nom" lang="fr" value={name} onChange={(e: Event) => setName((e.target as HTMLInputElement).value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fpr-nom-en">{t("donnee.nom_en")}</Label>
            <Input id="fpr-nom-en" lang="en" value={nameEn} onChange={(e: Event) => setNameEn((e.target as HTMLInputElement).value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fpr-marque">{t("colonne.marque")}</Label>
            <Input id="fpr-marque" value={brand} onChange={(e: Event) => setBrand((e.target as HTMLInputElement).value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fpr-categorie">{t("donnee.categorie_fr")}</Label>
            <Input id="fpr-categorie" lang="fr" value={category} onChange={(e: Event) => setCategory((e.target as HTMLInputElement).value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fpr-categorie-en">{t("donnee.categorie_en")}</Label>
            <Input id="fpr-categorie-en" lang="en" value={categoryEn} onChange={(e: Event) => setCategoryEn((e.target as HTMLInputElement).value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fpr-sku">{t("produit.sku")}</Label>
            <Input id="fpr-sku" value={sku} onChange={(e: Event) => setSku((e.target as HTMLInputElement).value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fpr-prix">{t("produit.prix_vente")}</Label>
              {/* Champ de texte, non "number" : un "number" ne transmet jamais une saisie avec espace ("15 000"), la valeur arrive vide (décision du contrôleur, écart 1). */}
              <Input id="fpr-prix" type="text" inputMode={modeSaisieMontant()} value={price} onChange={(e: Event) => setPrice((e.target as HTMLInputElement).value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fpr-cout">{t("produit.cout")}</Label>
              <Input id="fpr-cout" type="text" inputMode={modeSaisieMontant()} value={cost} onChange={(e: Event) => setCost((e.target as HTMLInputElement).value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fpr-stock">{t("colonne.stock")}</Label>
              <Input id="fpr-stock" type="number" min="0" step="1" value={stock} onChange={(e: Event) => setStock((e.target as HTMLInputElement).value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fpr-seuil">{t("produit.seuil")}</Label>
              <Input id="fpr-seuil" type="number" min="0" step="1" value={lowStockAlert} onChange={(e: Event) => setLowStockAlert((e.target as HTMLInputElement).value)} />
            </div>
          </div>
        </div>
        <Erreur message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("commun.annuler")}</Button>
          <Button disabled={saving} onClick={handleSubmit}>
            {saving ? t("commun.enregistrement") : product ? t("commun.enregistrer_modifications") : t("produit.ajouter")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
