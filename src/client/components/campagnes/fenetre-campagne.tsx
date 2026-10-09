import { useEffect, useRef, useState } from "preact/hooks";
import { api, ApiError } from "../../api";
import { useAuth } from "../../auth-context";
import { campaignDrafts, campaignOffer, campaignProblem, campaignSms, type CampaignPreview } from "../../lib/campagnes";
import type { WhatsappText } from "../../lib/whatsapp";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Erreur, Succes } from "../champ";
import { EtatChargement } from "../comptoir";

/** « Écrire à ces clientes » sous la liste filtrée par une étiquette : la gérante seulement (décisions 27 et 29). */
export function BoutonCampagne({ tag }: { tag: string | null }) {
  const { account } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (!campaignOffer(account.role, tag)) return null;
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>{t("campagne.ecrire")}</Button>
      {open && <FenetreCampagne tag={tag!} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Campagne aux clientes d'une étiquette (décision 27) : destinataires et
 * exclues lus à l'ouverture, texte français prérempli par le modèle
 * « campagne » des Réglages, texte anglais vide au départ (vide, le
 * français part à toutes ; le modèle anglais se propose d'un clic), coût en SMS ; « Envoyer à N clientes »
 * demande une confirmation dans la fenêtre, puis met un message par
 * destinataire en file. Le focus revient au bouton d'origine à la fermeture.
 */
export function FenetreCampagne({ tag, onClose }: { tag: string; onClose: () => void }) {
  const { t, tn } = useI18n();
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [textFr, setTextFr] = useState<string | null>(null);
  const [textEn, setTextEn] = useState("");
  const [enModel, setEnModel] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const opener = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);

  // Destinataires et modèle « campagne » des Réglages, lus à l'ouverture.
  useEffect(() => {
    let actif = true;
    Promise.all([
      api<CampaignPreview>("GET", `/api/campaigns/preview?tag=${encodeURIComponent(tag)}`),
      api<{ texts: WhatsappText[] }>("GET", "/api/whatsapp/texts"),
    ])
      .then(([p, { texts }]) => {
        if (!actif) return;
        setPreview(p);
        const drafts = campaignDrafts(texts);
        setTextFr(drafts.fr);
        setTextEn(drafts.en);
        setEnModel(drafts.enModel);
      })
      .catch((err) => { if (actif) setError(err instanceof ApiError ? err.message : t("erreur.reseau")); });
    return () => { actif = false; };
  }, [tag]); // eslint-disable-line react-hooks/exhaustive-deps

  const problem = textFr === null ? null : campaignProblem(textFr, textEn);
  const cost = campaignSms(textFr ?? "", textEn, preview?.recipients ?? 0);
  const ready = preview !== null && preview.recipients > 0 && textFr !== null && problem === null;

  const send = async () => {
    if (sending.current || !ready) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ recipients: number }>("POST", "/api/campaigns", { tag, text_fr: textFr, text_en: textEn });
      setOk(tn("campagne.en_file", result.recipients));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("erreur.reseau"));
    } finally {
      setConfirming(false);
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o: boolean) => { if (!o && !busy) onClose(); }}>
      <DialogContent onCloseAutoFocus={(e: Event) => { e.preventDefault(); (opener.current as HTMLElement | null)?.focus?.(); }}>
        <DialogHeader>
          <DialogTitle>{t("campagne.titre", { etiquette: tag })}</DialogTitle>
          <DialogDescription>{t("campagne.aide")}</DialogDescription>
        </DialogHeader>
        {preview === null && !error && <EtatChargement />}
        {preview && (
          <div className="space-y-1 text-sm">
            <p className="chiffres-tabulaires font-medium">{tn("campagne.destinataires", preview.recipients)} · {tn("campagnes.exclues", preview.excluded)}</p>
            {preview.excluded > 0 && <p className="text-xs text-muted-foreground">{t("campagne.exclues_aide")}</p>}
          </div>
        )}
        {preview?.recipients === 0 && <Erreur message={t("campagne.aucune_destinataire")} />}
        {textFr !== null && !confirming && ok === null && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="campagne-texte-fr">{t("campagne.texte_fr")}</Label>
              <Textarea id="campagne-texte-fr" rows={4} maxLength={1000} value={textFr} onInput={(e: Event) => setTextFr((e.currentTarget as HTMLTextAreaElement).value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="campagne-texte-en">{t("campagne.texte_en")}</Label>
              <Textarea id="campagne-texte-en" rows={4} maxLength={1000} value={textEn} onInput={(e: Event) => setTextEn((e.currentTarget as HTMLTextAreaElement).value)} />
              {textEn.trim() === "" && enModel.trim() !== "" && (
                <Button type="button" variant="outline" size="sm" onClick={() => setTextEn(enModel)}>{t("campagne.proposer_anglais")}</Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("campagne.variables")}</p>
            {preview !== null && preview.recipients > 0 && <p className="text-xs text-muted-foreground">{t("campagne.cout", { count: cost.perMessage, total: cost.total })}</p>}
            <Erreur message={problem ? t(problem.key, problem.values) : null} />
          </div>
        )}
        {confirming && preview && <p className="text-sm">{tn("campagne.confirmer_question", preview.recipients)}</p>}
        <Erreur message={error} />
        <Succes message={ok} />
        <DialogFooter>
          {ok !== null && <Button type="button" variant="outline" onClick={onClose}>{t("commun.fermer")}</Button>}
          {ok === null && confirming && (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>{t("campagne.retour")}</Button>
              <Button type="button" disabled={busy} onClick={() => void send()}>{t("campagne.confirmer")}</Button>
            </>
          )}
          {ok === null && !confirming && (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t("commun.annuler")}</Button>
              {preview !== null && <Button type="button" disabled={!ready} onClick={() => setConfirming(true)}>{tn("campagne.envoyer", preview.recipients)}</Button>}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
