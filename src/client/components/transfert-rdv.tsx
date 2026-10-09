import { useEffect, useRef, useState } from "preact/hooks";
import { api, ApiError } from "../api";
import { useApp } from "../context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/provider";
import { pickText } from "@/lib/bilingual";
import { todayAt } from "@/lib/calendrier";
import { formatRange, formatShortDate } from "@/lib/format";
import { refreshPlan } from "@/lib/realtime";
import { emitRefresh } from "@/lib/refresh-bus";
import { busyChoices, clampTo, initialChoices, lastDay, MAX_PERIOD_DAYS, staffOptions, startDay, toReplace, transferBody, transferCount, type Choices, type Proposal } from "@/lib/transfert";
import { cn } from "@/lib/utils";
import { Erreur } from "./champ";
import { ChampDate } from "./champ-date";
import { Case, SELECT } from "./reglages/elements";

/**
 * Fenêtre « Transférer des rendez-vous » (spec du 04/10/2026, § 2), plein
 * écran au téléphone : praticienne absente, période (aujourd'hui par
 * défaut), case « Prévenir les clientes » cochée, un rendez-vous par ligne
 * avec la collègue proposée ; « à replacer » en trait de cuir quand personne
 * n'est choisi. Un seul bouton valide le tout ; si l'agenda a changé
 * entre-temps (409), rien n'est écrit et la proposition est recalculée.
 * Une fois le transfert fait, `onDone` reçoit l'avis bref (« N rendez-vous
 * transférés, M à replacer ») que l'écran appelant garde après la fermeture.
 */
export function TransfertRdv({ staffId, staffName, day, onClose, onDone }: { staffId: number | null; staffName?: string; day: string | null; onClose: () => void; onDone?: (notice: string) => void }) {
  const { staffLookup } = useApp();
  const { t, tn, lang } = useI18n();
  const today = todayAt();
  const [fromId, setFromId] = useState(staffId !== null ? String(staffId) : "");
  const [from, setFrom] = useState(() => startDay(day, today));
  const [to, setTo] = useState(() => startDay(day, today));
  const [notify, setNotify] = useState(true);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [choices, setChoices] = useState<Choices>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  // Garde contre le double envoi : `saving` ne change qu'au rendu suivant.
  const sending = useRef(false);
  // Après un 409, la proposition reste affichée pendant son recalcul ; sinon elle est vidée au changement de praticienne ou de période.
  const keepRows = useRef(false);

  useEffect(() => {
    if (!fromId || !from || !to) { setProposal(null); setLoading(false); return; }
    let live = true;
    setLoading(true);
    if (keepRows.current) keepRows.current = false;
    else setProposal(null);
    api<Proposal>("GET", `/api/transfers/proposal?${new URLSearchParams({ staff_id: fromId, from, to })}`)
      .then((p) => {
        if (!live) return;
        setProposal(p);
        setChoices(initialChoices(p.appointments));
      })
      .catch((err) => { if (live) { setProposal(null); setError((err as Error).message); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [fromId, from, to, reloads]);

  const rows = proposal?.appointments ?? [];
  const staff = proposal?.staff ?? [];
  const fromName = proposal?.from.name ?? staffName ?? "";
  const count = transferCount(rows, choices);
  const leftover = toReplace(rows, choices).length;
  // Praticiennes au choix : les fiches actives, plus celle demandée si sa fiche est désactivée.
  const absents = staffId !== null && !staffLookup.some((s) => s.id === staffId)
    ? [...staffLookup, { id: staffId, name: staffName ?? "", color: "" }]
    : staffLookup;

  const close = () => { if (!saving) onClose(); };
  const submit = async () => {
    if (!proposal || sending.current || count === 0) return;
    const blocked = busyChoices(rows, choices, staff);
    if (blocked.length > 0) {
      const name = staff.find((s) => s.id === choices[blocked[0].id])?.name ?? "";
      setError(t("transfert.occupee_choisie", { nom: name, ref: blocked[0].identifier }));
      return;
    }
    sending.current = true;
    setSaving(true);
    setError(null);
    try {
      const done = await api<{ moved: number }>("POST", "/api/transfers", transferBody(proposal.from.id, rows, choices, notify));
      emitRefresh([...refreshPlan(["appointments"]), "staff"]);
      onDone?.(leftover > 0 ? tn("transfert.fait_reste", done.moved, { reste: leftover }) : tn("transfert.fait", done.moved));
      onClose();
    } catch (err) {
      // 409 : rien n'a été écrit ; chaque raison est dite, puis la proposition est recalculée.
      const conflicts = err instanceof ApiError && err.status === 409 ? (err.body as { conflicts?: { reason: string }[] } | null)?.conflicts ?? null : null;
      setError(conflicts ? [(err as Error).message, ...conflicts.map((c) => c.reason), t("transfert.recalculee")].join(" ") : (err as Error).message);
      if (conflicts) { keepRows.current = true; setReloads((n) => n + 1); }
    } finally {
      sending.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={close}>
      <DialogContent className="md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("transfert.titre")}</DialogTitle>
          <DialogDescription>{t("transfert.aide")}</DialogDescription>
        </DialogHeader>
        <fieldset disabled={saving} className="grid min-w-0 grid-cols-2 gap-3">
          <div className="col-span-2 min-w-0 space-y-1.5">
            <Label htmlFor="transfert-praticienne">{t("transfert.praticienne")}</Label>
            <select id="transfert-praticienne" className={SELECT} value={fromId} onChange={(e) => {
              setFromId((e.target as HTMLSelectElement).value); setError(null);
            }}>
              <option value="">{t("transfert.choisir")}</option>
              {absents.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="transfert-du">{t("transfert.du")}</Label>
            <ChampDate id="transfert-du" required min={today} value={from} onValue={(v: string) => {
              setFrom(v); setTo(clampTo(v, to)); setError(null);
            }} />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="transfert-au">{t("transfert.au")}</Label>
            <ChampDate id="transfert-au" required min={from} max={lastDay(from)} value={to} onValue={(v: string) => {
              setTo(v); setError(null);
            }} />
          </div>
          <p className="col-span-2 -mt-1 text-xs text-muted-foreground">{t("transfert.periode_aide", { jours: MAX_PERIOD_DAYS })}</p>
          <div className="col-span-2 min-w-0">
            <Case id="transfert-prevenir" label={t("transfert.prevenir")} hint={notify ? t("transfert.prevenir_aide") : undefined} checked={notify} onChange={setNotify} />
          </div>
        </fieldset>
        {loading && <p className="text-sm text-muted-foreground">{t("commun.chargement")}</p>}
        {!loading && proposal && rows.length === 0 && (
          <p className="rounded-sm border border-filet p-4 text-center text-sm text-muted-foreground">{t("transfert.vide")}</p>
        )}
        {rows.length > 0 && (
          <ul className="divide-y divide-filet border-y border-filet">
            {rows.map((row) => {
              const choice = choices[row.id] ?? null;
              const options = staffOptions(row, rows, choices, staff);
              const selectId = `transfert-ligne-${row.id}`;
              return (
                <li key={row.id} className={cn("grid min-w-0 gap-2 py-3 pl-3 md:grid-cols-[1fr_14rem] md:items-center", choice === null && "border-l-2 border-primary")}>
                  <div className="min-w-0">
                    <p className="chiffres-tabulaires text-sm font-medium">{formatShortDate(row.date, lang)} · {formatRange(row.start_time, row.end_time)}</p>
                    <p className="truncate text-sm">{row.client_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{row.services.map((s) => pickText(lang, s.name, s.name_en)).join(", ")}</p>
                    {choice === null && (
                      <span className="etiquette mt-1 inline-flex rounded-sm border border-primary px-2 py-0.5 font-medium text-primary">{t("transfert.a_replacer")}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor={selectId} className="sr-only">{t("transfert.confier", { ref: row.identifier })}</Label>
                    <select id={selectId} className={SELECT} value={choice === null ? "" : String(choice)} disabled={saving} onChange={(e) => {
                      const value = (e.target as HTMLSelectElement).value;
                      setChoices({ ...choices, [row.id]: value ? Number(value) : null });
                      setError(null);
                    }}>
                      <option value="">{t("transfert.laisser", { nom: fromName })}</option>
                      {options.free.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      {options.busy.map((s) => <option key={s.id} value={s.id}>{t("transfert.occupee", { nom: s.name })}</option>)}
                    </select>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {leftover > 0 && <p className="text-sm text-muted-foreground">{tn("transfert.reste", leftover)}</p>}
        <Erreur message={error} />
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={close}>{t("commun.annuler")}</Button>
          <Button type="button" disabled={saving || loading || count === 0} onClick={submit}>
            {saving ? t("commun.enregistrement") : tn("transfert.valider", count)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
