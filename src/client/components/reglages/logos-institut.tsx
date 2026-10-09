import { useRef, useState } from "preact/hooks";
import { api, apiUpload } from "../../api";
import { useAuth } from "../../auth-context";
import { useMarque } from "../../marque-context";
import { useDemo } from "../../demo-context";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Bloc } from "./elements";
import { Erreur, Succes } from "../champ";

type Variante = "clair" | "sombre";

/** Poids maximal d'un logo, le même que celui du serveur. */
const MAX_OCTETS = 1_048_576;

/**
 * Logo de l'institut (gérante) : deux variantes, claire pour les documents et
 * sombre, facultative, pour le cadre. Dépôt, remplacement et retrait ; les
 * versions viennent de l'état public, relu après chaque changement.
 */
export function LogosInstitut() {
  const { t } = useI18n();
  const marque = useMarque();
  // Démonstration publique (DP-06) : aucun fichier reçu, le logo de la démonstration reste en place.
  const demo = useDemo() !== null;
  return (
    <Bloc titre={t("institut.logos")}>
      <p className="max-w-prose text-sm text-encre-grise">{t(demo ? "demo.fichiers_coupes" : "institut.logo_conseil")}</p>
      <div className="grid gap-6 sm:grid-cols-2">
        <BlocLogo variante="clair" version={marque.clair} fige={demo} />
        <BlocLogo variante="sombre" version={marque.sombre} fige={demo} />
      </div>
    </Bloc>
  );
}

function BlocLogo({ variante, version, fige }: { variante: Variante; version: number | null; fige: boolean }) {
  const { t } = useI18n();
  const auth = useAuth();
  const fichier = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirmer, setConfirmer] = useState(false);
  const clair = variante === "clair";

  const deposer = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setOk(null);
    setError(null);
    if (file.size > MAX_OCTETS) {
      setError(t("logo.trop_lourd"));
      return;
    }
    setPending(true);
    try {
      await apiUpload("PUT", `/api/institut/logos/${variante}`, file);
      await auth.reload();
      setOk(t("institut.logo_enregistre"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const retirer = async () => {
    setConfirmer(false);
    setOk(null);
    setError(null);
    setPending(true);
    try {
      await api("DELETE", `/api/institut/logos/${variante}`);
      await auth.reload();
      setOk(t("institut.logo_retire"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{t(clair ? "institut.logo_clair" : "institut.logo_sombre")}</p>
      <div data-theme={clair ? "light" : undefined} className={`flex h-32 items-center justify-center rounded-sm border border-filet p-3 ${clair ? "bg-white" : "bg-sidebar"}`}>
        {version !== null
          ? <img src={`/api/institut/logos/${variante}?v=${version}`} alt="" className="max-h-full max-w-full object-contain" />
          : <span className={`text-sm ${clair ? "text-muted-foreground" : "text-sidebar-foreground"}`}>{t("institut.logo_aucun")}</span>}
      </div>
      {!fige && (
        <>
          <input ref={fichier} type="file" accept="image/png,image/jpeg" className="hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => void deposer(e)} data-testid={`logo-${variante}-fichier`} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => fichier.current?.click()}>
              {t(version === null ? "institut.logo_deposer" : "institut.logo_remplacer")}
            </Button>
            {version !== null && <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirmer(true)}>{t("institut.logo_retirer")}</Button>}
          </div>
        </>
      )}
      <Erreur message={error} />
      <Succes message={ok} />
      {confirmer && (
        <Dialog open onOpenChange={(o: boolean) => { if (!o) setConfirmer(false); }}>
          <DialogContent compact>
            <DialogTitle>{t("institut.logo_retirer_confirmer")}</DialogTitle>
            <DialogDescription>{t(clair ? "institut.logo_clair" : "institut.logo_sombre")}</DialogDescription>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmer(false)}>{t("commun.annuler")}</Button>
              <Button type="button" onClick={() => void retirer()}>{t("institut.logo_retirer")}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
