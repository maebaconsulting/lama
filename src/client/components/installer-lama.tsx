import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Check, Share, SquarePlus, X } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/provider";
import { readInstallBannerClosed, writeInstallBannerClosed } from "@/i18n/device-lang";
import {
  doitProposerBandeau, estInstallee, estTactile, etatInvite, lancerInvite, modeInstallation, onInstallation, plateformeDe, type ModeInstallation,
} from "@/lib/installation";

/** Lit l'appareil : contexte sécurisé, ouvert depuis l'écran d'accueil, iOS, doigt ou souris. */
function lireAppareil() {
  const media = (requete: string) => typeof window.matchMedia === "function" && window.matchMedia(requete).matches;
  const plateforme = plateformeDe(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  const { invite, installeeIci } = etatInvite();
  const installee = installeeIci || estInstallee({ standalone: media("(display-mode: standalone)"), iosStandalone: (navigator as { standalone?: boolean }).standalone });
  return {
    mode: modeInstallation({ securise: window.isSecureContext, installee, plateforme, invite }),
    tactile: estTactile({ pointeurGrossier: media("(pointer: coarse)"), plateforme }),
  };
}

/**
 * Entrée « Installer lama sur cet appareil » (PWA, P-06) : `visible` dit s'il
 * faut la montrer, `installer` ouvre le dialogue du navigateur (Android,
 * ordinateur) ou la fenêtre des trois gestes (iPhone, iPad), `fenetre` est
 * cette fenêtre, à poser hors de tout menu qui se ferme.
 */
export function useInstaller(): { mode: ModeInstallation; tactile: boolean; visible: boolean; installer: () => void; fenetre: JSX.Element | null } {
  const [appareil, setAppareil] = useState(lireAppareil);
  const [ios, setIos] = useState(false);
  useEffect(() => onInstallation(() => setAppareil(lireAppareil())), []);
  const installer = () => {
    if (appareil.mode === "ios") setIos(true);
    else void lancerInvite().then(() => setAppareil(lireAppareil()));
  };
  return {
    ...appareil,
    visible: appareil.mode !== "aucun",
    installer,
    fenetre: ios ? <FenetreIos onClose={() => setIos(false)} /> : null,
  };
}

/** Les trois gestes de Safari sur iPhone et iPad, chacun avec son icône. */
function FenetreIos({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const etapes = [
    { Icone: Share, texte: t("installation.ios.partager") },
    { Icone: SquarePlus, texte: t("installation.ios.ecran_accueil") },
    { Icone: Check, texte: t("installation.ios.ajouter") },
  ];
  return (
    <Dialog open onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
      <DialogContent compact>
        <DialogHeader>
          <DialogTitle>{t("installation.entree")}</DialogTitle>
          <DialogDescription>{t("installation.ios.intro")}</DialogDescription>
        </DialogHeader>
        <ol className="space-y-3">
          {etapes.map(({ Icone, texte }, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-filet">
                <Icone className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="pt-2">{texte}</span>
            </li>
          ))}
        </ol>
        <DialogFooter>
          <Button type="button" onClick={onClose}>{t("installation.ios.compris")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Bandeau unique (P-06) : première connexion d'un téléphone ou d'une tablette
 * où lama n'est pas installé ; fermé ou utilisé, il ne revient plus sur cet
 * appareil (préférence locale, stockage refusé sans erreur).
 */
export function BandeauInstallation() {
  const { t } = useI18n();
  const installation = useInstaller();
  const [ferme, setFerme] = useState(readInstallBannerClosed);
  const fermer = () => {
    writeInstallBannerClosed();
    setFerme(true);
  };
  return (
    <>
      {doitProposerBandeau({ mode: installation.mode, tactile: installation.tactile, ferme }) && (
        <div role="status" className="hors-panneau border-b border-filet bg-muted px-4 py-2 text-sm text-foreground">
          <p className="flex items-center gap-2">
            <span className="min-w-0 flex-1">{t("installation.bandeau")}</span>
            <button type="button" className="-my-2 inline-flex min-h-11 shrink-0 items-center underline" onClick={() => { fermer(); installation.installer(); }}>
              {t("installation.installer")}
            </button>
            <button type="button" aria-label={t("commun.fermer")} className="-my-2 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center" onClick={fermer}>
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </p>
        </div>
      )}
      {installation.fenetre}
    </>
  );
}
