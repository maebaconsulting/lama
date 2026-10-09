import { useEffect, useState } from "preact/hooks";
import signeSvg from "@/assets/brand/signe-lama.svg?raw";
import { useI18n } from "@/i18n/provider";
import { contenuMarque, motVisible, PLACES_MARQUE, tailleSigne, type PlaceMarque } from "@/lib/marque";
import { cn } from "@/lib/utils";
import { useMarque } from "../marque-context";

/** Insère un SVG de la marque ; la couleur vient de `currentColor` (classe text-*). */
function BrandSvg({ svg, className, title }: { svg: string; className?: string; title?: string }) {
  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("inline-block [&>svg]:h-full [&>svg]:w-full", className)}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/**
 * Le signe lama, un seul trait calligraphique. Provisoire : il se remplace
 * dans `assets/brand/signe-lama.svg` sans toucher au code. Couleur selon le
 * fond : blanc (`text-papier`) sur le cuir, noir (`text-cuir`) sur le papier.
 */
export function SigneLama({ className, title }: { className?: string; title?: string }) {
  return <BrandSvg svg={signeSvg} className={className} title={title} />;
}

/** Le mot « lama » : Cormorant Garamond 300, minuscules, lettres espacées, comme sur la planche validée. */
export function MotLama({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span aria-hidden="true" className={cn("font-marque font-light lowercase leading-none tracking-[0.3em] pl-[0.3em]", className)}>
      {t("marque.nom")}
    </span>
  );
}

const TAILLES_LOGO: Record<PlaceMarque, string> = {
  entree: "max-h-28 max-w-64 object-contain",
  rail: "max-h-16 max-w-44 object-contain",
  replie: "",
  telephone: "max-h-9 max-w-36 object-contain",
};

const CORPS_NOM: Record<PlaceMarque, string> = {
  entree: "text-3xl",
  rail: "text-xl",
  replie: "text-lg",
  telephone: "text-lg",
};

/**
 * Marque du cadre, toujours blanche sur le cuir : écran d'entrée, rail ouvert
 * ou replié, en-tête du téléphone. Sans logo déposé : signe et mot lama, ou le
 * signe seul selon le réglage (« marque.ecran »). Avec un logo : le logo de
 * l'institut (et son nom selon le réglage), à défaut son nom ; initiales dans
 * le rail replié.
 */
export function MarqueCadre({ place }: { place: PlaceMarque }) {
  const { t } = useI18n();
  const etat = useMarque();
  const [enEchec, setEnEchec] = useState(false);
  useEffect(() => setEnEchec(false), [etat.sombre]);
  const contenu = contenuMarque(place, etat, enEchec);
  const mise = PLACES_MARQUE[place];
  const nomClasse = (corps: string) => cn("font-marque font-light leading-tight", corps);
  // Le logo porte son propre texte alternatif ; les autres contenus se lisent comme une seule image.
  const libelle = contenu.kind === "lama" ? t("marque.titre") : contenu.kind === "logo" ? undefined : etat.nom;

  return (
    <div
      role={libelle ? "img" : undefined}
      aria-label={libelle}
      className={cn("flex items-center text-papier", mise.disposition === "colonne" ? "flex-col gap-3" : "gap-2")}
    >
      {contenu.kind === "lama" && (
        <>
          <SigneLama className={tailleSigne(place, etat.ecran)} />
          {motVisible(place, etat.ecran) && mise.mot && <MotLama className={mise.mot} />}
        </>
      )}
      {contenu.kind === "logo" && (
        <>
          <img src={contenu.src} alt={etat.nom || t("marque.titre")} onError={() => setEnEchec(true)} className={TAILLES_LOGO[place]} />
          {contenu.nom && <span className={cn(nomClasse(CORPS_NOM[place]), "text-center")}>{contenu.nom}</span>}
        </>
      )}
      {contenu.kind === "nom" && <span aria-hidden="true" className={cn(nomClasse(CORPS_NOM[place]), "text-center")}>{contenu.nom}</span>}
      {contenu.kind === "initiales" && <span aria-hidden="true" className={nomClasse("pl-[0.1em] text-lg tracking-wider")}>{contenu.texte}</span>}
    </div>
  );
}
