import { useState } from "preact/hooks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/provider";
import { formatPrice } from "@/lib/format";
import { Champ, Erreur } from "../champ";
import { Montant } from "../comptoir";

/**
 * Remise au-delà du plafond, à la réception (sous-projet 5 § 4.3) : une
 * gérante tape son identifiant et son mot de passe sur cet écran ; le serveur
 * les contrôle comme à la connexion, puis la même vente est renvoyée. La
 * gérante qui encaisse elle-même retape son propre mot de passe (fenêtre de
 * confirmation habituelle). La fenêtre montre ce que la gérante approuve
 * (retouche 5) : la remise (pourcentage ou montant, motif) et le total après
 * remise, puisque le ticket n'est plus à l'écran.
 */
export function Approbation({ cap, discount, total, refused, pending, onApprove, onClose }: {
  cap: number;
  /** Remise à approuver : libellé (« Remise geste commercial 20 % ») et montant retiré. */
  discount: { label: string; amount: number };
  /** Total de la facture après remise. */
  total: number;
  /** Refus du serveur (identifiant ou mot de passe incorrect), à dire dans la fenêtre. */
  refused: string | null;
  pending: boolean;
  onApprove: (login: string, password: string) => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const submit = (e: Event) => {
    e.preventDefault();
    onApprove(login.trim(), password);
    setPassword("");
  };
  return (
    <Dialog open onOpenChange={(open: boolean) => { if (!open && !pending) onClose(); }}>
      <DialogContent compact focusChamp>
        <DialogTitle>{t("caisse.approbation_titre")}</DialogTitle>
        <DialogDescription>{t("caisse.approbation_texte", { plafond: cap })}</DialogDescription>
        <dl className="space-y-1.5 border-y border-filet py-3 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="min-w-0">{discount.label}</dt>
            <dd className="chiffres-tabulaires text-base whitespace-nowrap">{"\u2013\u00a0"}<Montant valeur={formatPrice(discount.amount, lang)} /></dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="etiquette">{t("caisse.total")}</dt>
            <dd className="chiffres-tabulaires text-base whitespace-nowrap"><Montant valeur={formatPrice(total, lang)} /></dd>
          </div>
        </dl>
        <form className="space-y-4" onSubmit={submit}>
          <Champ id="approbation-identifiant" label={t("caisse.approbation_identifiant")} autoComplete="off" autoCapitalize="none" value={login} onInput={(e: Event) => setLogin((e.currentTarget as HTMLInputElement).value)} autoFocus />
          <Champ id="approbation-mot-de-passe" type="password" label={t("connexion.mot_de_passe")} autoComplete="off" value={password} onInput={(e: Event) => setPassword((e.currentTarget as HTMLInputElement).value)} />
          <Erreur message={refused} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>{t("commun.annuler")}</Button>
            <Button type="submit" disabled={pending || !login.trim() || !password}>{t("caisse.approuver")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
