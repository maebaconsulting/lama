import { useState } from "preact/hooks";
import { api, ErreurApi } from "./api.ts";
import { Avis, ChampsCliente, jetonTurnstile, reinitialiserTurnstile, Retour, Titre, Turnstile } from "./composants.tsx";
import { clienteEnvoyee, controler, memoriser, saisieInitiale, type Saisie } from "./saisie.ts";
import { type Prestation, type Vitrine } from "./parcours.ts";
import { t, type CleTexte, type Lang } from "./textes.ts";

const JOURS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;
const MOMENTS = ["matin", "apres_midi", "soir"] as const;

/** Recours « Être rappelée » (spec § 3) : l'institut est prévenu et rappelle la cliente. */
export function Rappel({ vitrine, lang, prestation, praticienne, avis, retour, envoye, refuse }: {
  vitrine: Vitrine; lang: Lang; prestation: Prestation; praticienne: string | null; avis: CleTexte | null; retour: () => void; envoye: (jeton: string, horsHoraires: boolean) => void;
  /** Refus du serveur (traité comme dans le parcours principal) : rend le message à garder sur ce formulaire, ou `null` si la cliente a été ramenée ailleurs. */
  refuse: (code: string) => CleTexte | null;
}) {
  const institut = vitrine.institut!;
  const [saisie, setSaisie] = useState<Saisie>(() => saisieInitiale(lang));
  const [souhaitee, setSouhaitee] = useState<string | null>(praticienne);
  const [jours, setJours] = useState<string[]>([]);
  const [moments, setMoments] = useState<string[]>([]);
  const [precision, setPrecision] = useState("");
  const [erreur, setErreur] = useState<CleTexte | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const basculer = (liste: string[], v: string) => (liste.includes(v) ? liste.filter((x) => x !== v) : [...liste, v]);
  const pratiquantes = vitrine.praticiennes.filter((x) => x.prestations.includes(prestation.id));

  const envoyer = async (e: Event) => {
    e.preventDefault();
    if (envoi) return;
    const c = controler(saisie, institut);
    if ("erreur" in c) return setErreur(c.erreur);
    setErreur(null);
    setEnvoi(true);
    try {
      const r = await api.envoyer({
        type: "rappel", prestation: prestation.id, praticienne: souhaitee, date: null, heure: null,
        souhait: { jours, moments, precision: precision.trim() },
        cliente: clienteEnvoyee(saisie, c.telephone), note: "", accord: true,
        piege: saisie.piege, turnstile: jetonTurnstile(),
      });
      memoriser(saisie);
      envoye(r.jeton, r.hors_horaires === true);
    } catch (err) {
      // Toute erreur qui n'est pas un refus lisible du serveur (réseau coupé, réponse illisible) : « Réessayer ».
      setErreur(err instanceof ErreurApi && err.code !== "autre" ? refuse(err.code) : "erreur.reseau");
    } finally {
      reinitialiserTurnstile();
      setEnvoi(false);
    }
  };

  return (
    <form class="formulaire" onSubmit={envoyer} noValidate>
      <Retour lang={lang} onClick={retour} />
      <Titre>{t(lang, "rappel.titre")}</Titre>
      <Avis lang={lang} cle={avis} />
      <p>{t(lang, "rappel.intro")}</p>
      <p class="rappel-choix">{prestation.nom[lang] || prestation.nom.fr}</p>
      {pratiquantes.length > 1 ? (
        <label class="champ">
          <span>{t(lang, "rappel.praticienne")}</span>
          <select value={souhaitee ?? ""} onChange={(e) => setSouhaitee(e.currentTarget.value || null)}>
            <option value="">{t(lang, "horaire.sans_preference")}</option>
            {pratiquantes.map((x) => <option key={x.id} value={x.id}>{x.prenom}</option>)}
          </select>
        </label>
      ) : null}
      <fieldset class="cases">
        <legend>{t(lang, "rappel.jours")}</legend>
        {JOURS.map((j) => (
          <label key={j} class="case-pastille case-jour">
            <input type="checkbox" checked={jours.includes(j)} onChange={() => setJours(basculer(jours, j))} />
            <span>{t(lang, `jour.${j}`)}</span>
          </label>
        ))}
      </fieldset>
      <fieldset class="cases">
        <legend>{t(lang, "rappel.moments")}</legend>
        {MOMENTS.map((m) => (
          <label key={m} class="case-pastille">
            <input type="checkbox" checked={moments.includes(m)} onChange={() => setMoments(basculer(moments, m))} />
            <span>{t(lang, `moment.${m}`)}</span>
          </label>
        ))}
      </fieldset>
      <label class="champ">
        <span>{t(lang, "rappel.precision")}</span>
        <textarea rows={2} maxLength={500} value={precision} onInput={(e) => setPrecision(e.currentTarget.value)} />
      </label>
      <ChampsCliente lang={lang} institut={institut} saisie={saisie} changer={setSaisie} note={false} />
      <Turnstile cleSite={vitrine.turnstile} />
      <Avis lang={lang} cle={erreur} ton="erreur" telephone={institut.telephone} />
      <button type="submit" class="bouton" disabled={envoi}>{t(lang, envoi ? "commun.envoi" : "rappel.envoyer")}</button>
    </form>
  );
}
