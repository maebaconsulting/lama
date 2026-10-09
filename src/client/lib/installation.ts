/**
 * Invitation à installer lama sur l'écran d'accueil (PWA, P-06), en fonctions
 * pures et un petit relais de l'événement `beforeinstallprompt` (Android,
 * ordinateur), capté dès le démarrage par `main.tsx`. Testé sous Node.
 */
export type Plateforme = "ios" | "autre";

/** iPhone, iPad, iPod ; un iPad récent se présente comme un Mac, mais tactile. */
export function plateformeDe(userAgent: string, maxTouchPoints: number): Plateforme {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "ios";
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return "ios";
  return "autre";
}

/** lama déjà ouvert depuis l'écran d'accueil : `display-mode: standalone`, ou `navigator.standalone` sur iOS. */
export function estInstallee(o: { standalone: boolean; iosStandalone: boolean | undefined }): boolean {
  return o.standalone || o.iosStandalone === true;
}

/**
 * Ce que fait l'entrée « Installer lama sur cet appareil » : `invite` ouvre le
 * dialogue du navigateur, `ios` la fenêtre des trois gestes, `aucun` la masque
 * (déjà installé, http sans certificat, ou navigateur qui ne sait pas installer).
 */
export type ModeInstallation = "aucun" | "invite" | "ios";

export function modeInstallation(o: { securise: boolean; installee: boolean; plateforme: Plateforme; invite: boolean }): ModeInstallation {
  if (!o.securise || o.installee) return "aucun";
  if (o.invite) return "invite";
  return o.plateforme === "ios" ? "ios" : "aucun";
}

/** Téléphone ou tablette : pointeur grossier (doigt), ou appareil iOS. */
export function estTactile(o: { pointeurGrossier: boolean; plateforme: Plateforme }): boolean {
  return o.pointeurGrossier || o.plateforme === "ios";
}

/** Bandeau unique : sur un téléphone ou une tablette où lama peut s'installer, tant qu'il n'a pas été fermé sur cet appareil. */
export function doitProposerBandeau(o: { mode: ModeInstallation; tactile: boolean; ferme: boolean }): boolean {
  return o.mode !== "aucun" && o.tactile && !o.ferme;
}

/** Événement `beforeinstallprompt` (Chrome, Edge, Samsung Internet), gardé pour l'appui sur « Installer ». */
export interface InviteInstallation {
  preventDefault(): void;
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let invite: InviteInstallation | null = null;
let installeeIci = false;
const abonnes = new Set<() => void>();
const prevenir = () => { for (const abonne of [...abonnes]) abonne(); };

/** Capte l'invitation du navigateur (sans la mini-barre d'installation de Chrome) et l'installation faite. */
export function capterInstallation(cible: { addEventListener(type: string, ecouteur: (e: Event) => void): void }): void {
  cible.addEventListener("beforeinstallprompt", (e) => {
    const evenement = e as unknown as InviteInstallation;
    evenement.preventDefault();
    invite = evenement;
    prevenir();
  });
  cible.addEventListener("appinstalled", () => {
    invite = null;
    installeeIci = true;
    prevenir();
  });
}

export function etatInvite(): { invite: boolean; installeeIci: boolean } {
  return { invite: invite !== null, installeeIci };
}

export function onInstallation(ecouteur: () => void): () => void {
  abonnes.add(ecouteur);
  return () => { abonnes.delete(ecouteur); };
}

/** Ouvre le dialogue d'installation du navigateur (une invitation ne sert qu'une fois ; un refus du navigateur rend « indisponible »). */
export async function lancerInvite(): Promise<"accepted" | "dismissed" | "indisponible"> {
  const courante = invite;
  if (!courante) return "indisponible";
  invite = null;
  prevenir();
  try {
    await courante.prompt();
    return (await courante.userChoice).outcome;
  } catch {
    // Chrome refuse (invitation déjà utilisée, geste perdu) : l'invitation reste consommée, l'entrée est relue ensuite.
    return "indisponible";
  }
}

/** Remet l'état à zéro entre deux essais. */
export function oublierInstallationPourEssai(): void {
  invite = null;
  installeeIci = false;
  abonnes.clear();
}
