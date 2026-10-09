/**
 * Adresse d'un appareil du réseau de l'institut (`a.b.c.d` ou `a.b.c.d:port`)
 * en hôte et port ; `null` si elle est invalide. Seule une IPv4 du réseau
 * local est acceptée (10/8, 172.16/12, 192.168/16) : jamais un nom, jamais
 * la machine elle-même, pour que le serveur ne puisse pas être tourné vers un
 * autre service. `allowLoopback` : essais seulement (fausse imprimante, fausse
 * passerelle sur 127.0.0.1), jamais en service.
 */
export function parseLocalAddress(text: string, defaultPort: number, allowLoopback = false): { host: string; port: number } | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{1,5}))?$/.exec(text.trim());
  if (!m) return null;
  const [a, b, c, d] = m.slice(1, 5).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return null;
  const local = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  if (!local && !(allowLoopback && a === 127)) return null;
  const port = m[5] === undefined ? defaultPort : Number(m[5]);
  return port >= 1 && port <= 65535 ? { host: `${a}.${b}.${c}.${d}`, port } : null;
}
