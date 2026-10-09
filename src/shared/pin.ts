/**
 * Règle du code PIN des postes partagés, commune à l'écran et au serveur :
 * l'écran refuse un PIN trop simple avant d'envoyer le formulaire (et avant
 * la demande de mot de passe), le serveur reste juge. Sans dépendance.
 */

/** PIN de 4 à 6 chiffres. */
export function pinFormatOk(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

/** PIN trop facile à deviner : chiffres répétés (0000), suite (1234, 4321) ou paire répétée (1212). */
export function pinTooSimple(pin: string): boolean {
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  const repeated = steps.every((s) => s === 0);
  const sequence = steps.every((s) => s === 1) || steps.every((s) => s === -1);
  const pairs = pin.length % 2 === 0 && pin === pin.slice(0, 2).repeat(pin.length / 2);
  return repeated || sequence || pairs;
}
