import { execFile } from "node:child_process";

const ACTIF = /^(activating|active|reloading|deactivating)$/;

/** État d'une unité lu sans droit particulier par `systemctl show` ; null si systemctl manque ou échoue. */
function etatUnite(unite: string): Promise<string | null> {
  return new Promise((rendre) => {
    execFile("systemctl", ["show", "-p", "ActiveState", "--value", unite], { timeout: 5000 }, (erreur, sortie) => {
      const etat = String(sortie).trim();
      rendre(erreur || !etat ? null : etat);
    });
  });
}

/**
 * Vrai pendant la sauvegarde de nuit (lama-sauvegarde.service en cours) ; faux si systemctl manque
 * (développement) ou échoue.
 */
export async function sauvegardeSystemeEnCours(): Promise<boolean> {
  const etat = await etatUnite("lama-sauvegarde.service");
  return etat !== null && ACTIF.test(etat);
}

/**
 * Vrai tant que lama-mise-a-jour.service tourne. Un état illisible (systemctl absent ou en échec)
 * rend vrai : l'opération de etat.json reste alors tenue pour en cours, comme avant cette lecture.
 */
export async function serviceMiseAJourActif(): Promise<boolean> {
  const etat = await etatUnite("lama-mise-a-jour.service");
  return etat === null || ACTIF.test(etat);
}
