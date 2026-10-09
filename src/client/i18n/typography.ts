/**
 * Contrôles typographiques des textes affichés (spec § 4.3), partagés par les
 * tests des dictionnaires du client, du serveur et des scripts.
 */

/** Noms propres, marques et noms d'écran qui gardent leur majuscule au milieu d'une phrase. */
const PROPER = new Set([
  "Google", "Drive", "WhatsApp", "Orange", "Money", "MTN", "Mobile", "Wi-Fi", "Excel",
  "Ubuntu", "Server", "Node", "French", "English", "Douala", "Réglages", "Connexions", "Sauvegardes",
  "Settings", "Connections", "Backups", "Institut", "Institute", "Ctrl-D", "Ctrl-C", "Gateway", "Android", "Mo",
  "Safari", "Windows", "Mac",
]);

/** Variables `{nom}` d'un texte, triées. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

/** Espace ordinaire avant `: ; ! ? »`, ponctuation collée (sauf `:`), `«` sans insécable, tiret cadratin. */
export function frenchFaults(text: string): string[] {
  const faults: string[] = [];
  if (text.includes("\u2014")) faults.push("tiret cadratin");
  if (/[\p{L}\p{N})}»'’.…] [:;!?»]/u.test(text)) faults.push("espace ordinaire avant une ponctuation haute");
  if (/[\p{L}\p{N})}][;!?»]/u.test(text)) faults.push("ponctuation haute collée");
  if (/«(?!\u00a0)/.test(text)) faults.push("« sans espace insécable");
  return faults;
}

/** Espace avant `: ; ! ?`, tiret cadratin. */
export function englishFaults(text: string): string[] {
  const faults: string[] = [];
  if (text.includes("\u2014")) faults.push("tiret cadratin");
  if (/[\s\u00a0][:;!?]/.test(text)) faults.push("espace avant une ponctuation");
  return faults;
}

/**
 * Mots en « Title Case » : majuscule initiale suivie de minuscules, ni en début
 * de texte ou de phrase (après `.` `!` `?` `:` `;` `«` `“` `(`), ni nom propre,
 * ni sigle tout en capitales. Un texte entre guillemets (« … » ou “…”) est le
 * nom d'un bouton ou d'un menu tel que l'appareil l'affiche (page du
 * certificat, distribution D-09) : il n'est pas examiné. Renvoie les mots fautifs.
 */
export function titleCaseFaults(text: string): string[] {
  const words = text.replace(/“[^”]*”/g, "“x”").replace(/«[^»]*»/g, "«x»").split(/[\s\u00a0\u202f]+/).filter(Boolean);
  const faults: string[] = [];
  words.forEach((raw, i) => {
    const word = raw.replace(/^[«“"'(\[]+|[»”"',.;:!?)\]…*]+$/g, "");
    if (i === 0 || !/^\p{Lu}\p{Ll}/u.test(word) || PROPER.has(word)) return;
    const previous = words[i - 1];
    if (/[.!?:;«“(]$/.test(previous) || /^[«“(]/.test(raw)) return;
    faults.push(word);
  });
  return faults;
}
