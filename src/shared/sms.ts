/**
 * Compteur de SMS (spec du 04/10/2026, § 3) : un texte entièrement dans
 * l'alphabet GSM 7 bits tient 160 caractères en un SMS, 153 par segment
 * au-delà (les caractères d'extension comptent double) ; un seul caractère
 * hors alphabet (ê, ô, ç, À, espace insécable…) passe tout le texte en
 * Unicode : 70 caractères, puis 67 par segment. Fonctions pures, partagées
 * par le serveur et l'écran.
 */
const GSM = new Set([..."@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"]);
const GSM_EXTENSION = new Set([..."^{}\\[~]|€\f"]);

export function smsCount(text: string): { encoding: "gsm" | "unicode"; units: number; segments: number } {
  let units = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM.has(ch)) units += 1;
    else if (GSM_EXTENSION.has(ch)) units += 2;
    else { gsm = false; break; }
  }
  if (gsm) return { encoding: "gsm", units, segments: units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153) };
  units = text.length; // unités UTF-16, comme les compte le téléphone
  return { encoding: "unicode", units, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}

/** Longueurs types des variables des textes (`whatsapp/textes.ts`), d'où « environ » à l'écran. */
export const SAMPLE_LENGTHS: Record<string, number> = { prenom: 10, nom: 20, date: 18, heure: 5, prestation: 25, institut: 20, telephone: 13, document: 20, produit: 30, prix: 12, praticienne: 12 };

/** Nombre de SMS d'un texte à variables, chaque variable remplacée par un texte GSM de longueur type. */
export function estimateTemplate(template: string): number {
  const filled = template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(SAMPLE_LENGTHS, name) ? "x".repeat(SAMPLE_LENGTHS[name]) : whole));
  return smsCount(filled).segments;
}
