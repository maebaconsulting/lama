import type { ComponentChildren } from "preact";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/provider";
import { useEnvoi } from "../hooks/use-envoi";

/**
 * Confirmation compacte d'une suppression (décision 5 de la passe V 1.0), sur
 * le modèle de la fiche d'un rendez-vous : petite fenêtre `alertdialog`,
 * question, détail, « Annuler » puis le bouton rouge. Le bouton rouge ne lance
 * `onConfirm` qu'une fois, même au double toucher ; pendant la requête, les
 * deux boutons sont grisés et ni Échap, ni la croix, ni le clic hors de la
 * fenêtre ne la ferment. Elle se ferme ensuite, réussite ou refus : `onConfirm`
 * affiche lui-même son erreur (`.catch`).
 */
export function ConfirmerSuppression({ titre, detail, action, onConfirm, onClose }: {
  titre: string;
  detail?: ComponentChildren;
  action: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const envoi = useEnvoi();
  const confirmer = async () => {
    let lance = true;
    try {
      lance = await envoi.lancer("suppression", onConfirm);
    } catch {
      // Un `onConfirm` qui rejette ne doit pas devenir une promesse rejetée non traitée : l'appelant affiche son erreur.
    } finally {
      // Un second appui ignoré (`false`) ne ferme pas la fenêtre : le premier s'en charge.
      if (lance) onClose();
    }
  };
  return (
    <Dialog open onOpenChange={(open: boolean) => { if (!open && !envoi.occupe) onClose(); }}>
      <DialogContent compact role="alertdialog">
        <DialogHeader>
          <DialogTitle>{titre}</DialogTitle>
          {detail !== undefined && <DialogDescription>{detail}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={envoi.occupe} onClick={onClose}>{t("commun.annuler")}</Button>
          <Button type="button" variant="destructive" disabled={envoi.occupe} onClick={() => void confirmer()}>{action}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
