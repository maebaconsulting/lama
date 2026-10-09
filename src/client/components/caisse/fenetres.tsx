/**
 * Fenêtres du ticket (sous-projet 5 § 4.1 et § 4.3) : choix de la cliente,
 * remise (pourcentage ou montant, motif obligatoire, plafond dit d'avance),
 * pourboire (montant et praticienne). Chaque fenêtre rend sa valeur par
 * `onDone` ; rien n'est envoyé au serveur avant « Encaisser ».
 */
import { useState } from "preact/hooks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/provider";
import { matchesSearch } from "@/lib/bilingual";
import { cardChoice, cardMatches } from "@/lib/crm";
import { reasonLabel } from "@/lib/caisse-texte";
import { formatPrice, parseAmount } from "@/lib/format";
import { nameProblem } from "@/lib/forms";
import { pointsText, type RewardChoice } from "@/lib/fidelite";
import { rewardDiscount, type TicketDiscount } from "@/lib/ticket";
import { cn } from "@/lib/utils";
import { DISCOUNT_REASONS, discountAmount, exceedsCap } from "../../../shared/caisse";
import type { ClientLookup, StaffLookup } from "../../types";
import { SELECT } from "../reglages/elements";
import { Erreur } from "../champ";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";
/** Gros sélecteur de 64 px (charte) : choix actif en cuir. */
const choix = (actif: boolean) => cn(
  "min-h-16 rounded-sm border px-3 text-sm font-medium transition-colors duration-200",
  actif ? "border-primary bg-primary text-primary-foreground" : "border-filet bg-card hover:bg-muted",
  FOCUS,
);

/**
 * Cliente du ticket : recherche sans accents dans toutes les clientes, par
 * nom ou par numéro de carte (mini CRM § 5) ; un lecteur de cartes en mode
 * clavier tape le numéro puis Entrée : la cliente est choisie. « Sans
 * cliente » pour une vente de produits. « Nouvelle cliente » (gérante,
 * réception) crée la fiche sur place, nom seul ou avec le téléphone, et la
 * choisit : une cliente de passage peut recevoir une prestation.
 */
export function ChoixCliente({ clients, current, onDone, onClose, onCreate }: {
  clients: ClientLookup[];
  current: number | null;
  onDone: (clientId: number | null) => void;
  onClose: () => void;
  /** Crée la cliente et rend son identifiant ; absent, pas de création depuis la caisse. */
  onCreate?: (data: { name: string; phone: string }) => Promise<number>;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const found = clients.filter((c) => matchesSearch(search, c.name) || cardMatches(search, c.card)).slice(0, 40);
  const exact = cardChoice(search, clients);
  if (creating && onCreate) {
    // Nom repris de la recherche quand elle contient une lettre (un numéro de carte n'est pas un nom).
    return <NouvelleCliente initialName={/\p{L}/u.test(search) ? search.trim() : ""} onCreate={onCreate} onDone={onDone} onBack={() => setCreating(false)} onClose={onClose} />;
  }
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("caisse.choisir_cliente")}</DialogTitle>
          <DialogDescription>{t("caisse.choisir_cliente_aide")}</DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          aria-label={t("crm.chercher_nom_carte")}
          placeholder={t("crm.chercher_nom_carte")}
          value={search}
          onInput={(e: Event) => setSearch((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Enter" && exact !== null) { e.preventDefault(); onDone(exact); }
          }}
        />
        <ul aria-label={t("menu.clientes")} className="divide-y divide-border rounded-sm border border-filet">
          {found.map((c) => (
            <li key={c.id}>
              <button type="button" aria-current={c.id === current ? "true" : undefined} onClick={() => onDone(c.id)} className={cn("flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left hover:bg-muted", c.id === current && "bg-muted font-medium", FOCUS)}>
                <span className="min-w-0 truncate">{c.name}</span>
                {c.card && cardMatches(search, c.card) && <span className="chiffres-tabulaires shrink-0 text-sm text-muted-foreground">{c.card}</span>}
              </button>
            </li>
          ))}
          {found.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">{t("caisse.aucune_cliente")}</li>}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("commun.annuler")}</Button>
          <Button variant="outline" onClick={() => onDone(null)}>{t("caisse.sans_cliente")}</Button>
          {onCreate && <Button onClick={() => setCreating(true)}>{t("caisse.nouvelle_cliente")}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Numéro d'exemple au format du Cameroun (sans lettre : identique dans les deux langues). */
const PHONE_EXAMPLE = "+237 6 77 12 34 56";

/**
 * Nouvelle cliente depuis la caisse : nom obligatoire, téléphone facultatif ;
 * le reste de la fiche se complète plus tard. Créée, elle est choisie pour le ticket.
 */
function NouvelleCliente({ initialName, onCreate, onDone, onBack, onClose }: {
  initialName: string;
  onCreate: (data: { name: string; phone: string }) => Promise<number>;
  onDone: (clientId: number) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const problem = nameProblem(name);
    if (problem) { setError(t(problem)); return; }
    setError(null);
    setSaving(true);
    try {
      onDone(await onCreate({ name: name.trim(), phone: phone.trim() }));
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };
  // Entrée dans un champ : même effet que « Créer et choisir », jamais deux envois.
  const onEnter = (e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); if (!saving) void submit(); } };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("caisse.nouvelle_cliente")}</DialogTitle>
          <DialogDescription>{t("caisse.nouvelle_cliente_aide")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="caisse-nom-cliente">{t("commun.nom_obligatoire")}</Label>
            <Input id="caisse-nom-cliente" autoComplete="off" value={name} onInput={(e: Event) => setName((e.currentTarget as HTMLInputElement).value)} onKeyDown={onEnter} placeholder={t("commun.nom_complet")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="caisse-tel-cliente">{t("caisse.telephone_facultatif")}</Label>
            <Input id="caisse-tel-cliente" type="tel" inputMode="tel" autoComplete="off" value={phone} onInput={(e: Event) => setPhone((e.currentTarget as HTMLInputElement).value)} onKeyDown={onEnter} placeholder={PHONE_EXAMPLE} />
          </div>
          <Erreur message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onBack}>{t("caisse.retour_liste")}</Button>
          <Button disabled={saving} onClick={() => void submit()}>{t("caisse.creer_et_choisir")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Remise sur la facture (§ 4.3) : pourcentage ou montant, motif choisi ;
 * au-delà du plafond, la fenêtre prévient que le mot de passe d'une gérante
 * sera demandé à l'émission.
 */
export function FenetreRemise({ subtotal, cap, current, onDone, onClose }: {
  subtotal: number;
  cap: number;
  current: TicketDiscount | null;
  onDone: (discount: TicketDiscount | null) => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [kind, setKind] = useState<TicketDiscount["kind"]>(current?.kind ?? "percent");
  const [value, setValue] = useState(current ? String(current.value) : "");
  const [reason, setReason] = useState<TicketDiscount["reason"] | null>(current?.reason ?? null);
  const [note, setNote] = useState(current?.note ?? "");
  const amount = kind === "percent" ? Math.min(Math.round(Number(value.replace(",", ".")) || 0), 100) : parseAmount(value);
  const off = discountAmount(subtotal, amount > 0 ? { kind, value: amount } : null);
  const ready = amount > 0 && reason !== null && (reason !== "autre" || note.trim() !== "");
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("caisse.remise")}</DialogTitle>
          <DialogDescription>{t("caisse.remise_aide")}</DialogDescription>
        </DialogHeader>
        <div role="group" aria-label={t("caisse.remise_type")} className="grid grid-cols-2 gap-2">
          <button type="button" aria-pressed={kind === "percent"} className={choix(kind === "percent")} onClick={() => setKind("percent")}>{t("caisse.pourcentage")}</button>
          <button type="button" aria-pressed={kind === "amount"} className={choix(kind === "amount")} onClick={() => setKind("amount")}>{t("caisse.montant")}</button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="remise-valeur">{kind === "percent" ? t("caisse.remise_pourcentage") : t("caisse.remise_montant")}</Label>
          <Input id="remise-valeur" type="text" inputMode="numeric" value={value} onInput={(e: Event) => setValue((e.currentTarget as HTMLInputElement).value)} />
        </div>
        <div role="group" aria-label={t("caisse.motif")} className="grid grid-cols-3 gap-2">
          {DISCOUNT_REASONS.map((r) => (
            <button key={r} type="button" aria-pressed={reason === r} className={cn(choix(reason === r), "px-2 leading-tight")} onClick={() => setReason(r)}>{reasonLabel(r, lang)}</button>
          ))}
        </div>
        {reason === "autre" && (
          <div className="space-y-1.5">
            <Label htmlFor="remise-motif">{t("caisse.motif_libre")}</Label>
            <Input id="remise-motif" maxLength={120} value={note} onInput={(e: Event) => setNote((e.currentTarget as HTMLInputElement).value)} />
          </div>
        )}
        <p className="text-sm" aria-live="polite">
          {t("caisse.remise_apercu", { remise: formatPrice(off, lang), total: formatPrice(subtotal - off, lang) })}
        </p>
        {off > 0 && exceedsCap(subtotal, off, cap) && <p className="text-sm text-encre-rouge">{t("caisse.remise_au_dela", { plafond: cap })}</p>}
        <DialogFooter>
          {current && <Button variant="trait-rouge" onClick={() => onDone(null)}>{t("caisse.retirer_remise")}</Button>}
          <Button variant="outline" onClick={onClose}>{t("commun.annuler")}</Button>
          <Button disabled={!ready} onClick={() => onDone({ kind, value: amount, reason: reason!, note: reason === "autre" ? note.trim() : "" })}>{t("caisse.appliquer")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Pourboire (§ 4.3) : montant et praticienne (celle du rendez-vous par défaut), hors facture et sans TVA. */
export function FenetrePourboire({ staff, current, defaultStaff, onDone, onClose }: {
  staff: StaffLookup[];
  current: { amount: number; staff_id: number } | null;
  defaultStaff: number | null;
  onDone: (tip: { amount: number; staff_id: number } | null) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(current ? String(current.amount) : "");
  const [staffId, setStaffId] = useState<number | null>(current?.staff_id ?? defaultStaff ?? staff[0]?.id ?? null);
  const amount = parseAmount(value);
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("caisse.pourboire")}</DialogTitle>
          <DialogDescription>{t("caisse.pourboire_aide")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="pourboire-montant">{t("caisse.montant")}</Label>
          <Input id="pourboire-montant" type="text" inputMode="numeric" value={value} onInput={(e: Event) => setValue((e.currentTarget as HTMLInputElement).value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pourboire-praticienne">{t("caisse.praticienne")}</Label>
          <select id="pourboire-praticienne" className={SELECT} value={staffId ?? ""} onChange={(e: Event) => setStaffId(Number((e.currentTarget as HTMLSelectElement).value) || null)}>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <DialogFooter>
          {current && <Button variant="trait-rouge" onClick={() => onDone(null)}>{t("caisse.retirer_pourboire")}</Button>}
          <Button variant="outline" onClick={onClose}>{t("commun.annuler")}</Button>
          <Button disabled={amount <= 0 || staffId === null} onClick={() => onDone({ amount, staff_id: staffId! })}>{t("caisse.appliquer")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Récompense fidélité (mini CRM § 2, décision 14) : paliers que le solde de
 * la cliente atteint. La récompense remplace la remise du ticket ; son
 * montant est ramené au sous-total s'il le dépasse, et la fenêtre dit avant
 * que les points du palier sont tout de même dépensés (à l'émission).
 */
export function FenetreRecompense({ balance, choices, current, replacesDiscount, onDone, onClose }: {
  balance: number;
  choices: RewardChoice[];
  /** Points du palier déjà au ticket, ou `null`. */
  current: number | null;
  /** Une remise saisie est au ticket : elle sera remplacée. */
  replacesDiscount: boolean;
  onDone: (discount: TicketDiscount | null) => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [chosen, setChosen] = useState<number | null>(current ?? (choices.length === 1 ? choices[0].points : null));
  const selected = choices.find((c) => c.points === chosen) ?? null;
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("fidelite.recompense")}</DialogTitle>
          <DialogDescription>{t("fidelite.recompense_aide", { solde: pointsText(balance, lang) })}</DialogDescription>
        </DialogHeader>
        <div role="group" aria-label={t("fidelite.paliers_atteints")} className="grid gap-2">
          {choices.map((c) => (
            <button key={c.points} type="button" aria-pressed={chosen === c.points} className={cn(choix(chosen === c.points), "text-left")} onClick={() => setChosen(c.points)}>
              {t("fidelite.palier_choix", { points: pointsText(c.points, lang), montant: formatPrice(c.montant, lang) })}
            </button>
          ))}
        </div>
        {selected?.capped && (
          <p className="text-sm text-encre-rouge" aria-live="polite">
            {t("fidelite.ramenee", { montant: formatPrice(selected.applied, lang), points: pointsText(selected.points, lang) })}
          </p>
        )}
        {replacesDiscount && <p className="text-sm text-muted-foreground">{t("fidelite.remplace_remise")}</p>}
        <DialogFooter>
          {current !== null && <Button variant="trait-rouge" onClick={() => onDone(null)}>{t("fidelite.retirer")}</Button>}
          <Button variant="outline" onClick={onClose}>{t("commun.annuler")}</Button>
          <Button disabled={selected === null} onClick={() => selected && onDone(rewardDiscount(selected))}>{t("caisse.appliquer")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
