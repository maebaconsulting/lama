import "@fontsource/jost/400.css";
import "@fontsource/jost/500.css";
import "@fontsource/eb-garamond/500.css";
import "./styles.css";
import "./gestion.css";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { apiGestion, ErreurGestion, type EtatSalon, type SalonGestion } from "./gestion-api.ts";
import { adressePage, codeIntegration, dateHeure, duree, etatLiaison, lireOrigines } from "./gestion-outils.ts";
import { tg, type CleGestion } from "./gestion-textes.ts";
import { ecrireLangue, lireLangue } from "./memoire.ts";
import { MOTIF_SALON, SALONS_RESERVES } from "../noyau/motifs.ts";
import { langueInitiale } from "./parcours.ts";
import type { Lang } from "./textes.ts";

const ETATS: EtatSalon[] = ["actif", "suspendu", "essai"];
const ORIGINE = location.origin;
/** Nombre d'origines permis par salon (limite de l'API de gestion). */
const ORIGINES_MAX = 20;

/** Message d'une erreur de l'API de gestion ; `contexte` précise ce que « données invalides » veut dire. */
function messageErreur(e: unknown, lang: Lang, contexte: "creation" | "salon" | "general" = "general"): string {
  if (e instanceof ErreurGestion) {
    if (e.statut === 401 && e.code === "session") return tg(lang, "erreur.session");
    if (e.code === "existe") return tg(lang, "creation.existe");
    if (e.code === "donnees_invalides") {
      if (contexte === "creation") return tg(lang, /réservé/.test(e.detail) ? "creation.reserve" : "creation.invalide");
      if (contexte === "salon") return tg(lang, /^origines/.test(e.detail) ? "salon.origines_refusees" : "salon.invalide");
    }
    return tg(lang, "erreur.autre", { code: e.code });
  }
  return tg(lang, "erreur.reseau");
}

function Connexion({ lang, avis, connecte }: { lang: Lang; avis: string | null; connecte: () => void }) {
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(avis);
  const [envoi, setEnvoi] = useState(false);
  const entrer = async (e: Event) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      await apiGestion.connexion(motDePasse);
      connecte();
    } catch (err) {
      setErreur(err instanceof ErreurGestion && err.code === "mot_de_passe" ? tg(lang, "connexion.refuse")
        : err instanceof ErreurGestion && err.code === "trop_d_essais" ? tg(lang, "connexion.trop") : messageErreur(err, lang));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <form class="formulaire" onSubmit={entrer}>
      <label class="champ">
        <span>{tg(lang, "connexion.mot_de_passe")}</span>
        <input type="password" autoComplete="current-password" value={motDePasse} onInput={(e) => setMotDePasse(e.currentTarget.value)} />
      </label>
      {erreur ? <p class="avis avis-erreur" role="alert">{erreur}</p> : null}
      <button type="submit" class="bouton" disabled={envoi || !motDePasse}>{tg(lang, "connexion.entrer")}</button>
    </form>
  );
}

function EncadreCle({ lang, salon, cle, fermer }: { lang: Lang; salon: string; cle: string; fermer: () => void }) {
  const [copiee, setCopiee] = useState(false);
  const [echecCopie, setEchecCopie] = useState(false);
  const copier = async () => {
    try {
      if (!navigator.clipboard) throw new Error("presse-papiers absent");
      await navigator.clipboard.writeText(cle);
      setCopiee(true);
      setEchecCopie(false);
    } catch {
      setEchecCopie(true);
    }
  };
  return (
    <div class="encadre-cle" role="alert">
      <h2 class="titre">{tg(lang, "cle.titre", { salon })}</h2>
      <code class="code">{cle}</code>
      <p>{tg(lang, "cle.avertissement", { salon })}</p>
      {echecCopie ? <p class="avis avis-erreur" role="alert">{tg(lang, "cle.copie_impossible")}</p> : null}
      <div class="actions">
        <button type="button" class="bouton-secondaire" onClick={() => void copier()}>
          {tg(lang, copiee ? "cle.copiee" : "cle.copier")}
        </button>
        <button type="button" class="bouton bouton-ligne" onClick={fermer}>{tg(lang, "cle.fermer")}</button>
      </div>
    </div>
  );
}

function Creation({ lang, cree, annuler, erreurSession }: {
  lang: Lang; cree: (salon: string, cle: string) => void; annuler: () => void; erreurSession: (message: string) => void;
}) {
  const [id, setId] = useState("");
  const [nom, setNom] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const creer = async (e: Event) => {
    e.preventDefault();
    if (envoi) return;
    const identifiant = id.trim();
    if (SALONS_RESERVES.includes(identifiant)) return setErreur(tg(lang, "creation.reserve"));
    if (!MOTIF_SALON.test(identifiant)) return setErreur(tg(lang, "creation.invalide"));
    setEnvoi(true);
    try {
      const r = await apiGestion.creer(identifiant, nom.trim());
      cree(r.salon.id, r.cle);
    } catch (err) {
      const texte = messageErreur(err, lang, "creation");
      if (err instanceof ErreurGestion && err.statut === 401) erreurSession(texte);
      else setErreur(texte);
      setEnvoi(false);
    }
  };
  return (
    <form class="carte formulaire" onSubmit={creer}>
      <label class="champ">
        <span>{tg(lang, "creation.id")}</span>
        <input type="text" autoComplete="off" spellcheck={false} value={id} onInput={(e) => setId(e.currentTarget.value.toLowerCase())} />
        <span class="discret">{tg(lang, "creation.id_aide")}</span>
      </label>
      <label class="champ">
        <span>{tg(lang, "creation.nom")}</span>
        <input type="text" value={nom} onInput={(e) => setNom(e.currentTarget.value)} />
      </label>
      {erreur ? <p class="avis avis-erreur" role="alert">{erreur}</p> : null}
      <div class="actions">
        <button type="submit" class="bouton bouton-ligne" disabled={envoi || !id.trim() || !nom.trim()}>{tg(lang, "creation.creer")}</button>
        <button type="button" class="bouton-secondaire" onClick={annuler}>{tg(lang, "commun.annuler")}</button>
      </div>
    </form>
  );
}

function Fiche({ lang, salon, change, cle, erreurSession }: {
  lang: Lang; salon: SalonGestion; change: () => void; cle: (salon: string, cle: string) => void; erreurSession: (message: string) => void;
}) {
  const [nom, setNom] = useState(salon.nom);
  const [etat, setEtat] = useState<EtatSalon>(salon.etat);
  const [origines, setOrigines] = useState(salon.origines.join("\n"));
  const [avis, setAvis] = useState<{ texte: string; erreur: boolean } | null>(null);
  const [remplacer, setRemplacer] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  // Une action à la fois : un double clic ne lance pas deux appels (deux clés remplacées dans le désordre afficheraient une clé morte).
  const [occupe, setOccupe] = useState(false);
  const echec = (err: unknown) => {
    const texte = messageErreur(err, lang, "salon");
    if (err instanceof ErreurGestion && err.statut === 401) erreurSession(texte);
    else setAvis({ texte, erreur: true });
  };
  const enregistrer = async (e: Event) => {
    e.preventDefault();
    if (occupe) return;
    const lues = lireOrigines(origines);
    if (lues.invalides.length) return setAvis({ texte: tg(lang, "salon.origines_invalides", { liste: lues.invalides.join(", ") }), erreur: true });
    if (lues.origines.length > ORIGINES_MAX) return setAvis({ texte: tg(lang, "salon.origines_trop"), erreur: true });
    setOccupe(true);
    try {
      await apiGestion.modifier(salon.id, { nom: nom.trim(), etat, origines: lues.origines });
      setAvis({ texte: tg(lang, "salon.enregistre"), erreur: false });
      change();
    } catch (err) {
      echec(err);
    } finally {
      setOccupe(false);
    }
  };
  return (
    <div class="fiche">
      <form class="formulaire" onSubmit={enregistrer}>
        <label class="champ"><span>{tg(lang, "salon.nom")}</span><input type="text" value={nom} onInput={(e) => setNom(e.currentTarget.value)} /></label>
        <label class="champ">
          <span>{tg(lang, "salon.etat")}</span>
          <select value={etat} onChange={(e) => setEtat(e.currentTarget.value as EtatSalon)}>
            {ETATS.map((x) => <option key={x} value={x}>{tg(lang, `etat.${x}`)}</option>)}
          </select>
          <span class="discret">{tg(lang, `etat.${etat}_aide`)}</span>
        </label>
        <label class="champ">
          <span>{tg(lang, "salon.origines")}</span>
          <textarea rows={3} spellcheck={false} value={origines} onInput={(e) => setOrigines(e.currentTarget.value)} />
        </label>
        {avis ? <p class={`avis${avis.erreur ? " avis-erreur" : ""}`} role={avis.erreur ? "alert" : "status"}>{avis.texte}</p> : null}
        <button type="submit" class="bouton bouton-ligne" disabled={occupe}>{tg(lang, "salon.enregistrer")}</button>
      </form>
      <div>
        <h3 class="sous-titre">{tg(lang, "salon.integration")}</h3>
        <code class="code">{codeIntegration(ORIGINE, salon.id)}</code>
      </div>
      <div>
        {remplacer ? (
          <>
            <p class="avis avis-erreur">{tg(lang, "salon.remplacer_aide")}</p>
            <div class="actions">
              <button type="button" class="bouton-secondaire danger" disabled={occupe} onClick={async () => {
                if (occupe) return;
                setOccupe(true);
                try {
                  cle(salon.id, await apiGestion.remplacerCle(salon.id));
                  setRemplacer(false);
                } catch (err) {
                  echec(err);
                } finally {
                  setOccupe(false);
                }
              }}>{tg(lang, "salon.remplacer_confirmer")}</button>
              <button type="button" class="bouton-secondaire" onClick={() => setRemplacer(false)}>{tg(lang, "commun.annuler")}</button>
            </div>
          </>
        ) : <button type="button" class="bouton-secondaire" onClick={() => setRemplacer(true)}>{tg(lang, "salon.remplacer_cle")}</button>}
      </div>
      <div>
        <h3 class="sous-titre">{tg(lang, "salon.supprimer")}</h3>
        <p class="discret">{tg(lang, "salon.supprimer_aide", { salon: salon.id })}</p>
        <div class="actions">
          <input type="text" autoComplete="off" spellcheck={false} value={confirmation} onInput={(e) => setConfirmation(e.currentTarget.value)} aria-label={tg(lang, "salon.supprimer")} />
          <button type="button" class="bouton-secondaire danger" disabled={occupe || confirmation !== salon.id} onClick={async () => {
            if (occupe) return;
            setOccupe(true);
            try {
              await apiGestion.supprimer(salon.id, confirmation);
              change();
            } catch (err) {
              echec(err);
            } finally {
              setOccupe(false);
            }
          }}>{tg(lang, "salon.supprimer_confirmer")}</button>
        </div>
      </div>
    </div>
  );
}

function Carte({ lang, salon, maintenant, ouvert, basculer, change, cle, erreurSession }: {
  lang: Lang; salon: SalonGestion; maintenant: number; ouvert: boolean; basculer: () => void;
  change: () => void; cle: (salon: string, cle: string) => void; erreurSession: (message: string) => void;
}) {
  const liaison = etatLiaison(salon.dernier_appel_le, maintenant);
  const plages: CleGestion = salon.plages_generees_le === null ? "plages.aucune" : salon.plages_a_jour ? "plages.a_jour" : "plages.anciennes";
  return (
    <article class="carte">
      <div class="carte-haut">
        <h2 class="carte-nom">{salon.nom}</h2>
        <span class="carte-id">{salon.id}</span>
        <span class={`pastille pastille-${salon.etat}`}>{tg(lang, `etat.${salon.etat}`)}</span>
      </div>
      <ul class="mesures">
        <li class={liaison.cle === "liaison.recente" ? "" : "alerte"}>{tg(lang, liaison.cle, { duree: duree(liaison.duree, lang) })}</li>
        <li>{salon.version_offre === null ? tg(lang, "offre.aucune") : tg(lang, "offre.version", { date: dateHeure(salon.version_offre, lang) })}</li>
        <li class={plages === "plages.a_jour" ? "" : "alerte"}>{tg(lang, plages)}</li>
        <li>{tg(lang, "demandes.attente", { n: salon.demandes_en_attente })}</li>
      </ul>
      <div class="actions">
        <a class="lien" href={adressePage(ORIGINE, salon.id)} target="_blank" rel="noopener">{tg(lang, "salon.page")}</a>
        <button type="button" class="bouton-secondaire" aria-expanded={ouvert} onClick={basculer}>{tg(lang, "salon.gerer")}</button>
      </div>
      {ouvert ? <Fiche lang={lang} salon={salon} change={change} cle={cle} erreurSession={erreurSession} /> : null}
    </article>
  );
}

function Gestion() {
  const [lang, setLang] = useState<Lang>(() => langueInitiale(["fr", "en"], lireLangue() ?? navigator.language, null));
  const [connecte, setConnecte] = useState<boolean | null>(null);
  const [avisConnexion, setAvisConnexion] = useState<string | null>(null);
  const [salons, setSalons] = useState<SalonGestion[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [creation, setCreation] = useState(false);
  const [cle, setCle] = useState<{ salon: string; cle: string } | null>(null);
  const [maintenant, setMaintenant] = useState(Date.now());

  const finSession = (message: string | null) => {
    setConnecte(false);
    setSalons(null);
    setCle(null);
    setCreation(false);
    setOuvert(null);
    setErreur(null);
    setAvisConnexion(message);
  };
  const charger = async () => {
    try {
      setSalons(await apiGestion.salons());
      // Les durées se comptent sur l'heure du relais (en-tête Date), pas sur l'horloge de l'opérateur.
      setMaintenant(apiGestion.heureRelais() ?? Date.now());
      setConnecte(true);
      setErreur(null);
    } catch (err) {
      if (err instanceof ErreurGestion && err.statut === 401) finSession(connecte ? tg(lang, "erreur.session") : null);
      else setErreur(messageErreur(err, lang));
    }
  };

  useEffect(() => { void charger(); }, []);
  useEffect(() => {
    if (!connecte) return;
    const minuterie = setInterval(() => void charger(), 60_000);
    return () => clearInterval(minuterie);
  }, [connecte, lang]);
  // Retour par l'historique (bfcache) : la clé affichée ne doit pas réapparaître.
  useEffect(() => {
    const effacer = () => setCle(null);
    addEventListener("pagehide", effacer);
    return () => removeEventListener("pagehide", effacer);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = tg(lang, "titre");
  }, [lang]);

  const autre: Lang = lang === "fr" ? "en" : "fr";
  return (
    <div class="page gestion">
      <header class="entete">
        <div><h1 class="marque">lama</h1><p class="sous-titre-entete">{tg(lang, "titre")}</p></div>
        <button type="button" class="langue" lang={autre} onClick={() => { ecrireLangue(autre); setLang(autre); }}>{tg(lang, "langue.autre")}</button>
      </header>
      <main>
        {erreur ? (
          <div class="avis avis-erreur" role="alert">
            <p>{erreur}</p>
            <button type="button" class="bouton-secondaire" onClick={() => void charger()}>{tg(lang, "commun.reessayer")}</button>
          </div>
        ) : null}
        {connecte === null ? (erreur ? null : <p class="discret">{tg(lang, "commun.chargement")}</p>)
          : !connecte ? <Connexion lang={lang} avis={avisConnexion} connecte={() => void charger()} />
          : (
            <>
              <div class="barre">
                <button type="button" class="bouton bouton-ligne" onClick={() => setCreation(true)} disabled={creation}>{tg(lang, "liste.nouveau")}</button>
                <button type="button" class="bouton-secondaire" onClick={async () => { await apiGestion.deconnexion().catch(() => null); finSession(null); }}>{tg(lang, "deconnexion")}</button>
              </div>
              {cle ? <EncadreCle lang={lang} salon={cle.salon} cle={cle.cle} fermer={() => setCle(null)} /> : null}
              {creation ? <Creation lang={lang} erreurSession={(m) => finSession(m)} annuler={() => setCreation(false)} cree={(salon, nouvelle) => { setCreation(false); setCle({ salon, cle: nouvelle }); void charger(); }} /> : null}
              {salons && salons.length === 0 ? <p class="discret">{tg(lang, "liste.vide")}</p> : null}
              <div class="cartes">
                {(salons ?? []).map((s) => (
                  <Carte key={s.id} lang={lang} salon={s} maintenant={maintenant} ouvert={ouvert === s.id}
                    basculer={() => setOuvert(ouvert === s.id ? null : s.id)} change={() => void charger()}
                    cle={(salon, nouvelle) => setCle({ salon, cle: nouvelle })} erreurSession={(m) => finSession(m)} />
                ))}
              </div>
            </>
          )}
      </main>
    </div>
  );
}

render(<Gestion />, document.getElementById("gestion")!);
