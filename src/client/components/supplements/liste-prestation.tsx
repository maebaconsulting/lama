import { useEffect, useRef, useState } from "preact/hooks";
import { ArrowDown, ArrowUp, Search, X } from "lucide-preact";
import { api } from "../../api";
import { useApp } from "../../context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/provider";
import { matchesSearch, pickText } from "@/lib/bilingual";
import { formatPrice } from "@/lib/format";
import { byCategory } from "@/lib/prestations";
import { copyTargets, moveSupplement, pickable, removeSupplement } from "@/lib/supplements";
import type { Product, Service, SupplementRef } from "../../types";
import { Erreur } from "../champ";
import { BoutonDestructif } from "../comptoir";

/** Nombre de produits demandés au serveur en une fois. */
const PRODUITS_MAX = 1000;

/**
 * Produits du catalogue, chargés seulement quand `actif` (la recherche est faite par le
 * serveur) ; `connus` garde tous les produits déjà vus pour nommer ceux de la liste même
 * quand la recherche les écarte. `total` dépasse `products.length` si le serveur en a plus.
 */
export function useProduits(actif: boolean, search = "") {
  const [etat, setEtat] = useState<{ products: Product[]; total: number; error: string | null }>({ products: [], total: 0, error: null });
  const connus = useRef(new Map<number, Product>());
  useEffect(() => {
    if (!actif) return;
    let annule = false;
    const terme = search.trim();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: String(PRODUITS_MAX) });
        if (terme) params.set("search", terme);
        const r = await api<{ products: Product[]; total: number }>("GET", `/api/products?${params}`);
        if (annule) return;
        for (const p of r.products) connus.current.set(p.id, p);
        setEtat({ products: r.products, total: r.total, error: null });
      } catch (err) {
        if (!annule) setEtat((e) => ({ ...e, error: (err as Error).message }));
      }
    }, terme ? 250 : 0);
    return () => { annule = true; clearTimeout(timer); };
  }, [actif, search]);
  return { ...etat, connus: connus.current };
}

/** Bouton qui reçoit le focus après un déplacement ou un retrait : ligne `i`, action `act`, ou la recherche. */
type Focus = { i: number; act: "monter" | "descendre" | "retirer" } | "recherche";

/**
 * Suppléments possibles d'une prestation (gérante, spec du 18/10/2026 § 3.1) : liste ordonnée
 * de prestations et de produits ; monter, descendre, retirer, ajouter par la recherche. La
 * prestation elle-même, celles qui ont leur propre liste et celles déjà choisies ne sont pas
 * proposées ; le serveur refuse de même.
 */
export function ListeSupplements({ service, onClose }: { service: Service; onClose: () => void }) {
  const { services, saveServiceSupplements } = useApp();
  const { t, lang } = useI18n();
  const [items, setItems] = useState<SupplementRef[]>(service.supplements ?? []);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState("");
  const [focus, setFocus] = useState<Focus | null>(null);
  const liste = useRef<HTMLOListElement>(null);
  const recherche = useRef<HTMLInputElement>(null);
  const { products, total, error: erreurProduits, connus } = useProduits(true, search);
  // Article introuvable (produit pas encore chargé, supprimé ou hors des premiers) : jamais un nom vide.
  const nom = (ref: SupplementRef) => {
    const item = ref.kind === "service" ? services.find((s) => s.id === ref.ref_id) : connus.get(ref.ref_id);
    return item ? pickText(lang, item.name, item.name_en) : t("caisse.article_retire");
  };
  const choix = pickable(services, products, service.id, items);
  const detail = (categorie: string, prix: number) => [categorie, formatPrice(prix, lang)].filter(Boolean).join(" · ");
  const trouves = search.trim() === "" ? [] : [
    ...choix.services.filter((s) => matchesSearch(search, s.name, s.name_en)).map((s) => ({ ref: { kind: "service" as const, ref_id: s.id }, nom: pickText(lang, s.name, s.name_en), detail: detail(pickText(lang, s.category, s.category_en), s.price) })),
    ...choix.products.map((p) => ({ ref: { kind: "product" as const, ref_id: p.id }, nom: pickText(lang, p.name, p.name_en), detail: detail(pickText(lang, p.category, p.category_en), p.price) })),
  ].slice(0, 20);

  // Le focus suit l'article déplacé (le bouton opposé si le sien est désactivé en bord de liste) ou la ligne qui prend la place d'un article retiré.
  useEffect(() => {
    if (!focus) return;
    const cible = focus === "recherche" ? recherche.current : liste.current?.querySelector<HTMLElement>(`[data-i="${focus.i}"] [data-act="${focus.act}"]`);
    cible?.focus();
    setFocus(null);
  }, [focus]);

  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    setItems(moveSupplement(items, i, by));
    setAnnonce(t("prestation.supplement_position", { nom: nom(items[i]), n: j + 1, total: items.length }));
    const enButee = by === -1 ? j === 0 : j === items.length - 1;
    setFocus({ i: j, act: enButee ? (by === -1 ? "descendre" : "monter") : (by === -1 ? "monter" : "descendre") });
  };
  const retirer = (i: number) => {
    const r = removeSupplement(items, i);
    setItems(r.items);
    setFocus(r.focus === null ? "recherche" : { i: r.focus, act: "retirer" });
  };
  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await saveServiceSupplements(service.id, items);
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
        <DialogHeader><DialogTitle>{t("prestation.supplements_possibles")}</DialogTitle></DialogHeader>
        {items.length === 0 ? <p className="text-sm text-muted-foreground">{t("prestation.aucun_supplement")}</p> : (
          <ol ref={liste} className="divide-y divide-border rounded-sm border border-filet">
            {items.map((ref, i) => (
              <li key={`${ref.kind}${ref.ref_id}`} data-i={i} className="flex items-center gap-1 px-2 py-1 text-sm">
                <span className="min-w-0 flex-1 break-words">{nom(ref)}</span>
                {ref.kind === "product" && <span className="text-xs text-muted-foreground">{t("prestation.article_produit")}</span>}
                <Button variant="ghost" size="icon" data-act="monter" disabled={i === 0} aria-label={t("prestation.supplement_monter", { nom: nom(ref) })} onClick={() => move(i, -1)}><ArrowUp aria-hidden="true" /></Button>
                <Button variant="ghost" size="icon" data-act="descendre" disabled={i === items.length - 1} aria-label={t("prestation.supplement_descendre", { nom: nom(ref) })} onClick={() => move(i, 1)}><ArrowDown aria-hidden="true" /></Button>
                <Button variant="ghost" size="icon" data-act="retirer" aria-label={t("supplement.retirer", { nom: nom(ref) })} onClick={() => retirer(i)}><X aria-hidden="true" /></Button>
              </li>
            ))}
          </ol>
        )}
        <p className="sr-only" aria-live="polite">{annonce}</p>
        <label className="flex h-12 items-center gap-3 rounded-sm border border-input bg-card px-4 focus-within:outline focus-within:outline-1 focus-within:outline-offset-2 focus-within:outline-ring">
          <Search className="h-4 w-4 shrink-0 text-encre-grise" aria-hidden="true" />
          <input
            ref={recherche}
            type="search"
            value={search}
            onInput={(e: Event) => setSearch((e.currentTarget as HTMLInputElement).value)}
            placeholder={t("prestation.chercher_article")}
            aria-label={t("prestation.chercher_article")}
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
          />
        </label>
        {total > products.length && <p className="text-xs text-muted-foreground">{t("prestation.produits_tronques", { n: products.length })}</p>}
        <p className="sr-only" aria-live="polite">{search.trim() === "" ? "" : t("prestation.resultats", { n: trouves.length })}</p>
        {trouves.length > 0 && (
          <ul className="max-h-48 divide-y divide-border overflow-auto rounded-sm border border-filet">
            {trouves.map((r) => (
              <li key={`${r.ref.kind}${r.ref.ref_id}`}>
                <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm hover:bg-muted" onClick={() => { setItems([...items, r.ref]); setSearch(""); setFocus("recherche"); }}>
                  <span className="min-w-0 break-words">{r.nom}{r.ref.kind === "product" && <span className="ml-2 text-xs text-muted-foreground">{t("prestation.article_produit")}</span>}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{r.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Erreur message={error ?? erreurProduits} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("commun.annuler")}</Button>
          <Button disabled={saving} onClick={save}>{saving ? t("commun.enregistrement") : t("commun.enregistrer")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * « Recopier vers… » (spec § 3.1) : la même liste appliquée aux prestations cochées, celles du
 * même univers cochées d'avance ; la copie remplace la liste de chaque cible, après confirmation.
 */
export function RecopierSupplements({ service, onClose }: { service: Service; onClose: () => void }) {
  const { services, copyServiceSupplements } = useApp();
  const { t, lang } = useI18n();
  const { candidates, preselected } = copyTargets(services, service);
  const [chosen, setChosen] = useState(() => new Set(preselected));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const basculer = (id: number) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChosen(next);
  };
  const copy = async () => {
    setError(null);
    setSaving(true);
    try {
      await copyServiceSupplements(service.id, [...chosen]);
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
          <DialogTitle>{t("prestation.recopier_titre", { nom: pickText(lang, service.name, service.name_en) })}</DialogTitle>
          <DialogDescription>{t("prestation.recopier_aide")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-3 overflow-auto">
          {byCategory(candidates, lang).map((group) => (
            <fieldset key={group.category} className="space-y-1">
              <legend className="font-serif text-base leading-tight">{group.category || t("prestation.sans_categorie")}</legend>
              {group.services.map((s) => (
                <label key={s.id} className="flex min-h-11 items-center gap-2">
                  <input type="checkbox" checked={chosen.has(s.id)} onChange={() => basculer(s.id)} />
                  <span>{pickText(lang, s.name, s.name_en)}</span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <Erreur message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("commun.annuler")}</Button>
          <BoutonDestructif libelle={t("prestation.recopier_confirmer")} question={t("prestation.recopier_question")} disabled={chosen.size === 0 || saving} onConfirm={copy} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
