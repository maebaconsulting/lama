/*
 * Page de réservation dans une page du site de l'institut, en une ligne :
 *   <script src="https://reserver.exemple.com/integrer.js" data-salon="eclat" async></script>
 * placée à l'endroit voulu. data-salon (obligatoire) : identifiant du salon sur le relais.
 * Attributs facultatifs : data-lang="fr|en", data-titre="…", data-prestation="s12" (prestation choisie d'avance,
 * identifiant de l'offre publiée par lama ; ignoré s'il est mal formé, et la page montre la liste s'il n'est plus proposé).
 * Le cadre prend la hauteur que la page lui envoie ; seuls les messages de la page du relais sont écoutés.
 */
(function () {
  var script = document.currentScript;
  if (!script || !script.src || !script.dataset.salon) return;
  // Même motif que MOTIF_SALON dans relais/noyau/motifs.ts (copie : ce script est autonome).
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(script.dataset.salon)) return;
  var origine = new URL(script.src).origin;
  var lang = script.dataset.lang === "en" ? "en" : script.dataset.lang === "fr" ? "fr" : (navigator.language || "fr").slice(0, 2) === "en" ? "en" : "fr";
  var cadre = document.createElement("iframe");
  var parametres = new URLSearchParams();
  if (script.dataset.lang === "fr" || script.dataset.lang === "en") parametres.set("lang", script.dataset.lang);
  if (script.dataset.prestation && /^[A-Za-z0-9_-]{1,64}$/.test(script.dataset.prestation)) parametres.set("prestation", script.dataset.prestation);
  var requete = parametres.toString();
  cadre.src = origine + "/" + encodeURIComponent(script.dataset.salon) + "/" + (requete ? "?" + requete : "");
  cadre.title = script.dataset.titre || (lang === "en" ? "Appointment" : "Rendez-vous");
  cadre.loading = "lazy";
  cadre.style.cssText = "width:100%;border:0;min-height:520px;display:block;";
  // Jamais dans <head> (un cadre n'y est pas affiché) : à la place du script s'il est dans le corps, sinon à la fin du corps.
  function placer() {
    if (script.parentNode && script.parentNode !== document.head && document.body && document.body.contains(script)) script.parentNode.insertBefore(cadre, script);
    else document.body.appendChild(cadre);
  }
  if (document.body) placer();
  else document.addEventListener("DOMContentLoaded", placer);
  window.addEventListener("message", function (e) {
    if (e.origin !== origine || e.source !== cadre.contentWindow) return;
    var h = e.data && e.data.lamaRelaisHauteur;
    if (typeof h === "number" && h > 0 && h < 20000) cadre.style.height = Math.ceil(h) + "px";
    // Changement d'étape dans la page : le site défile jusqu'au haut du cadre s'il est au-dessus de l'écran.
    if (e.data && e.data.lamaRelaisHaut === true) {
      var haut = cadre.getBoundingClientRect().top;
      if (haut < 0) window.scrollTo({ top: window.pageYOffset + haut, behavior: "smooth" });
    }
  });
})();
