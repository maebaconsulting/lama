/**
 * Décisions du panneau de détail (sous-projet 4 § 3.3), sans dépendance au
 * navigateur pour être testées sous Node : ce que le panneau montre selon la
 * réponse du serveur, et quelles réponses il a encore le droit d'appliquer.
 */

/** Échec du chargement d'un élément, rattaché à l'élément demandé. */
export interface PanelError {
  id: number;
  message: string;
}

/** Contenu du panneau : la fiche, son chargement, ou l'erreur avec « Réessayer ». */
export type PanelView = { kind: "fiche" } | { kind: "chargement" } | { kind: "erreur"; message: string };

/**
 * Contenu du panneau ouvert sur `openId` : la fiche si l'élément chargé est
 * bien celui de l'adresse, l'erreur si l'échec concerne cet élément (jamais
 * celle d'un autre élément ouvert avant), sinon le chargement.
 */
export function panelView(openId: number, loadedId: number | null | undefined, error: PanelError | null): PanelView {
  if (loadedId === openId) return { kind: "fiche" };
  if (error && error.id === openId) return { kind: "erreur", message: error.message };
  return { kind: "chargement" };
}

/**
 * Élément qui reprend le focus à la fermeture du panneau : celui qui l'a
 * ouvert s'il est encore dans la page, sinon le conteneur de l'écran (lien
 * direct, où rien n'avait le focus, ou ligne disparue avec sa fiche).
 */
export function focusAfterClose<T extends { isConnected: boolean }>(opener: T | null, body: unknown, fallback: T | null): T | null {
  if (opener && opener !== body && opener.isConnected) return opener;
  return fallback;
}

/**
 * Faut-il rendre le focus au déclencheur à la fermeture ? Oui si le focus
 * était dans le panneau, sur la page entière ou sur un élément disparu ; non
 * s'il est déjà ailleurs dans l'écran (bouton du rail qui a changé d'écran,
 * champ de la page) : on ne le retire pas à la personne.
 */
export function shouldRestoreFocus<T extends { isConnected: boolean }>(active: T | null, body: unknown, insidePanel: boolean): boolean {
  return !active || active === body || insidePanel || !active.isConnected;
}

/** Ce que fait une touche pressée quand le panneau est ouvert. */
export type EscapeDecision = "ignorer" | "garder" | "fermer";

/**
 * Échap, où que soit le focus : ignorée si une fenêtre ou un menu par-dessus
 * l'a déjà traitée (ou est ouvert) ; le panneau reste ouvert si une saisie y
 * est en cours (note commencée), pour ne jamais la perdre ; sinon il se ferme.
 */
export function escapeDecision(event: { key: string; defaultPrevented: boolean }, overlayOpen: boolean, dirty: boolean): EscapeDecision {
  if (event.key !== "Escape" || event.defaultPrevented || overlayOpen) return "ignorer";
  return dirty ? "garder" : "fermer";
}

/** Vrai si l'un des champs de brouillon contient autre chose que des espaces. */
export function hasUnsavedText(values: string[]): boolean {
  return values.some((value) => value.trim() !== "");
}

/**
 * Sur téléphone, le panneau couvre tout l'écran : la page, l'en-tête, les
 * onglets et le « + » dessous deviennent inertes (ni focus, ni lecteur d'écran).
 * À partir de 768 px, le panneau est à côté de la page, qui reste active.
 */
export function inertBehindPanel(panelOpen: boolean, wide: boolean): boolean {
  return panelOpen && !wide;
}

/**
 * Chargements dont seule la dernière demande compte : ouvrir un élément puis
 * un autre avant la réponse du premier, la réponse (ou l'échec) tardive du
 * premier est ignorée, sans erreur. `cancel` ignore aussi la demande en cours
 * (panneau fermé).
 */
export function createLatest() {
  let current = 0;
  return {
    async run<R>(load: () => Promise<R>, apply: (result: R) => void): Promise<void> {
      const token = ++current;
      let result: R;
      try {
        result = await load();
      } catch (err) {
        if (token === current) throw err;
        return;
      }
      if (token === current) apply(result);
    },
    cancel(): void {
      current++;
    },
  };
}
