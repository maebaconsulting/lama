import { useEffect, useRef, useState } from "preact/hooks";
import { api, ApiError } from "../../api";
import type { Client, Product } from "../../types";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { pickText } from "@/lib/bilingual";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Erreur, Succes } from "../champ";
import { EtatChargement } from "../comptoir";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Un résultat de recherche : produit (nom, prix) ou cliente (nom, téléphone). */
type Choix = { id: number; libelle: string; detail: string };

/**
 * Envoi d'un produit recommandé par WhatsApp (images des produits, spec § 2),
 * réception et gérante : depuis la fiche cliente (`clientId`, recherche du
 * produit) ou depuis la fiche produit (`productId`, recherche de la
 * cliente), puis le même message prérempli par le serveur (texte de la
 * gérante, langue de la cliente), modifiable avant l'envoi. Même envoi
 * derrière : `POST /api/products/{id}/whatsapp`. Un refus (cliente sans
 * numéro) s'affiche et le choix peut être refait sans fermer la fenêtre.
 * Ouverte sans déclencheur : le focus revient au bouton d'origine à la fermeture.
 */
export function FenetreEnvoiProduit({ productId, clientId, onClose }: { productId?: number; clientId?: number; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [produit, setProduit] = useState<number | null>(productId ?? null);
  const [cliente, setCliente] = useState<number | null>(clientId ?? null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Choix[] | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [imageVersion, setImageVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const opener = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);
  const chercheProduit = produit === null;
  const choisi = produit !== null && cliente !== null;

  // Recherche côté serveur (sans accents), 8 résultats au plus, après une courte pause de frappe.
  useEffect(() => {
    if (choisi) return;
    const q = search.trim();
    setError(null);
    if (!q) { setResults(null); return; }
    let actif = true;
    const timer = setTimeout(async () => {
      try {
        const path = chercheProduit ? `/api/products?search=${encodeURIComponent(q)}&limit=8` : `/api/clients?search=${encodeURIComponent(q)}&limit=8`;
        const found = chercheProduit
          ? (await api<{ products: Product[] }>("GET", path)).products.map((p) => ({ id: p.id, libelle: pickText(lang, p.name, p.name_en), detail: formatPrice(p.price, lang) }))
          : (await api<{ clients: Client[] }>("GET", path)).clients.map((c) => ({ id: c.id, libelle: c.name, detail: c.phone }));
        if (actif) setResults(found);
      } catch (err) {
        if (actif) setError(err instanceof ApiError ? err.message : t("erreur.reseau"));
      }
    }, 250);
    return () => { actif = false; clearTimeout(timer); };
  }, [search, choisi, chercheProduit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Produit et cliente choisis : texte prérempli par le serveur.
  useEffect(() => {
    if (produit === null || cliente === null) return;
    let actif = true;
    setError(null);
    setText(null);
    api<{ text: string; image_version: number | null }>("GET", `/api/products/${produit}/whatsapp?client_id=${cliente}`)
      .then((r) => { if (actif) { setText(r.text); setImageVersion(r.image_version); } })
      .catch((err) => { if (actif) setError(err instanceof ApiError ? err.message : t("erreur.reseau")); });
    return () => { actif = false; };
  }, [produit, cliente]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Revient à la recherche de ce qui n'était pas fixé par la fiche. */
  const changer = () => {
    setText(null);
    setError(null);
    setSearch("");
    setResults(null);
    if (productId === undefined) setProduit(null);
    else setCliente(null);
  };

  const send = async () => {
    if (sending.current || busy || produit === null || cliente === null || text === null) return;
    sending.current = true;
    setError(null);
    setBusy(true);
    try {
      await api("POST", `/api/products/${produit}/whatsapp`, { client_id: cliente, text });
      setOk(t("whatsapp.produit_en_file"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("erreur.reseau"));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o: boolean) => { if (!o) onClose(); }}>
      <DialogContent onCloseAutoFocus={(e: Event) => { e.preventDefault(); (opener.current as HTMLElement | null)?.focus?.(); }}>
        <DialogHeader>
          <DialogTitle>{t(productId === undefined ? "whatsapp.joindre_produit" : "whatsapp.envoyer_a_cliente")}</DialogTitle>
          <DialogDescription>{t("whatsapp.produit_aide")}</DialogDescription>
        </DialogHeader>
        {!choisi && (
          <div className="space-y-2">
            <Label htmlFor="envoi-produit-recherche">{t(chercheProduit ? "whatsapp.chercher_produit" : "whatsapp.chercher_cliente")}</Label>
            <Input id="envoi-produit-recherche" type="search" value={search} onInput={(e: Event) => setSearch((e.currentTarget as HTMLInputElement).value)} />
            {results !== null && results.length === 0 && <p className="text-sm text-muted-foreground">{t("whatsapp.aucun_resultat")}</p>}
            {results !== null && results.length > 0 && (
              <ul className="divide-y divide-border rounded-sm border border-filet">
                {results.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => (chercheProduit ? setProduit(r.id) : setCliente(r.id))} className={cn("flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left transition-colors duration-200 hover:bg-muted", FOCUS)}>
                      <span className="min-w-0 truncate font-medium">{r.libelle}</span>
                      <span className="shrink-0 text-sm text-muted-foreground">{r.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {choisi && text === null && !error && <EtatChargement />}
        {choisi && text !== null && (
          <div className="space-y-2">
            <Label htmlFor="envoi-produit-texte">{t("cliente.message_whatsapp")}</Label>
            <Textarea id="envoi-produit-texte" rows={4} maxLength={1000} value={text} disabled={ok !== null} onInput={(e: Event) => setText((e.currentTarget as HTMLTextAreaElement).value)} />
            <p className="text-xs text-muted-foreground">{t(imageVersion === null ? "whatsapp.produit_sans_photo" : "whatsapp.produit_avec_photo")}</p>
          </div>
        )}
        <Erreur message={error} />
        <Succes message={ok} />
        {choisi && ok === null && (
          <div><Button type="button" variant="ghost" onClick={changer}>{t(productId === undefined ? "whatsapp.changer_produit" : "whatsapp.changer_cliente")}</Button></div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t(ok ? "commun.fermer" : "commun.annuler")}</Button>
          {ok === null && <Button type="button" disabled={busy || !text?.trim()} onClick={() => void send()}>{t("cliente.envoyer_whatsapp")}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
