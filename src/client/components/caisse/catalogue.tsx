import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Search, ZoomIn } from "lucide-preact";
import { useI18n } from "@/i18n/provider";
import { matchesSearch, pickText } from "@/lib/bilingual";
import { formatPrice } from "@/lib/format";
import { productImageUrl } from "@/lib/produits";
import { sellableAlone } from "@/lib/supplements";
import { quantityOf, type Ticket } from "@/lib/ticket";
import { cn } from "@/lib/utils";
import type { Product, Service } from "../../types";
import { EtatVide } from "../comptoir";
import { VueEnGrand, Vignette } from "../produits/photo";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";
/** Tuiles de 104 px, autant de colonnes que la place réelle du catalogue en permet. */
const TUILES = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-3";

type Onglet = "services" | "products";

/**
 * Une tuile : nom, durée ou marque, prix ; « Au ticket » ou stock bas.
 * Deux refus distincts (retouche 6) : en rupture (stock nul), nom, marque et
 * prix s'estompent, jamais le badge « Rupture », qui garde son contraste ; au
 * plafond (tout le stock est déjà au ticket), la tuile reste à pleine encre,
 * sur ivoire comme toute tuile au ticket, et le dit. Images des produits :
 * vignette devant le nom ; la loupe, posée à côté du bouton (jamais dedans),
 * ouvre la photo en grand sans rien ajouter au ticket.
 */
function Tuile({ titre, detail, prix, auTicket, stock, alerte, onAdd, vignette, onZoom }: {
  titre: string;
  detail: string;
  prix: number;
  auTicket: number;
  /** Stock restant d'un produit ; `null` pour une prestation. */
  stock: number | null;
  alerte: boolean;
  onAdd: () => void;
  /** Vignette d'un produit (photo ou initiale). */
  vignette?: ComponentChildren;
  /** Loupe vers la vue en grand ; absente sans photo. */
  onZoom?: () => void;
}) {
  const { t, lang } = useI18n();
  const epuise = stock !== null && stock <= 0;
  const plafond = stock !== null && stock > 0 && auTicket >= stock;
  const refuse = epuise || plafond;
  const pale = epuise && "opacity-50";
  return (
    <li className="relative min-w-0">
      <button
        type="button"
        aria-disabled={refuse ? "true" : undefined}
        onClick={() => { if (!refuse) onAdd(); }}
        className={cn(
          "flex h-full min-h-[6.5rem] w-full min-w-0 flex-col justify-between gap-2 rounded-sm border p-4 text-left transition-colors duration-200",
          auTicket > 0 ? "border-foreground bg-muted" : epuise ? "border-filet bg-card" : "border-filet bg-card hover:bg-muted",
          refuse && "cursor-not-allowed",
          FOCUS,
        )}
      >
        <span className={cn("flex min-w-0 gap-3", vignette ? "flex-col items-start gap-2" : "items-start")}>
          {vignette}
          <span className="w-full min-w-0">
            <span className={cn("line-clamp-2 break-words font-medium leading-tight", pale)}>{titre}</span>
            {detail && <span className={cn("mt-1 block truncate text-sm text-muted-foreground", pale)}>{detail}</span>}
          </span>
        </span>
        <span className="flex flex-wrap items-end justify-between gap-x-2 gap-y-1">
          <span className={cn("chiffres whitespace-nowrap text-lg leading-none", pale)}>{formatPrice(prix, lang)}</span>
          {epuise ? (
            <span className="rounded-sm border border-encre-rouge px-1.5 text-xs text-encre-rouge">{t("caisse.rupture")}</span>
          ) : plafond ? (
            <span className="etiquette min-w-0">{t("caisse.au_ticket_tout", { n: auTicket })}</span>
          ) : auTicket > 0 ? (
            <span className="etiquette whitespace-nowrap">{t("caisse.au_ticket", { n: auTicket })}</span>
          ) : alerte ? (
            <span className="whitespace-nowrap rounded-sm border border-encre-rouge px-1.5 text-xs text-encre-rouge">{t("caisse.en_stock", { n: stock ?? 0 })}</span>
          ) : null}
        </span>
      </button>
      {onZoom && (
        <button
          type="button"
          onClick={onZoom}
          aria-label={t("produit.voir_photo", { nom: titre })}
          className={cn("absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-sm text-encre-grise transition-colors duration-200 hover:bg-muted hover:text-foreground", FOCUS)}
        >
          <ZoomIn className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

/**
 * Catalogue de la vente (sous-projet 5 § 4.1) : onglets Prestations et
 * Produits, recherche sans accents, catégories en pastilles, tuiles ; un
 * toucher ajoute une unité au ticket. Images des produits : vignette sur
 * chaque produit, loupe vers la vue en grand.
 */
export function Catalogue({ services, products, ticket, onAdd }: {
  services: Service[];
  products: Product[] | null;
  ticket: Ticket;
  onAdd: (item: { kind: "service" | "product"; ref_id: number; stock?: number }) => void;
}) {
  const { t, lang } = useI18n();
  const [onglet, setOnglet] = useState<Onglet>("services");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Product | null>(null);

  // « Supplément seulement » (spec du 18/10/2026 § 3.1) : jamais de tuile seule, il s'ajoute sous une prestation.
  const actives = sellableAlone(services);
  const items = onglet === "services"
    ? actives.map((s) => ({ id: s.id, name: s.name, name_en: s.name_en, category: pickText(lang, s.category, s.category_en), extra: "", s, p: null as Product | null }))
    : (products ?? []).map((p) => ({ id: p.id, name: p.name, name_en: p.name_en, category: pickText(lang, p.category, p.category_en), extra: p.brand, s: null as Service | null, p }));
  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, lang));
  const shown = items.filter((i) => (category === null || i.category === category) && matchesSearch(search, i.name, i.name_en, i.extra));

  const choose = (next: Onglet) => { setOnglet(next); setCategory(null); };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div role="tablist" aria-label={t("caisse.catalogue")} className="flex shrink-0 border-b border-filet">
        {(["services", "products"] as const).map((o) => (
          <button
            key={o}
            type="button"
            role="tab"
            aria-selected={onglet === o}
            onClick={() => choose(o)}
            className={cn("etiquette -mb-px h-12 border-b-2 px-5", onglet === o ? "border-foreground text-foreground" : "border-transparent text-encre-grise hover:text-foreground", FOCUS)}
          >
            {o === "services" ? t("menu.prestations") : t("menu.produits")}
          </button>
        ))}
      </div>
      <label className="flex h-12 shrink-0 items-center gap-3 rounded-sm border border-input bg-card px-4 focus-within:outline focus-within:outline-1 focus-within:outline-offset-2 focus-within:outline-ring">
        <Search className="h-4 w-4 shrink-0 text-encre-grise" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onInput={(e: Event) => setSearch((e.currentTarget as HTMLInputElement).value)}
          placeholder={onglet === "services" ? t("caisse.chercher_prestation") : t("caisse.chercher_produit")}
          aria-label={onglet === "services" ? t("caisse.chercher_prestation") : t("caisse.chercher_produit")}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
      </label>
      {/* Au téléphone, une seule rangée qui défile bord à bord ; à la ligne au-delà de 42 rem (retouche 9). */}
      {categories.length > 1 && (
        <div role="group" aria-label={t("caisse.categories")} className="-mx-4 -my-1 flex shrink-0 gap-2 overflow-x-auto px-4 py-1 @2xl:mx-0 @2xl:flex-wrap @2xl:overflow-visible @2xl:px-0">
          {[null, ...categories].map((c) => (
            <button
              key={c ?? ""}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={cn("min-h-11 shrink-0 whitespace-nowrap rounded-sm border px-4 text-sm transition-colors duration-200", category === c ? "border-primary bg-primary text-primary-foreground" : "border-filet bg-card hover:bg-muted", FOCUS)}
            >
              {c ?? t("caisse.toutes")}
            </button>
          ))}
        </div>
      )}
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto pb-1">
        {shown.length === 0 ? (
          <EtatVide message={products === null && onglet === "products" ? t("commun.chargement") : t("caisse.aucun_article")} />
        ) : (
          <ul aria-label={onglet === "services" ? t("menu.prestations") : t("menu.produits")} className={TUILES}>
            {shown.map((i) => i.s ? (
              <Tuile
                key={`s${i.id}`}
                titre={pickText(lang, i.name, i.name_en)}
                detail={t("commun.minutes", { min: i.s.duration })}
                prix={i.s.price}
                auTicket={ticket.lines.filter((l) => l.kind === "service" && l.ref_id === i.id).length}
                stock={null}
                alerte={false}
                onAdd={() => onAdd({ kind: "service", ref_id: i.id })}
              />
            ) : (
              <Tuile
                key={`p${i.id}`}
                titre={pickText(lang, i.name, i.name_en)}
                detail={i.p!.brand}
                prix={i.p!.price}
                auTicket={quantityOf(ticket, i.id)}
                stock={i.p!.stock}
                alerte={i.p!.stock <= i.p!.low_stock_alert}
                onAdd={() => onAdd({ kind: "product", ref_id: i.id, stock: i.p!.stock })}
                vignette={<Vignette product={i.p!} nom={pickText(lang, i.name, i.name_en)} />}
                onZoom={productImageUrl(i.p!) ? () => setZoom(i.p!) : undefined}
              />
            ))}
          </ul>
        )}
      </div>
      {zoom && <VueEnGrand product={zoom} nom={pickText(lang, zoom.name, zoom.name_en)} onClose={() => setZoom(null)} />}
    </div>
  );
}
