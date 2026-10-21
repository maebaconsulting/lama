import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import { useLoad } from "../../hooks/use-load";
import {
  categorieTexte, connexionTexte, enteteTexte, GUIDE_META, nomInvalide, nomsAEnregistrer, numeroVariable, statutTexte, typeTexte,
  type ConnexionMeta, type DepotMeta, type LigneModele, type ModelesMeta, type TemplateKind,
} from "../../lib/whatsapp-business";
import { formatInstant } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import type { Key } from "@/i18n/translate";
import { Button } from "@/components/ui/button";
import { Champ, Erreur, Succes } from "../champ";
import { useConfirmation } from "../auth/confirmation";

/** Étapes à faire chez Meta avant de remplir le bloc (W-14), et lien vers le guide pas à pas du technicien. */
export function AideMeta() {
  const { t, lang } = useI18n();
  return (
    <div className="max-w-prose space-y-2 text-sm text-encre-grise">
      <p>{t("whatsapp.meta.aide")}</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>{t("whatsapp.meta.etape_entreprise")}</li>
        <li>{t("whatsapp.meta.etape_numero")}</li>
        <li>{t("whatsapp.meta.etape_jeton")}</li>
        <li>{t("whatsapp.meta.etape_modeles")}</li>
      </ol>
      <p><a className="underline" href={GUIDE_META[lang]} target="_blank" rel="noreferrer">{t("whatsapp.meta.guide")}</a></p>
    </div>
  );
}

/** Texte à déposer chez Meta pour une langue (W-13), corps copiable. */
function Depot({ depot }: { depot: DepotMeta }) {
  const { t, lang } = useI18n();
  const [copie, setCopie] = useState(false);
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(depot.corps);
      setCopie(true);
    } catch {
      setCopie(false);
    }
  };
  return (
    <div className="space-y-1 rounded-sm border border-filet p-3 text-sm">
      <p className="font-medium">{t(`whatsapp.meta.langue.${depot.langue}` as Key)}</p>
      <p>{t("whatsapp.meta.depot_nom", { nom: depot.nom })}</p>
      <p>{t("whatsapp.meta.depot_categorie", { categorie: categorieTexte(depot.categorie, lang) })}</p>
      <p>{t("whatsapp.meta.depot_entete", { entete: enteteTexte(depot.entete, lang) })}</p>
      <pre className="whitespace-pre-wrap rounded-sm bg-muted p-2 font-mono text-xs">{depot.corps}</pre>
      <ul className="text-xs text-muted-foreground">
        {depot.exemples.map((exemple, rang) => <li key={rang}>{t("whatsapp.meta.depot_exemple", { variable: numeroVariable(rang), exemple })}</li>)}
      </ul>
      <Button type="button" variant="outline" onClick={() => void copier()}>{copie ? t("whatsapp.meta.copie") : t("whatsapp.meta.copier")}</Button>
    </div>
  );
}

/** Une ligne par type de message (W-13) : message, catégorie, nom modifiable, état dans chaque langue, texte à déposer. */
function LigneMeta({ ligne, nom, onNom }: { ligne: LigneModele; nom: string; onNom: (v: string) => void }) {
  const { t, lang } = useI18n();
  const [ouvert, setOuvert] = useState(false);
  return (
    <li className="space-y-2 border-b border-filet pb-3">
      <p className="text-sm font-medium">{typeTexte(ligne.kind, lang)} <span className="text-xs text-muted-foreground">{categorieTexte(ligne.categorie, lang)}</span></p>
      <Champ id={`meta-nom-${ligne.kind}`} label={t("whatsapp.meta.nom_modele")} autoComplete="off" spellcheck={false} value={nom} aria-invalid={nomInvalide(nom)}
        onInput={(e: Event) => onNom((e.currentTarget as HTMLInputElement).value)} />
      <p className="text-xs">{t("whatsapp.meta.etat_langues", { fr: statutTexte(ligne.statut.fr, lang), en: statutTexte(ligne.statut.en, lang) })}</p>
      <Button type="button" variant="ghost" onClick={() => setOuvert(!ouvert)}>{ouvert ? t("whatsapp.meta.masquer_depot") : t("whatsapp.meta.voir_depot")}</Button>
      {ouvert && <div className="grid gap-3 md:grid-cols-2"><Depot depot={ligne.depot.fr} /><Depot depot={ligne.depot.en} /></div>}
    </li>
  );
}

/**
 * WhatsApp Business de l'administrateur (W-11 à W-13), une fois le fournisseur enregistré : test de la
 * connexion, message d'essai hors file, modèles (nom, état dans chaque langue, texte à déposer, vérification
 * chez Meta). Le navigateur ne parle qu'à lama ; le jeton n'est jamais relu.
 */
export function WhatsappBusiness() {
  const confirm = useConfirmation();
  const { t, lang } = useI18n();
  const modeles = useLoad(() => api<ModelesMeta>("GET", "/api/whatsapp/meta/modeles"), ["settings"]);
  const [lignes, setLignes] = useState<ModelesMeta | null>(null);
  const [saisis, setSaisis] = useState<Partial<Record<TemplateKind, string>>>({});
  const [essaiTo, setEssaiTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (modeles.data) setLignes(modeles.data);
  }, [modeles.data]);

  /** Un geste à la fois ; le message de réussite, ou l'erreur de lama, s'affiche sous les boutons. */
  const run = async (action: () => Promise<string | null>) => {
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      const message = await action();
      if (message) setOk(message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const tester = () => run(async () => connexionTexte(await api<ConnexionMeta>("POST", "/api/whatsapp/meta/tester"), lang));
  const essai = () => run(async () => {
    await api("POST", "/api/whatsapp/meta/essai", { to: essaiTo });
    return t("whatsapp.meta.essai_envoye");
  });
  const verifier = () => run(async () => {
    setLignes(await api<ModelesMeta>("POST", "/api/whatsapp/meta/modeles/verifier"));
    return t("whatsapp.meta.verifies");
  });
  const aEnregistrer = lignes ? nomsAEnregistrer(lignes.modeles, saisis) : null;
  const enregistrerNoms = () => run(async () => {
    if (!aEnregistrer) return null;
    const noms = aEnregistrer;
    const done = await confirm(() => api("PUT", "/api/settings/whatsapp.meta.noms", { value: noms }));
    if (done === null) return null;
    setSaisis({});
    await modeles.reload();
    return t("whatsapp.meta.noms_enregistres");
  });

  return (
    <div className="mt-6 grid max-w-2xl gap-6">
      <section className="space-y-3">
        <div><Button type="button" variant="outline" disabled={busy} onClick={() => void tester()}>{t("whatsapp.meta.tester")}</Button></div>
        <div className="grid max-w-lg gap-2">
          <Champ id="meta-essai" type="tel" inputMode="tel" label={t("whatsapp.meta.essai_numero")} value={essaiTo} onInput={(e: Event) => setEssaiTo((e.currentTarget as HTMLInputElement).value)} />
          <div><Button type="button" variant="outline" disabled={busy || !essaiTo.trim()} onClick={() => void essai()}>{t("whatsapp.meta.essai")}</Button></div>
        </div>
        <Erreur message={error ?? modeles.error} />
        <Succes message={ok} />
      </section>
      <section className="space-y-3">
        <h4 className="text-sm font-medium">{t("whatsapp.meta.modeles")}</h4>
        <p className="max-w-prose text-sm text-encre-grise">{t("whatsapp.meta.avertissement_marketing")}</p>
        <p className="text-xs text-muted-foreground">
          {lignes && lignes.verifie_le !== null ? t("whatsapp.meta.verifie_le", { date: formatInstant(lignes.verifie_le, lang) }) : t("whatsapp.meta.jamais_verifie")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void verifier()}>{t("whatsapp.meta.verifier")}</Button>
          <Button type="button" variant="outline" disabled={busy || !aEnregistrer} onClick={() => void enregistrerNoms()}>{t("whatsapp.meta.noms_enregistrer")}</Button>
        </div>
        <ul className="space-y-3">
          {lignes?.modeles.map((ligne) => (
            <LigneMeta key={ligne.kind} ligne={ligne} nom={saisis[ligne.kind] ?? ligne.nom} onNom={(v) => setSaisis({ ...saisis, [ligne.kind]: v })} />
          ))}
        </ul>
      </section>
    </div>
  );
}
