import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/provider";
import { formatPrice } from "@/lib/format";
import { choicesFor } from "@/lib/supplements";
import { quantityOf } from "@/lib/ticket";
import type { Ticket, TicketSupplement } from "@/lib/ticket";
import { cn } from "@/lib/utils";
import type { Product, Service } from "../../types";
import { ChampsLibre } from "../supplements/libre";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * « + Supplément » d'une prestation du ticket (spec du 18/10/2026 § 3.4) : ses suppléments
 * possibles (un toucher en ajoute un) et, sauf pour la praticienne, un supplément libre.
 * Rien n'est envoyé avant « Encaisser » ; le serveur relit les prix du catalogue.
 */
export function FenetreSupplement({ ticket, serviceId, nom, catalog, libre, onDone, onClose }: {
  /** Ticket en cours : un produit déjà pris en entier (ligne seule et suppléments) n'est plus proposé. */
  ticket: Ticket;
  serviceId: number;
  nom: string;
  catalog: { services: Service[]; products: Product[] };
  libre: boolean;
  onDone: (sup: TicketSupplement, stock?: number) => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const choix = choicesFor(serviceId, catalog, lang);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("supplement.titre", { nom })}</DialogTitle>
        </DialogHeader>
        {choix.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("supplement.aucun_propose")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-sm border border-filet">
            {choix.map((c) => {
              const stock = c.kind === "product" ? catalog.products.find((p) => p.id === c.ref_id)?.stock : undefined;
              const rupture = stock !== undefined && quantityOf(ticket, c.ref_id) >= stock;
              return (
                <li key={`${c.kind}${c.ref_id}`}>
                  <button
                    type="button"
                    disabled={rupture}
                    className={cn("flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors duration-200 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50", FOCUS)}
                    onClick={() => onDone({ kind: c.kind, ref_id: c.ref_id, quantity: 1 }, stock)}
                  >
                    <span className="min-w-0 break-words">{c.label}</span>
                    <span className="chiffres-tabulaires shrink-0 text-muted-foreground">{rupture ? t("caisse.en_stock", { n: 0 }) : formatPrice(c.price, lang)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {libre && <ChampsLibre minutes={false} onAdd={(l) => onDone({ kind: "libre", ref_id: null, quantity: 1, label: l.label, price: l.price })} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("commun.annuler")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
