/**
 * Numéros et heures des messages WhatsApp (sous-projet 7 § 2 et § 3), sans
 * accès à la base : normalisation des numéros, heure d'un rendez-vous et
 * fenêtre de silence, à l'heure de Douala (UTC+1 toute l'année).
 */

const DOUALA_OFFSET_MS = 3600e3;
const DAY_MS = 86_400_000;

/**
 * Numéro saisi → format international en chiffres seuls (`237699123456`),
 * ou `null` s'il est impossible à normaliser. `+` ou `00` : déjà
 * international ; sinon l'indicatif par défaut est ajouté (le 0 national
 * retiré), sauf si le numéro le porte déjà et a la longueur d'un numéro complet.
 */
export function normalizePhone(raw: string, countryCode: string): string | null {
  const text = raw.trim();
  if (!/^[+\d\s().\-/]*$/.test(text)) return null;
  let digits = text.replace(/\D/g, "");
  if (text.startsWith("+")) {
    // Déjà international.
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (!(digits.startsWith(countryCode) && digits.length >= countryCode.length + 8)) {
    digits = countryCode + digits.replace(/^0+/, "");
  }
  // E.164 : au plus 15 chiffres ; au moins 10 pour écarter un numéro tronqué.
  return /^[1-9]\d{9,14}$/.test(digits) ? digits : null;
}

/**
 * Instant (ms) d'un rendez-vous : date `aaaa-mm-jj` et heure `hh:mm` de
 * Douala. L'heure est complétée sur deux chiffres (`9:30` → `09:30`) : la
 * date ISO exigée par `Date.parse` refuse sinon un chiffre d'heure seul,
 * ce qui rendait l'instant invalide (`NaN`).
 */
export function appointmentAt(date: string, time: string): number {
  const [hour = "00", minute = "00"] = time.split(":");
  return Date.parse(`${date}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:00+01:00`);
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Fin de la fenêtre de silence (ms) si `now` y tombe, sinon `null`. La
 * fenêtre peut passer minuit (21:00 à 08:00) ; début égal à la fin : aucun silence.
 */
export function silenceEnd(now: number, start: string, end: string): number | null {
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (s === e) return null;
  const sinceMidnight = (((now + DOUALA_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  const m = Math.floor(sinceMidnight / 60_000);
  const inside = s < e ? m >= s && m < e : m >= s || m < e;
  if (!inside) return null;
  const midnight = now - sinceMidnight;
  const endAt = midnight + e * 60_000;
  return endAt > now ? endAt : endAt + DAY_MS;
}

export function inSilence(now: number, start: string, end: string): boolean {
  return silenceEnd(now, start, end) !== null;
}
