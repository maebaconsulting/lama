import { useEffect, useState } from "preact/hooks";
import { Phone } from "lucide-preact";
import { api } from "../../api";
import { useApp } from "../../context";
import { useLoad } from "../../hooks/use-load";
import type { DemandeEnLigne } from "../../types";
import { useI18n } from "@/i18n/provider";
import type { Key } from "@/i18n/translate";
import { Button } from "@/components/ui/button";
import { Succes } from "../champ";
import { EtatChargement, EtatErreur, EtatVide } from "../comptoir";
import { actionsDe, delaiDepuis, issueDe, libelleEtat, libelleFiche, libelleSouhait, praticienneDemandee, prestationDe, telephoneLisible, type ActionDialogue } from "@/lib/demandes-en-ligne";
import { telHref } from "@/lib/fiches";
import { formatLongDate, formatRange } from "@/lib/format";
import { DialogueDemande } from "./dialogue-demande";

type Filtre = "a_traiter" | "toutes";

/** Instant de l'appareil, relu chaque minute : seulement pour « il y a 5 min » (écart entre deux instants). */
function useMaintenant(): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function Carte({ d, maintenant, agir }: { d: DemandeEnLigne; maintenant: number; agir: (action: ActionDialogue) => void }) {
  const { t, tn, lang } = useI18n();
  const { openPanel } = useApp();
  const tel = telHref(d.cliente_telephone);
  const fiche = libelleFiche(d, lang);
  const actions = actionsDe(d.etat);
  const issue = issueDe(d, lang);
  return (
    <li className="space-y-2 rounded-sm border border-filet bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="etiquette text-encre-grise">{t(d.type === "rappel" ? "demandes.type.rappel" : "demandes.type.creneau")} · {libelleEtat(d.etat, lang)}{issue && ` · ${issue}`}</p>
        <p className="text-xs text-muted-foreground">{delaiDepuis(d.recue_le, maintenant, lang)}</p>
      </div>
      <p className="font-medium">{prestationDe(d, lang)}</p>
      {d.type === "creneau" && d.date && d.start_time && d.end_time
        ? <p className="chiffres text-sm">{formatLongDate(d.date, lang)} · {formatRange(d.start_time, d.end_time)}</p>
        : d.souhait && <p className="text-sm">{libelleSouhait(d.souhait, lang)}</p>}
      <p className="text-sm text-muted-foreground">
        {t("demandes.praticienne_demandee", { nom: praticienneDemandee(d, lang) })}
        {d.staff_nom && ` · ${t("demandes.praticienne_retenue", { nom: d.staff_nom })}`}
      </p>
      <p className="text-sm">
        {d.cliente_nom} · <span className="chiffres">{telephoneLisible(d.cliente_telephone)}</span> · {t(d.cliente_langue === "en" ? "demandes.langue.en" : "demandes.langue.fr")}
      </p>
      {d.note && <p className="text-sm text-muted-foreground">{d.note}</p>}
      <p className="text-sm">
        {d.client_id !== null && d.fiche !== "nouvelle"
          ? <button type="button" className="min-h-11 text-left underline underline-offset-4" onClick={() => openPanel("client", d.client_id!)}>{fiche}</button>
          : fiche}
      </p>
      {d.etat === "autre_horaire" && d.autre_date && d.autre_heure && (
        <p className="text-sm">{t("demandes.autre_propose", { horaire: `${formatLongDate(d.autre_date, lang)} · ${d.autre_heure}`, nom: d.autre_staff_nom ?? "" })}</p>
      )}
      {d.etat === "a_rappeler" && d.tentatives > 0 && <p className="text-sm text-muted-foreground">{tn("demandes.tentatives", d.tentatives)}</p>}
      {d.decision_attente && <p className="text-xs text-muted-foreground">{t("demandes.decision_attente")}</p>}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {actions.map((a) => (a === "appeler"
            ? tel && (
              <Button key={a} variant="outline" asChild>
                <a href={tel}><Phone className="h-4 w-4" aria-hidden="true" /> {t("demandes.action.appeler")}</a>
              </Button>
            )
            : <Button key={a} variant={a === "confirmer" || a === "rendez_vous" ? "default" : "outline"} onClick={() => agir(a)}>{t(`demandes.action.${a}` as Key)}</Button>))}
        </div>
      )}
    </li>
  );
}

/**
 * « Demandes en ligne » (spec du 16/10/2026 § 4.5), réception et gérante : de la plus ancienne à la plus
 * récente, filtre « À traiter / Toutes », une carte par demande avec ses actions ; rechargée à l'arrivée
 * d'une demande (signal temps réel).
 */
export function DemandesEnLigne() {
  const { t } = useI18n();
  const [filtre, setFiltre] = useState<Filtre>("a_traiter");
  const liste = useLoad(() => api<{ demandes: DemandeEnLigne[] }>("GET", `/api/demandes-en-ligne?filtre=${filtre}`), ["demandes"]);
  useEffect(() => { void liste.reload(); }, [filtre]); // eslint-disable-line react-hooks/exhaustive-deps
  const [ouverte, setOuverte] = useState<{ demande: DemandeEnLigne; action: ActionDialogue } | null>(null);
  const [fait, setFait] = useState<string | null>(null);
  const maintenant = useMaintenant();
  const demandes = liste.data?.demandes ?? [];
  return (
    <div className="hors-panneau @container mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl leading-tight">{t("demandes.titre")}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t("demandes.description")}</p>
      </header>
      <div role="group" aria-label={t("demandes.filtre")} className="flex gap-2">
        {(["a_traiter", "toutes"] as const).map((f) => (
          <Button key={f} size="sm" variant={filtre === f ? "default" : "outline"} aria-pressed={filtre === f} onClick={() => setFiltre(f)}>
            {t(`demandes.filtre.${f}` as Key)}
          </Button>
        ))}
      </div>
      <Succes message={fait} />
      {liste.error && !liste.data ? <EtatErreur message={liste.error} onRetry={() => void liste.reload()} />
        : !liste.data ? <EtatChargement />
        : demandes.length === 0 ? <EtatVide message={t(filtre === "a_traiter" ? "demandes.aucune" : "demandes.aucune_toutes")} />
        : (
          <ul className="flex flex-col gap-3">
            {demandes.map((d) => <Carte key={d.id} d={d} maintenant={maintenant} agir={(action) => { setFait(null); setOuverte({ demande: d, action }); }} />)}
          </ul>
        )}
      {ouverte && (
        <DialogueDemande
          demande={ouverte.demande}
          action={ouverte.action}
          onClose={() => setOuverte(null)}
          onDone={(m) => { setOuverte(null); setFait(m); void liste.reload(); }}
        />
      )}
    </div>
  );
}
