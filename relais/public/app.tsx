import { useEffect, useState } from "preact/hooks";
import { api, ErreurApi } from "./api.ts";
import { Avis, ChampsCliente, ErreurReseau, jetonTurnstile, reinitialiserTurnstile, Retour, Titre, Turnstile, versLeHaut } from "./composants.tsx";
import { clienteEnvoyee, controler, memoriser, saisieInitiale, type Saisie } from "./saisie.ts";
import {
  apresHeure, apresRefus, formatDuree, formatPrix, joursAffiches, libelleDate, libelleDateLong, lienSuivi, modeRappel, parCategorie,
  premierJour, texteRecu, type Creneau, type Etape, type Prestation, type Resume, type Vitrine,
} from "./parcours.ts";
import { Rappel } from "./rappel.tsx";
import { t, type CleTexte, type Lang } from "./textes.ts";

type Choix = { prestation: Prestation | null; filtre: string | null; date: string | null; heure: string | null; praticienne: string | null };
const VIDE: Choix = { prestation: null, filtre: null, date: null, heure: null, praticienne: null };

/** Parcours de la cliente (spec § 3) : prestation, jour et heure (filtre « Avec »), coordonnées. */
export function Reservation({ vitrine, lang, recharger, prestationInitiale = null }: { vitrine: Vitrine; lang: Lang; recharger: () => void; prestationInitiale?: Prestation | null }) {
  // Prestation choisie d'avance par l'adresse (bouton « Réserver » d'un site) : le parcours s'ouvre sur le jour et l'heure.
  const [etape, setEtape] = useState<Etape>(prestationInitiale ? "horaire" : "prestation");
  const [choix, setChoix] = useState<Choix>(prestationInitiale ? { ...VIDE, prestation: prestationInitiale } : VIDE);
  const [avis, setAvis] = useState<CleTexte | null>(null);
  const [jeton, setJeton] = useState<string | null>(null);
  const [horsHoraires, setHorsHoraires] = useState(false);
  const [retourRappel, setRetourRappel] = useState<Etape>("prestation");
  const telephone = vitrine.institut?.telephone ?? "";

  const aller = (suivante: Etape, message: CleTexte | null = null) => {
    setAvis(message);
    setEtape(suivante);
    versLeHaut();
  };
  const versRappel = (depuis: Etape, message: CleTexte | null) => {
    setRetourRappel(depuis);
    aller("rappel", message);
  };
  /** Refus du serveur : ramène la cliente à l'étape utile. Rend le message à garder sur le formulaire d'où elle vient, ou `null` si elle a changé d'étape. */
  const refuse = (code: string, depuis: "coordonnees" | "rappel"): CleTexte | null => {
    const r = apresRefus(code);
    if (r.etape === "prestation") recharger();
    if (depuis === "rappel" && (r.etape === "rappel" || r.etape === "coordonnees")) return r.message;
    if (r.etape === "rappel") versRappel("prestation", r.message);
    else aller(r.etape, r.message);
    return null;
  };
  const p = choix.prestation;

  if (etape === "sans_salon") return <p class="avis">{t(lang, "page.sans_salon")}</p>;
  if ((etape === "recu" || etape === "rappel_recu") && jeton) {
    return <Recu lang={lang} rappel={etape === "rappel_recu"} horsHoraires={horsHoraires} jeton={jeton} recommencer={() => { setChoix(VIDE); aller("prestation"); }} />;
  }
  if (etape === "rappel" && p) {
    return <Rappel vitrine={vitrine} lang={lang} prestation={p} praticienne={choix.filtre} avis={avis} retour={() => aller(retourRappel)} envoye={(j, hors) => { setJeton(j); setHorsHoraires(hors); aller("rappel_recu"); }} refuse={(code) => refuse(code, "rappel")} />;
  }
  if (etape === "horaire" && p) {
    return (
      <EtapeHoraire
        vitrine={vitrine} lang={lang} choix={choix} avis={avis}
        filtrer={(filtre) => setChoix({ ...choix, filtre, date: null, heure: null })}
        choisir={(date, heure) => {
          const r = apresHeure(choix.filtre);
          setChoix({ ...choix, date, heure, praticienne: r.praticienne });
          aller(r.etape);
        }}
        rappel={(aucun) => versRappel(aucun ? "prestation" : "horaire", aucun ? "rappel.aucun" : null)}
        retour={() => aller("prestation")}
      />
    );
  }
  if (etape === "coordonnees" && p && choix.date && choix.heure) {
    return <EtapeCoordonnees vitrine={vitrine} lang={lang} choix={choix} avis={avis} envoye={(j, hors) => { setJeton(j); setHorsHoraires(hors); aller("recu"); }} refuse={(code) => refuse(code, "coordonnees")} retour={() => aller("horaire")} />;
  }
  return <EtapePrestation vitrine={vitrine} lang={lang} avis={avis} telephone={telephone} choisir={(prestation) => { setChoix({ ...VIDE, prestation }); aller("horaire"); }} />;
}

function EtapePrestation({ vitrine, lang, avis, telephone, choisir }: { vitrine: Vitrine; lang: Lang; avis: CleTexte | null; telephone: string; choisir: (p: Prestation) => void }) {
  const devise = vitrine.institut!.devise;
  return (
    <section>
      <Avis lang={lang} cle={avis} ton="erreur" telephone={telephone} />
      <Titre>{t(lang, "prestation.choisir")}</Titre>
      {parCategorie(vitrine.prestations, lang).map((g) => (
        <div class="groupe" key={g.categorie}>
          <h3 class="categorie">{g.categorie}</h3>
          <ul class="liste">
            {g.prestations.map((x) => (
              <li key={x.id}>
                <button type="button" class="ligne" onClick={() => choisir(x)}>
                  <span class="ligne-haut">
                    <span class="ligne-nom">{x.nom[lang] || x.nom.fr}</span>
                    <span class="ligne-prix">{formatPrix(x.prix, devise, lang)}</span>
                  </span>
                  <span class="ligne-detail">{formatDuree(x.duree, lang)}</span>
                  {x.description[lang] ? <span class="ligne-description">{x.description[lang]}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function EtapeHoraire({ vitrine, lang, choix, avis, filtrer, choisir, rappel, retour }: {
  vitrine: Vitrine; lang: Lang; choix: Choix; avis: CleTexte | null; filtrer: (filtre: string | null) => void;
  choisir: (date: string, heure: string) => void; rappel: (aucun: boolean) => void; retour: () => void;
}) {
  const prestation = choix.prestation!;
  const [resume, setResume] = useState<Resume | null>(null);
  const [date, setDate] = useState<string | null>(choix.date);
  const [liste, setListe] = useState<Creneau[] | null>(null);
  const [erreur, setErreur] = useState(false);
  const [essai, setEssai] = useState(0);
  const [pris, setPris] = useState(false);

  useEffect(() => {
    let actif = true;
    setResume(null);
    setErreur(false);
    api.jours(prestation.id, choix.filtre).then((r) => {
      if (!actif) return;
      if (modeRappel(vitrine.etat, r.jours)) return rappel(true);
      setResume(r);
      setDate((d) => (d && r.jours.includes(d) ? d : r.jours[0] ?? null));
    }, () => { if (actif) setErreur(true); });
    return () => { actif = false; };
  }, [prestation.id, choix.filtre, essai]);

  useEffect(() => {
    if (!date) return;
    let actif = true;
    setListe(null);
    api.creneaux(prestation.id, date, choix.filtre).then((r) => { if (actif) setListe(r.creneaux); }, () => { if (actif) setErreur(true); });
    return () => { actif = false; };
  }, [prestation.id, date, choix.filtre, essai]);

  /** Créneau de « Prochaines disponibilités » : on revérifie que le créneau est encore libre. */
  const prendre = async (d: string, heure: string) => {
    try {
      const r = await api.creneaux(prestation.id, d, choix.filtre);
      const c = r.creneaux.find((x) => x.heure === heure);
      if (c) choisir(d, heure);
      else {
        setPris(true);
        setEssai((n) => n + 1);
      }
    } catch {
      setErreur(true);
    }
  };
  const pratiquantes = vitrine.praticiennes.filter((x) => x.prestations.includes(prestation.id));
  const debut = premierJour(vitrine);

  return (
    <section>
      <Retour lang={lang} onClick={retour} />
      <Titre>{t(lang, "etape.horaire")}</Titre>
      <p class="rappel-choix">{`${prestation.nom[lang] || prestation.nom.fr} · ${formatDuree(prestation.duree, lang)}`}</p>
      <Avis lang={lang} cle={avis ?? (pris ? "refus.indisponible" : null)} ton="erreur" />
      {pratiquantes.length > 1 ? (
        <label class="filtre">
          <span>{t(lang, "horaire.avec")}</span>
          <select value={choix.filtre ?? ""} onChange={(e) => { setPris(false); filtrer(e.currentTarget.value || null); }}>
            <option value="">{t(lang, "horaire.sans_preference")}</option>
            {pratiquantes.map((x) => <option key={x.id} value={x.id}>{x.prenom}</option>)}
          </select>
        </label>
      ) : null}
      {erreur ? <ErreurReseau lang={lang} reessayer={() => setEssai((n) => n + 1)} /> : resume === null ? (
        <p class="discret">{t(lang, "commun.chargement")}</p>
      ) : (
        <>
          {resume.prochains.length ? (
            <div class="prochains">
              <h3 class="sous-titre">{t(lang, "horaire.prochaines")}</h3>
              <div class="puces">
                {resume.prochains.map((x) => {
                  const l = libelleDate(x.date, lang);
                  return <button key={`${x.date} ${x.heure}`} type="button" class="puce" onClick={() => void prendre(x.date, x.heure)}>{`${l.jour} ${l.numero} ${l.mois} · ${x.heure}`}</button>;
                })}
              </div>
            </div>
          ) : null}
          {debut && vitrine.au ? (
            <div class="bandeau">
              {joursAffiches(debut, vitrine.au).map((d) => {
                const l = libelleDate(d, lang);
                return (
                  <button key={d} type="button" class={`jour${d === date ? " jour-choisi" : ""}`} disabled={!resume.jours.includes(d)} aria-pressed={d === date} onClick={() => { setPris(false); setDate(d); }}>
                    <span class="jour-nom">{l.jour}</span>
                    <span class="jour-numero">{l.numero}</span>
                    <span class="jour-mois">{l.mois}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {date ? (
            <div class="heures">
              <h3 class="sous-titre">{libelleDateLong(date, lang)}</h3>
              {liste === null ? <p class="discret">{t(lang, "commun.chargement")}</p> : liste.length === 0 ? <p class="discret">{t(lang, "horaire.aucun_ce_jour")}</p> : (
                <div class="grille">
                  {liste.map((c) => <button key={c.heure} type="button" class="heure" onClick={() => choisir(date, c.heure)}>{c.heure}</button>)}
                </div>
              )}
            </div>
          ) : null}
        </>
      )}
      <button type="button" class="lien" onClick={() => rappel(false)}>{t(lang, "horaire.rappel_lien")}</button>
    </section>
  );
}

/** Rappel du choix : prestation, jour et heure, praticienne si elle est fixée. */
function recapitulatif(vitrine: Vitrine, choix: Choix, lang: Lang): string {
  const morceaux = [choix.prestation!.nom[lang] || choix.prestation!.nom.fr, t(lang, "commun.le", { date: libelleDateLong(choix.date!, lang), heure: choix.heure! })];
  const praticienne = vitrine.praticiennes.find((x) => x.id === choix.praticienne);
  if (praticienne) morceaux.push(t(lang, "praticienne.seule", { prenom: praticienne.prenom }));
  return morceaux.join(" · ");
}

function EtapeCoordonnees({ vitrine, lang, choix, avis, envoye, refuse, retour }: {
  vitrine: Vitrine; lang: Lang; choix: Choix; avis: CleTexte | null; envoye: (jeton: string, horsHoraires: boolean) => void; refuse: (code: string) => CleTexte | null; retour: () => void;
}) {
  const institut = vitrine.institut!;
  const [saisie, setSaisie] = useState<Saisie>(() => saisieInitiale(lang));
  const [erreur, setErreur] = useState<CleTexte | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const envoyer = async (e: Event) => {
    e.preventDefault();
    if (envoi) return;
    const c = controler(saisie, institut);
    if ("erreur" in c) return setErreur(c.erreur);
    setErreur(null);
    setEnvoi(true);
    try {
      const r = await api.envoyer({
        type: "creneau", prestation: choix.prestation!.id, praticienne: choix.praticienne, date: choix.date, heure: choix.heure, souhait: null,
        cliente: clienteEnvoyee(saisie, c.telephone), note: saisie.note.trim(), accord: true,
        piege: saisie.piege, turnstile: jetonTurnstile(),
      });
      memoriser(saisie);
      envoye(r.jeton, r.hors_horaires === true);
    } catch (err) {
      // Toute erreur qui n'est pas un refus lisible du serveur (réseau coupé, réponse illisible) : « Réessayer ».
      if (err instanceof ErreurApi && err.code !== "autre") refuse(err.code);
      else setErreur("erreur.reseau");
    } finally {
      reinitialiserTurnstile();
      setEnvoi(false);
    }
  };

  return (
    <form class="formulaire" onSubmit={envoyer} noValidate>
      <Retour lang={lang} onClick={retour} />
      <Titre>{t(lang, "etape.coordonnees")}</Titre>
      <p class="rappel-choix">{recapitulatif(vitrine, choix, lang)}</p>
      <Avis lang={lang} cle={avis} ton="erreur" telephone={institut.telephone} />
      <ChampsCliente lang={lang} institut={institut} saisie={saisie} changer={setSaisie} />
      <Turnstile cleSite={vitrine.turnstile} />
      <Avis lang={lang} cle={erreur} ton="erreur" />
      <button type="submit" class="bouton" disabled={envoi}>{t(lang, envoi ? "commun.envoi" : "coordonnees.envoyer")}</button>
    </form>
  );
}

function Recu({ lang, rappel, horsHoraires, jeton, recommencer }: { lang: Lang; rappel: boolean; horsHoraires: boolean; jeton: string; recommencer: () => void }) {
  return (
    <section class="recu">
      <Titre>{t(lang, "recu.titre")}</Titre>
      <p>{t(lang, texteRecu(rappel, horsHoraires))}</p>
      <a class="bouton" href={lienSuivi(location.href, jeton)} {...(window.top !== window ? { target: "_blank", rel: "noopener" } : {})}>{t(lang, "recu.suivi")}</a>
      <button type="button" class="lien" onClick={recommencer}>{t(lang, "suivi.nouvelle")}</button>
    </section>
  );
}
