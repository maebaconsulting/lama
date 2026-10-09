import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import { avertissementsReglage, dernierEcart, ecartTexte, ecartVisible, heureSaisie, type AvertissementReglage, type EtatHeure, type ReponseReglage } from "../../lib/heure";
import { formatInstant } from "../../lib/format";
import { useLoad } from "../../hooks/use-load";
import { useI18n } from "@/i18n/provider";
import type { Key } from "@/i18n/translate";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Champ, Erreur, Succes } from "../champ";
import { ChampDate } from "../champ-date";
import { useConfirmation } from "../auth/confirmation";
import { useFormation } from "../../formation-context";
import { Bloc, Rubrique } from "./elements";

/**
 * Heure du serveur (distribution D-12), administrateur : heure du serveur et
 * de cet appareil, écart, caisse bloquée si l'heure a reculé ; « Mettre le
 * serveur à l'heure de cet appareil » ou heure saisie, mot de passe retapé.
 */
export function Heure() {
  const confirm = useConfirmation();
  const formation = useFormation();
  const { t, lang } = useI18n();
  const etat = useLoad(() => api<EtatHeure>("GET", "/api/heure"));
  const [maintenant, setMaintenant] = useState(Date.now());
  const [date, setDate] = useState("");
  const [texteHeure, setTexteHeure] = useState("");
  const [fieldError, setFieldError] = useState<Key | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [avertissements, setAvertissements] = useState<AvertissementReglage[]>([]);
  const [pending, setPending] = useState(false);

  // Les deux horloges avancent à l'écran, à la seconde.
  useEffect(() => {
    const timer = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  /** Envoie l'heure ; `heure` est appelée au moment de l'envoi (après la saisie du mot de passe, au besoin). */
  const envoyer = async (heure: () => number) => {
    if (pending) return;
    setPending(true);
    setError(null);
    setOk(null);
    setAvertissements([]);
    try {
      const fait = await confirm(() => api<ReponseReglage>("POST", "/api/heure", { heure: heure() }));
      if (fait) {
        setOk(t("heure.reglee", { heure: formatInstant(fait.nouvelle, lang) }));
        setAvertissements(avertissementsReglage(fait));
        await etat.reload();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const saisie = (e: Event) => {
    e.preventDefault();
    const lue = heureSaisie(date, texteHeure);
    if ("error" in lue) {
      setFieldError(lue.error);
      return;
    }
    setFieldError(null);
    void envoyer(() => lue.value);
  };

  const ecart = etat.data ? dernierEcart() : null;
  return (
    <Rubrique titre={t("reglages.rubrique.heure")} description={t("heure.description")}>
      {formation && <p className="max-w-prose text-sm text-encre-grise">{t("formation.coupe")}</p>}
      <Erreur message={error ?? etat.error} />
      <Succes message={ok} />
      {avertissements.map((a) => (
        <p key={a.key} role="alert" className="max-w-prose text-sm text-encre-rouge">{t(a.key, a.derniere === undefined ? undefined : { derniere: formatInstant(a.derniere, lang) })}</p>
      ))}
      {ecart === null ? (
        <p className="text-sm text-encre-grise">{t("heure.inconnue")}</p>
      ) : (
        <dl className="grid max-w-lg grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="etiquette text-encre-grise">{t("heure.serveur")}</dt>
          <dd className="chiffres-tabulaires">{formatInstant(maintenant + ecart, lang)}</dd>
          <dt className="etiquette text-encre-grise">{t("heure.appareil")}</dt>
          <dd className="chiffres-tabulaires">{formatInstant(maintenant, lang)}</dd>
          <dt className="etiquette text-encre-grise">{t("heure.ecart")}</dt>
          <dd className={ecartVisible(ecart) ? "text-encre-rouge" : undefined}>{ecartVisible(ecart) ? ecartTexte(ecart, lang) : t("heure.ecart_faible")}</dd>
        </dl>
      )}
      {etat.data?.caisse_bloquee && etat.data.derniere_facture !== null && (
        <p role="alert" className="max-w-prose text-sm text-encre-rouge">{t("heure.caisse_bloquee", { derniere: formatInstant(etat.data.derniere_facture, lang) })}</p>
      )}

      <Bloc titre={t("heure.corriger")}>
        <p className="max-w-prose text-sm text-encre-grise">{t("heure.aligner_aide")}</p>
        <div><Button onClick={() => void envoyer(() => Date.now())} disabled={pending}>{t("heure.aligner")}</Button></div>
      </Bloc>

      <Bloc titre={t("heure.saisir")}>
        <form className="grid max-w-xs gap-4" onSubmit={saisie} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="heure-date">{t("heure.date")}</Label>
            <ChampDate id="heure-date" value={date} onValue={(v: string) => { setDate(v); setFieldError(null); }} />
          </div>
          <Champ
            id="heure-heure"
            label={t("heure.heure")}
            inputMode="numeric"
            autoComplete="off"
            placeholder={t("saisie.heure_format")}
            value={texteHeure}
            onInput={(e: Event) => { setTexteHeure((e.currentTarget as HTMLInputElement).value); setFieldError(null); }}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "heure-erreur" : undefined}
          />
          {fieldError && <p id="heure-erreur" className="text-sm text-encre-rouge">{t(fieldError)}</p>}
          <div><Button type="submit" disabled={pending}>{t("heure.regler")}</Button></div>
        </form>
      </Bloc>
    </Rubrique>
  );
}
