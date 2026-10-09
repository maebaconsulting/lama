/**
 * Démonstration publique derrière un proxy (démo publique DP-07) : Traefik,
 * dans Dokploy, reçoit le https et parle à lama en http sur le réseau interne.
 * Avec `LAMA_PROXY_HTTPS=1`, une requête dont l'en-tête `X-Forwarded-Proto`
 * vaut `https` est tenue pour https (cookies `__Host-` et `Secure`). Sans
 * cette variable, l'en-tête est ignoré : le mini-PC de l'institut n'a pas de
 * proxy, et un appareil du Wi-Fi pourrait l'écrire lui-même.
 */

/**
 * Vrai si la requête est arrivée en https : écoute https de lama, ou proxy de
 * confiance qui le dit. Seule la dernière valeur de `X-Forwarded-Proto` compte,
 * celle du proxy le plus proche (un proxy qui ajoute garde devant les valeurs
 * reçues, que le client a pu écrire).
 */
export function requeteHttps(o: { ecouteHttps: boolean; proxyHttps: boolean; forwardedProto: string | undefined }): boolean {
  if (o.ecouteHttps) return true;
  if (!o.proxyHttps || !o.forwardedProto) return false;
  return o.forwardedProto.split(",").at(-1)!.trim().toLowerCase() === "https";
}
