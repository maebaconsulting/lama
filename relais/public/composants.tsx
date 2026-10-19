import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { Institut } from "./parcours.ts";
import { NOM_MAX, PRENOM_MAX, type Saisie } from "./saisie.ts";
import { t, type CleTexte, type Lang } from "./textes.ts";

/** Éléments partagés par les écrans de la page. */

/** Refus après lesquels la cliente n'a plus que le téléphone de l'institut comme issue. */
const AVEC_APPEL: CleTexte[] = ["refus.ferme", "refus.trop_ip"];

export function lienAppel(telephone: string): string {
  return `tel:${telephone.replace(/\s/g, "")}`;
}

/** Message à la cliente ; avec le téléphone de l'institut, les refus sans autre issue proposent de l'appeler. */
export function Avis({ lang, cle, ton = "info", telephone = "" }: { lang: Lang; cle: CleTexte | null; ton?: "info" | "erreur"; telephone?: string }) {
  if (!cle) return null;
  return (
    <div class={`avis avis-${ton}`} role={ton === "erreur" ? "alert" : "status"}>
      <p>{t(lang, cle)}</p>
      {telephone && AVEC_APPEL.includes(cle) ? <a class="bouton-secondaire" href={lienAppel(telephone)}>{t(lang, "ferme.appeler")}</a> : null}
    </div>
  );
}

export function ErreurReseau({ lang, reessayer }: { lang: Lang; reessayer: () => void }) {
  return (
    <div class="avis avis-erreur" role="alert">
      <p>{t(lang, "erreur.reseau")}</p>
      <button type="button" class="bouton-secondaire" onClick={reessayer}>{t(lang, "commun.reessayer")}</button>
    </div>
  );
}

export function Retour({ lang, onClick }: { lang: Lang; onClick: () => void }) {
  return <button type="button" class="retour" onClick={onClick}>← {t(lang, "commun.retour")}</button>;
}

type ApiTurnstile = {
  render: (element: HTMLElement, options: { sitekey: string }) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
  getResponse: (id: string) => string | undefined;
};
declare global {
  interface Window { turnstile?: ApiTurnstile }
}

/** Widget en place (un seul formulaire à la fois), pour le remettre à zéro après chaque envoi. */
let widgetTurnstile: string | null = null;

/**
 * Widget Turnstile (option, désactivée par défaut), dessiné explicitement à chaque montage du formulaire : le dessin automatique ne voit pas
 * un widget monté après le chargement du script. Le script est attendu au plus 10 s.
 */
export function Turnstile({ cleSite }: { cleSite: string | null }) {
  const conteneur = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!cleSite) return;
    if (!document.querySelector("script[data-turnstile]")) {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.dataset.turnstile = "1";
      document.head.appendChild(s);
    }
    let id: string | null = null;
    let essais = 0;
    const attente = setInterval(() => {
      if (window.turnstile && conteneur.current) {
        clearInterval(attente);
        id = window.turnstile.render(conteneur.current, { sitekey: cleSite });
        widgetTurnstile = id;
      } else if (++essais >= 100) clearInterval(attente);
    }, 100);
    return () => {
      clearInterval(attente);
      if (id !== null) {
        try { window.turnstile?.remove(id); } catch { /* widget déjà retiré */ }
        if (widgetTurnstile === id) widgetTurnstile = null;
      }
    };
  }, [cleSite]);
  return cleSite ? <div class="cf-turnstile" ref={conteneur} /> : null;
}

export function jetonTurnstile(): string | undefined {
  return (widgetTurnstile !== null ? window.turnstile?.getResponse(widgetTurnstile) : undefined) || undefined;
}

/** À appeler après chaque tentative d'envoi : un jeton Turnstile ne sert qu'une fois. */
export function reinitialiserTurnstile(): void {
  if (widgetTurnstile === null) return;
  try { window.turnstile?.reset(widgetTurnstile); } catch { /* widget disparu */ }
}

let premierTitre = true;

/** Titre de l'étape : prend le focus au changement d'étape (lecteurs d'écran, clavier), pas à l'ouverture de la page. */
export function Titre({ id, children }: { id?: string; children: ComponentChildren }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!premierTitre) ref.current?.focus({ preventScroll: true });
    premierTitre = false;
  }, []);
  return <h2 class="titre" id={id} tabIndex={-1} ref={ref}>{children}</h2>;
}

/** Revient en haut de l'étape, et en haut du cadre quand la page est intégrée dans le site (integrer.js fait défiler le site). */
export function versLeHaut(): void {
  window.scrollTo(0, 0);
  if (window.parent !== window) window.parent.postMessage({ lamaRelaisHaut: true }, "*");
}

export function ChampsCliente({ lang, institut, saisie, changer, note = true }: {
  lang: Lang; institut: Institut; saisie: Saisie; changer: (s: Saisie) => void; note?: boolean;
}) {
  const maj = (champ: "prenom" | "nom" | "telephone" | "note") => (e: Event) => changer({ ...saisie, [champ]: (e.currentTarget as HTMLInputElement).value });
  return (
    <>
      <label class="champ">
        <span>{t(lang, "coordonnees.prenom")}</span>
        <input type="text" autoComplete="given-name" aria-required="true" maxLength={PRENOM_MAX} value={saisie.prenom} onInput={maj("prenom")} />
      </label>
      <label class="champ">
        <span>{t(lang, "coordonnees.nom")}</span>
        <input type="text" autoComplete="family-name" aria-required="true" maxLength={NOM_MAX} value={saisie.nom} onInput={maj("nom")} />
      </label>
      <label class="champ">
        <span>{t(lang, "coordonnees.telephone")}</span>
        <input type="tel" inputMode="tel" autoComplete="tel" value={saisie.telephone} onInput={maj("telephone")} />
      </label>
      {institut.langues.length > 1 ? (
        <label class="champ">
          <span>{t(lang, "coordonnees.langue")}</span>
          <select value={saisie.langue} onChange={(e) => changer({ ...saisie, langue: e.currentTarget.value as Lang })}>
            {institut.langues.map((l) => <option key={l} value={l} lang={l}>{t(l === "fr" ? "en" : "fr", "langue.autre")}</option>)}
          </select>
        </label>
      ) : null}
      {note ? (
        <label class="champ">
          <span>{t(lang, "coordonnees.note")}</span>
          <textarea rows={2} maxLength={1000} value={saisie.note} onInput={maj("note")} />
        </label>
      ) : null}
      {institut.texte_donnees[lang] ? <p class="donnees">{institut.texte_donnees[lang]}</p> : null}
      <label class="case">
        <input type="checkbox" checked={saisie.accord} onChange={(e) => changer({ ...saisie, accord: e.currentTarget.checked })} />
        <span>{t(lang, "coordonnees.accord")}</span>
      </label>
      <label class="case">
        <input type="checkbox" checked={saisie.memoriser} onChange={(e) => changer({ ...saisie, memoriser: e.currentTarget.checked })} />
        <span>{t(lang, "coordonnees.memoriser")}</span>
      </label>
      {/* Champ piège : invisible pour une personne, rempli par les robots (protection contre les abus). */}
      <div class="piege" aria-hidden="true">
        <input type="text" name="site_web" tabIndex={-1} autoComplete="off" value={saisie.piege} onInput={(e) => changer({ ...saisie, piege: e.currentTarget.value })} />
      </div>
    </>
  );
}
