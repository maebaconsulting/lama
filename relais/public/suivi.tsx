import { useEffect, useState } from "preact/hooks";
import { api, ErreurApi } from "./api.ts";
import { ErreurReseau } from "./composants.tsx";
import { cleEtatSuivi, libelleDateLong, type Suivi } from "./parcours.ts";
import { t, type Lang } from "./textes.ts";

/** Page de suivi (spec § 3) : prestation, horaire demandé et état, jamais le nom ni le téléphone. */
export function PageSuivi({ jeton, lang, nouvelle }: { jeton: string; lang: Lang; nouvelle: () => void }) {
  const [suivi, setSuivi] = useState<Suivi | null>(null);
  const [etat, setEtat] = useState<"chargement" | "introuvable" | "erreur" | "pret">("chargement");
  const [essai, setEssai] = useState(0);

  useEffect(() => {
    let actif = true;
    setEtat("chargement");
    api.suivi(jeton).then((s) => {
      if (!actif) return;
      setSuivi(s);
      setEtat("pret");
    }, (e) => {
      if (actif) setEtat(e instanceof ErreurApi && e.statut === 404 ? "introuvable" : "erreur");
    });
    return () => { actif = false; };
  }, [jeton, essai]);

  if (etat === "chargement") return <p class="discret">{t(lang, "commun.chargement")}</p>;
  if (etat === "erreur") return <ErreurReseau lang={lang} reessayer={() => setEssai((n) => n + 1)} />;
  if (etat === "introuvable" || !suivi) {
    return (
      <section class="suivi">
        <p>{t(lang, "suivi.introuvable")}</p>
        <button type="button" class="lien" onClick={nouvelle}>{t(lang, "suivi.nouvelle")}</button>
      </section>
    );
  }
  const quand = (date: string, heure: string) => t(lang, "commun.le", { date: libelleDateLong(date, lang), heure });
  const demande = suivi.date && suivi.heure ? quand(suivi.date, suivi.heure) : t(lang, "suivi.rappel");
  const libelle = suivi.etat === "autre_horaire" && suivi.horaire
    ? t(lang, "suivi.autre_horaire", { horaire: [quand(suivi.horaire.date, suivi.horaire.heure), suivi.horaire.praticienne].filter(Boolean).join(" · ") })
    : t(lang, cleEtatSuivi(suivi));
  return (
    <section class="suivi">
      <h2 class="titre">{t(lang, "suivi.titre")}</h2>
      <p class="suivi-prestation">{suivi.prestation[lang] || suivi.prestation.fr}</p>
      <p class="rappel-choix">{demande}</p>
      <p class={`etat etat-${suivi.etat}`}>{libelle}</p>
      {suivi.message?.[lang] ? <p class="message">{suivi.message[lang]}</p> : null}
      <button type="button" class="lien" onClick={nouvelle}>{t(lang, "suivi.nouvelle")}</button>
    </section>
  );
}
