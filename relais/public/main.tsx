import "@fontsource/jost/400.css";
import "@fontsource/jost/500.css";
import "@fontsource/eb-garamond/400.css";
import "@fontsource/eb-garamond/500.css";
import "@fontsource/cormorant-garamond/300.css";
import "./styles.css";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api, choisirSalon, ErreurApi } from "./api.ts";
import { Reservation } from "./app.tsx";
import { ErreurReseau, lienAppel } from "./composants.tsx";
import { ecrireLangue, lireLangue } from "./memoire.ts";
import { jetonDepuisAncre, langueInitiale, prestationDepuisAdresse, salonDepuisChemin, type Vitrine } from "./parcours.ts";
import { PageSuivi } from "./suivi.tsx";
import { t, type Lang } from "./textes.ts";

const parametreLangue = () => new URLSearchParams(location.search).get("lang");

/** Salon de la page (`/eclat/`), fixé une fois pour tous les appels. */
const SALON = salonDepuisChemin(location.pathname);
if (SALON) choisirSalon(SALON);

function Ferme({ lang, telephone }: { lang: Lang; telephone: string }) {
  return (
    <section class="ferme">
      <p>{t(lang, "refus.ferme")}</p>
      {telephone ? <a class="bouton" href={lienAppel(telephone)}>{t(lang, "ferme.appeler")}</a> : null}
    </section>
  );
}

/** Page du relais : en-tête de l'institut, puis réservation, page de suivi, ou message de fermeture. */
function Racine() {
  const [vitrine, setVitrine] = useState<Vitrine | null>(null);
  const [erreur, setErreur] = useState(false);
  const [inconnu, setInconnu] = useState(SALON === null);
  const [lang, setLang] = useState<Lang>(() => langueInitiale(["fr", "en"], lireLangue() ?? navigator.language, parametreLangue()));
  const [jeton, setJeton] = useState<string | null>(() => jetonDepuisAncre(location.hash));
  const [charge, setCharge] = useState(0);

  useEffect(() => {
    const suivre = () => setJeton(jetonDepuisAncre(location.hash));
    addEventListener("hashchange", suivre);
    return () => removeEventListener("hashchange", suivre);
  }, []);

  useEffect(() => {
    if (!SALON) return;
    setErreur(false);
    api.vitrine().then((v) => {
      setVitrine(v);
      if (v.institut) setLang((l) => langueInitiale(v.institut!.langues, l, parametreLangue()));
    }, (e) => (e instanceof ErreurApi && e.statut === 404 ? setInconnu(true) : setErreur(true)));
  }, [charge]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = vitrine?.institut ? `${vitrine.institut.nom} · ${t(lang, "entete.sous_titre")}` : t(lang, "entete.sous_titre");
  }, [lang, vitrine]);

  const institut = vitrine?.institut ?? null;
  const autre: Lang = lang === "fr" ? "en" : "fr";
  const quitterSuivi = () => {
    history.replaceState(null, "", location.pathname + location.search);
    setJeton(null);
  };

  return (
    <div class="page">
      <header class="entete">
        {institut?.logo ? <img class="logo" src={institut.logo} alt="" /> : null}
        <div>
          {institut ? <h1 class="marque">{institut.nom}</h1> : null}
          <p class="sous-titre-entete">{t(lang, "entete.sous_titre")}</p>
        </div>
        {institut && institut.langues.includes(autre) ? (
          <button type="button" class="langue" lang={autre} onClick={() => { ecrireLangue(autre); setLang(autre); }}>{t(lang, "langue.autre")}</button>
        ) : null}
      </header>
      <main>
        {inconnu ? <p class="avis">{t(lang, "page.sans_salon")}</p>
          : erreur ? <ErreurReseau lang={lang} reessayer={() => setCharge((n) => n + 1)} />
          : !vitrine ? <p class="discret">{t(lang, "commun.chargement")}</p>
          : jeton ? <PageSuivi jeton={jeton} lang={lang} nouvelle={quitterSuivi} />
          : vitrine.etat === "ferme" || !institut ? <Ferme lang={lang} telephone={institut?.telephone ?? ""} />
          : <Reservation vitrine={vitrine} lang={lang} recharger={() => setCharge((n) => n + 1)} prestationInitiale={prestationDepuisAdresse(location.search, vitrine.prestations)} />}
      </main>
    </div>
  );
}

// Intégrée dans une page du site (integrer.js) : la page donne sa hauteur au cadre qui la contient.
if (window.parent !== window) {
  // Hauteur du corps (sans marge) : contrairement à scrollHeight, elle redescend quand le contenu raccourcit.
  const hauteur = () => window.parent.postMessage({ lamaRelaisHauteur: Math.ceil(document.body.getBoundingClientRect().height) }, "*");
  new ResizeObserver(hauteur).observe(document.body);
}

render(<Racine />, document.getElementById("app")!);
