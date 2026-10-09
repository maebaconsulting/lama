import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { useI18n } from "@/i18n/provider";
import { encreVars, toInk } from "@/lib/inks";
import { BoutonDestructif } from "../comptoir";

/** Pastille d'encre d'un membre de l'équipe ou d'une prestation (sa couleur dans l'agenda). */
export function PastilleEncre({ color, grande = false }: { color: string | null | undefined; grande?: boolean }) {
  return <span className={`${grande ? "mt-2 h-4 w-4" : "h-3 w-3"} inline-block shrink-0 rounded-sm encre-fond`} style={encreVars(toInk(color))} aria-hidden="true" />;
}

/** Boutons de la rangée d'actions d'une fiche : libellé sur deux lignes plutôt que coupé dans un panneau étroit. */
export const ACTION = "h-auto min-h-11 whitespace-normal px-3 py-2 text-center leading-tight";

/** En-tête d'une fiche dans le panneau : le nom en grand, une ligne discrète dessous. */
export function EnTeteFiche({ titre, sousTitre, pastille }: { titre: string; sousTitre?: ComponentChildren; pastille?: ComponentChildren }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      {pastille}
      <div className="min-w-0 space-y-1">
        <p className="break-words font-serif text-3xl leading-tight">{titre}</p>
        {sousTitre && <p className="text-sm text-muted-foreground">{sousTitre}</p>}
      </div>
    </div>
  );
}

/** Une ligne du corps d'une fiche : libellé discret au-dessus, valeur dessous. */
export function LigneDetail({ libelle, children }: { libelle: string; children: ComponentChildren }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="etiquette text-encre-grise">{libelle}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

/**
 * Suppression d'une fiche, en bas, au trait rouge avec confirmation. Le
 * serveur la refuse quand la fiche a un historique (409) : son message dit
 * pourquoi et quoi faire à la place (désactiver), dans la fiche. Quand
 * l'écran sait déjà que l'historique existe (`bloquee`), le bouton laisse la
 * place à cette explication : pas de geste proposé pour être refusé.
 */
export function SuppressionFiche({ question, onDelete, bloquee }: { question: string; onDelete: () => Promise<void>; bloquee?: string | null }) {
  const { t } = useI18n();
  const [refus, setRefus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setRefus(null);
    try {
      await onDelete();
    } catch (err) {
      setRefus((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (bloquee) return <p className="border-t border-filet pt-4 text-sm text-muted-foreground">{bloquee}</p>;
  return (
    <div className="space-y-3 border-t border-filet pt-4">
      {refus && <p role="alert" className="text-sm text-encre-rouge">{refus}</p>}
      <BoutonDestructif libelle={t("commun.supprimer")} question={question} disabled={busy} onConfirm={run} />
    </div>
  );
}
