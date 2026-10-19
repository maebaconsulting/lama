import { useRef, useState } from "preact/hooks";
import { apiBlob, apiUpload } from "../../api";
import { useDemo } from "../../demo-context";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Erreur, Succes } from "../champ";
import { Bloc, Case, Rubrique } from "./elements";
import { aideCentimes, cheminApercu, cheminImport, cheminModele, compteurs, compteursBilan, IMPORTS, nomModele, peutImporter, type DefinitionImport } from "../../lib/import";
import { formatPrice } from "../../lib/format";
import { IMPORT_MAX_OCTETS, type ApercuImport } from "../../../shared/import";

/**
 * Rubrique Import (spec du 18/10/2026 § 2.1), gérante et administrateur : pour chacun des quatre imports,
 * modèle à télécharger, fichier déposé, aperçu sans écriture, puis « Importer », grisé tant qu'une ligne
 * est refusée. Le serveur relit et recontrôle tout le fichier à l'import ; rien n'est écrit en cas de refus.
 */
export function Import() {
  const { t } = useI18n();
  // Démonstration publique (DP-06) : aucun fichier reçu ; le modèle se télécharge.
  const fige = useDemo() !== null;
  return (
    <Rubrique titre={t("reglages.rubrique.import")} description={t("import.description")}>
      <p className="max-w-prose text-sm text-encre-grise">{t("import.excel")}</p>
      {IMPORTS.map((d) => <BlocImport key={d.type} definition={d} fige={fige} />)}
    </Rubrique>
  );
}

function BlocImport({ definition, fige }: { definition: DefinitionImport; fige: boolean }) {
  const { t, tn, lang } = useI18n();
  const { type } = definition;
  const champ = useRef<HTMLInputElement>(null);
  const [fichier, setFichier] = useState<File | null>(null);
  const [apercu, setApercu] = useState<ApercuImport | null>(null);
  const [desactiver, setDesactiver] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const executer = async (travail: () => Promise<void>) => {
    setError(null);
    setOk(null);
    setPending(true);
    try {
      await travail();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const telechargerModele = () => void executer(async () => {
    const url = URL.createObjectURL(await apiBlob(cheminModele(type)));
    const a = document.createElement("a");
    a.href = url;
    a.download = nomModele(type);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const previsualiser = (f: File, d: boolean) => void executer(async () => {
    setApercu(null);
    setApercu(await apiUpload<ApercuImport>("POST", cheminApercu(type, d), f));
  });

  const choisir = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    input.value = "";
    if (!f) return;
    setApercu(null);
    setOk(null);
    if (f.size > IMPORT_MAX_OCTETS) {
      setFichier(null);
      setError(t("import.trop_lourd"));
      return;
    }
    setFichier(f);
    previsualiser(f, desactiver);
  };

  const changerDesactiver = (v: boolean) => {
    setDesactiver(v);
    if (fichier) previsualiser(fichier, v);
  };

  const importer = () => {
    if (!fichier) return;
    void executer(async () => {
      try {
        const bilan = await apiUpload<ApercuImport>("POST", cheminImport(type, desactiver), fichier);
        setFichier(null);
        setApercu(null);
        setOk(t("import.bilan", { liste: compteursBilan(bilan).map(([base, n]) => tn(base, n)).join(", ") }));
      } catch (err) {
        // Refus (l'agenda ou le catalogue a changé depuis l'aperçu) : aperçu relancé, « Importer » ne reste pas sur un aperçu périmé.
        setApercu(null);
        try {
          setApercu(await apiUpload<ApercuImport>("POST", cheminApercu(type, desactiver), fichier));
        } catch {
          // L'erreur d'origine est celle que la personne doit lire.
        }
        throw err;
      }
    });
  };

  return (
    <Bloc titre={t(definition.titreKey)}>
      <p className="max-w-prose text-sm text-encre-grise">{t(definition.aideKey)}</p>
      {aideCentimes(type) && <p className="max-w-prose text-sm text-encre-grise">{t("import.centimes", { exemple: formatPrice(1500, lang) })}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={telechargerModele}>{t("import.modele")}</Button>
        {!fige && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => champ.current?.click()}>
            {t(fichier ? "import.autre_fichier" : "import.choisir")}
          </Button>
        )}
      </div>
      {fige
        ? <p className="max-w-prose text-sm text-encre-grise">{t("demo.fichiers_coupes")}</p>
        : <input ref={champ} type="file" accept=".csv,text/csv" className="hidden" tabIndex={-1} aria-hidden="true" onChange={choisir} data-testid={`import-${type}-fichier`} />}
      {type === "catalogue" && <Case id="import-desactiver" label={t("import.desactiver")} hint={t("import.desactiver_aide")} checked={desactiver} disabled={pending || fige} onChange={changerDesactiver} />}
      {fichier && <p className="text-sm">{t("import.fichier", { nom: fichier.name })}</p>}
      {pending && <p role="status" className="text-sm text-encre-grise">{t("import.analyse")}</p>}
      {apercu && <Apercu apercu={apercu} />}
      {apercu && (
        <div>
          <Button type="button" disabled={!peutImporter(apercu, pending)} onClick={importer}>{t("import.importer")}</Button>
        </div>
      )}
      <Erreur message={error} />
      <Succes message={ok} />
    </Bloc>
  );
}

/** Aperçu : compteurs, lignes refusées numérotées (doublons comptés à part), avertissements. Rien n'est encore écrit. */
function Apercu({ apercu }: { apercu: ApercuImport }) {
  const { t, lang } = useI18n();
  return (
    <div className="space-y-3 rounded-sm border border-filet p-4" aria-live="polite">
      <p className="etiquette text-encre-grise">{t("import.apercu")}</p>
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        {compteurs(apercu).map(([cle, n]) => <li key={cle}>{t(cle, { n })}</li>)}
      </ul>
      {apercu.premier_prix !== null && <p className="text-sm">{t("import.premier_prix", { prix: formatPrice(apercu.premier_prix, lang) })}</p>}
      {apercu.refusees_total > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-encre-rouge">{t("import.refusees", { n: apercu.refusees_total })}</p>
          {apercu.doublons > 0 && <p className="text-sm">{t("import.doublons", { n: apercu.doublons })}</p>}
          <ol className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {apercu.refusees.map((r, i) => <li key={`${r.ligne}-${i}`}>{t("import.ligne", { ligne: r.ligne, texte: r.motif })}</li>)}
          </ol>
          {apercu.refusees_total > apercu.refusees.length && <p className="text-sm text-encre-grise">{t("import.autres", { n: apercu.refusees_total - apercu.refusees.length })}</p>}
          <p className="text-sm text-encre-grise">{t("import.corriger")}</p>
        </div>
      )}
      {apercu.avertissements_total > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("import.avertissements", { n: apercu.avertissements_total })}</p>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {apercu.avertissements.map((w, i) => <li key={`${w.ligne}-${i}`}>{t("import.ligne", { ligne: w.ligne, texte: w.texte })}</li>)}
          </ul>
          {apercu.avertissements_total > apercu.avertissements.length && <p className="text-sm text-encre-grise">{t("import.autres", { n: apercu.avertissements_total - apercu.avertissements.length })}</p>}
        </div>
      )}
    </div>
  );
}
