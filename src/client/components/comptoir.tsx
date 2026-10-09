/**
 * Composants du registre « comptoir » (sous-projet 4 § 3.4), réutilisés par
 * les écrans des vagues suivantes : chiffres clés, listes, états communs,
 * bouton destructif avec confirmation. Tous suivent le thème par les jetons.
 */
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button } from "@/components/ui/button";
import { annuler, appuyer, cibleFocus, confirmer, type EtatConfirmation } from "./confirmation-destructive";
import { useI18n } from "@/i18n/provider";
import { amountFontSize, splitAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Montant à l'écran : jamais de coupure au milieu du nombre ni avant « F »
 * (retouche 2 du 30/09/2026 : « F » tombait seul à la ligne dans les chiffres
 * clés). Le nombre (à espace fine insécable) et « F » forment un seul bloc
 * insécable (`whitespace-nowrap`), joints par une espace insécable ; c'est la
 * taille du chiffre, pas la coupure, qui s'adapte à la place (`ChiffreCle`).
 * Une valeur qui n'a pas cette forme (nombre brut, texte de la charte)
 * s'affiche telle quelle.
 */
export function Montant({ valeur }: { valeur: string | number }) {
  const parts = typeof valeur === "string" ? splitAmount(valeur) : null;
  if (!parts) return <>{valeur}</>;
  return <span className="whitespace-nowrap">{parts[0]}{"\u00a0"}{parts[1]}</span>;
}

/**
 * Chiffre clé : bloc ivoire (touche), chiffre en linéal gras, libellé court ;
 * `alerte` à l'encre rouge (stock bas). La tuile est un conteneur : le chiffre
 * rétrécit selon sa largeur réelle pour tenir sur une ligne (`amountFontSize`).
 */
export function ChiffreCle({ valeur, libelle, alerte = false, onClick }: {
  valeur: string | number;
  libelle: string;
  alerte?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className={cn("max-w-full font-sans text-2xl font-medium leading-none tabular-nums", alerte && "text-encre-rouge")} style={{ fontSize: amountFontSize(valeur) }}><Montant valeur={valeur} /></span>
      <span className={cn("etiquette max-w-full leading-snug", alerte ? "text-encre-rouge" : "text-muted-foreground")}>{libelle}</span>
    </>
  );
  const box = "@container flex min-h-11 min-w-0 flex-col items-start justify-center gap-2 rounded-sm border bg-muted px-4 py-3 text-left";
  if (!onClick) return <div className={cn(box, alerte ? "border-encre-rouge" : "border-transparent")}>{content}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(box, FOCUS, "transition-colors duration-200", alerte ? "border-encre-rouge" : "border-transparent hover:border-foreground")}
    >
      {content}
    </button>
  );
}

/** Liste « comptoir » : cartes empilées sur téléphone, lignes denses à filet sur 768 px et plus. */
export function ListeComptoir({ libelle, children }: { libelle: string; children: ComponentChildren }) {
  return (
    <ul aria-label={libelle} className="flex min-w-0 flex-col gap-2 md:gap-0 md:divide-y md:divide-border md:rounded-sm md:border md:border-filet md:bg-card">
      {children}
    </ul>
  );
}

/**
 * Élément d'une liste : carte sur téléphone (titre, détail, méta, badge les
 * uns sous les autres), ligne de 48 px sur 768 px et plus. Aucune colonne ne
 * sort de l'écran : chaque texte rétrécit (`min-w-0`) et se coupe proprement.
 */
export function ElementListe({ titre, detail, meta, badge, actif = false, onOpen }: {
  titre: string;
  detail?: string;
  meta?: string;
  badge?: ComponentChildren;
  actif?: boolean;
  onOpen: () => void;
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        aria-current={actif ? "true" : undefined}
        className={cn(
          "flex w-full min-w-0 flex-col gap-1 rounded-sm border border-filet bg-card p-4 text-left transition-colors duration-200 hover:bg-muted",
          "md:min-h-12 md:flex-row md:items-center md:gap-4 md:rounded-none md:border-0 md:bg-transparent md:px-4 md:py-2",
          FOCUS,
          actif && "bg-muted md:bg-muted",
        )}
      >
        <span className="min-w-0 break-words font-medium md:w-2/5 md:shrink-0 md:truncate">{titre}</span>
        {detail && <span className="min-w-0 break-words text-sm text-muted-foreground md:flex-1 md:truncate">{detail}</span>}
        {meta && <span className="chiffres-tabulaires text-sm text-muted-foreground">{meta}</span>}
        {badge && <span className="shrink-0">{badge}</span>}
      </button>
    </li>
  );
}

/** Chargement discret, annoncé poliment aux lecteurs d'écran. */
export function EtatChargement({ libelle }: { libelle?: string }) {
  const { t } = useI18n();
  return <p role="status" aria-live="polite" className="py-8 text-center text-sm text-muted-foreground">{libelle ?? t("commun.chargement")}</p>;
}

/** État vide : un message et, s'il y en a une, l'action utile. */
export function EtatVide({ message, action }: { message: string; action?: { libelle: string; onClick: () => void } }) {
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <p className="max-w-prose text-sm text-muted-foreground">{message}</p>
      {action && <Button variant="outline" onClick={action.onClick}>{action.libelle}</Button>}
    </div>
  );
}

/** Erreur dans le panneau ou la page, à l'encre rouge, avec « Réessayer » si l'appel peut être refait. */
export function EtatErreur({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-sm border border-encre-rouge bg-card p-4 text-sm text-encre-rouge">
      <p className="max-w-prose">{message}</p>
      {onRetry && <Button variant="outline" onClick={onRetry}>{t("etat.reessayer")}</Button>}
    </div>
  );
}

/**
 * Action destructive en encre rouge, qui demande une confirmation avant
 * d'agir. La logique de l'automate (`appuyer`, `confirmer`, `annuler`) et
 * celle du focus (`cibleFocus`) vivent dans `confirmation-destructive.ts`,
 * testées en exécution ; ce composant ne fait que les appeler, afficher
 * l'état qui en résulte et déplacer le focus en conséquence : sur « Annuler »
 * (choix sûr) à l'entrée en confirmation, sur le bouton d'origine après une
 * annulation (bouton ou touche Échap), jamais après une confirmation qui a
 * agi (l'élément a pu disparaître de l'écran).
 */
export function BoutonDestructif({ libelle, question, onConfirm, disabled = false }: {
  libelle: string;
  question: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [etat, setEtat] = useState<EtatConfirmation>("repos");
  const declencheurRef = useRef<HTMLButtonElement>(null);
  const annulerRef = useRef<HTMLButtonElement>(null);
  const etatPrecedent = useRef<EtatConfirmation>("repos");
  const dernierDeclenche = useRef(false);

  useEffect(() => {
    const cible = cibleFocus(etatPrecedent.current, etat, dernierDeclenche.current);
    etatPrecedent.current = etat;
    if (cible === "annuler") annulerRef.current?.focus();
    else if (cible === "declencheur") declencheurRef.current?.focus();
  }, [etat]);

  const jouer = (resultat: { etat: EtatConfirmation; declenche: boolean }) => {
    dernierDeclenche.current = resultat.declenche;
    setEtat(resultat.etat);
    if (resultat.declenche) void onConfirm();
  };
  const surAnnuler = () => jouer(annuler(etat));
  const surEchap = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      surAnnuler();
    }
  };

  if (etat === "repos") {
    // Au repos, au trait rouge : l'aplat rouge est réservé au bouton qui confirme (revue impeccable, C2).
    return <Button ref={declencheurRef} variant="trait-rouge" disabled={disabled} onClick={() => jouer(appuyer(etat))}>{libelle}</Button>;
  }
  return (
    <div role="group" aria-label={question} className="flex flex-wrap items-center gap-2" onKeyDown={surEchap}>
      <span className="text-sm text-encre-rouge">{question}</span>
      <Button variant="destructive" disabled={disabled} onClick={() => jouer(confirmer(etat))}>{t("commun.confirmer")}</Button>
      <Button ref={annulerRef} variant="outline" onClick={surAnnuler}>{t("commun.annuler")}</Button>
    </div>
  );
}
