import { useEffect, useRef, useState } from "preact/hooks";
import { Phone } from "lucide-preact";
import { useApp } from "../context";
import { useAuth, useCrm } from "../auth-context";
import { useI18n } from "@/i18n/provider";
import { fold } from "@/lib/bilingual";
import { crmTags, listTagFilter, tagFromSearch } from "@/lib/crm";
import { clientCommands, isOpen, telHref } from "@/lib/fiches";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Client, TagCount } from "../types";
import { EtatVide } from "./comptoir";
import { BoutonCampagne } from "./campagnes/fenetre-campagne";
import { CreateClient } from "./create-client";
import { PucesEtiquettes } from "./fiches/etiquettes";
import { LigneFiche, ListeFiches, PageFiches } from "./fiches/liste-fiches";
import { Pagination } from "./pagination";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Lien d'appel d'une cliente, hors du bouton de la ligne : numéro visible, 44 px de haut. */
export function LienAppel({ client }: { client: Pick<Client, "name" | "phone"> }) {
  const { t } = useI18n();
  const href = telHref(client.phone);
  if (!href) return null;
  return (
    <a href={href} aria-label={t("cliente.appeler", { nom: client.name, numero: client.phone })} className={`flex min-h-11 items-center gap-2 rounded-sm px-2 text-sm underline decoration-filet underline-offset-4 hover:decoration-foreground ${FOCUS}`}>
      <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="chiffres-tabulaires">{client.phone}</span>
    </a>
  );
}

/**
 * Puces du filtre par étiquette (mini CRM, décision 10) : « Toutes », puis
 * les étiquettes les plus portées d'abord ; défilement horizontal tant que la
 * liste est étroite, sur plusieurs lignes au-delà. Toucher l'étiquette
 * choisie la retire. Une étiquette de l'adresse que plus personne ne porte
 * reste affichée, choisie, pour pouvoir la retirer.
 */
function FiltreEtiquettes({ tags, current, onChange }: { tags: TagCount[]; current: string; onChange: (tag: string) => void }) {
  const { t } = useI18n();
  const known = tags.some((x) => fold(x.tag) === fold(current));
  const list = current && !known ? [{ tag: current, count: 0 }, ...tags] : tags;
  const chip = (active: boolean) => cn(
    "inline-flex min-h-11 shrink-0 items-center rounded-sm border px-3 text-sm transition-colors duration-200",
    active ? "border-primary bg-primary text-primary-foreground" : "border-filet bg-card hover:bg-muted",
    FOCUS,
  );
  return (
    <div role="group" aria-label={t("crm.filtre_etiquettes")} className="flex gap-2 overflow-x-auto pb-1 @xl:flex-wrap @xl:overflow-visible">
      <button type="button" aria-pressed={current === ""} onClick={() => onChange("")} className={chip(current === "")}>{t("crm.toutes")}</button>
      {list.map((x) => {
        const active = current !== "" && fold(x.tag) === fold(current);
        return (
          <button key={x.tag} type="button" aria-pressed={active} onClick={() => onChange(active ? "" : x.tag)} className={chip(active)}>
            {x.tag}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Clientes (sous-projet 4 § 6, mini CRM § 1) : recherche en haut (sans
 * accents ni majuscules, étiquettes comprises, côté serveur), puces du filtre
 * par étiquette dessous, « Nouvelle cliente » pour la réception et la
 * gérante ; chaque cliente en carte (nom, téléphone à appeler, dernière
 * visite, nombre de visites, étiquettes), sa fiche dans le panneau.
 * Mini CRM désactivé (interrupteur général) : ni puces, ni étiquettes sur
 * les lignes, ni « Écrire à ces clientes » ; le filtre de l'adresse est ignoré.
 */
export function ClientList() {
  const { clients, clientsPag, setClientsPage, clientsSearch, setClientsSearch, clientsTag, setClientsTag, clientTags, openPanel, panel } = useApp();
  const { account } = useAuth();
  const { t, tn, lang } = useI18n();
  const commands = clientCommands(account.role);
  const crm = useCrm();
  const [creating, setCreating] = useState(false);
  // L'adresse fait foi en arrivant sur la liste (lien partagé, menu, « Précédent ») : son étiquette est reprise.
  // Relu à l'entrée dans la vue (menu : adresse sans ?etiquette=, filtre vidé) et sur « Précédent » ;
  // seul un écart change l'étiquette, donc un seul chargement de la liste.
  const tagRef = useRef(clientsTag);
  tagRef.current = clientsTag;
  useEffect(() => {
    const sync = () => {
      const fromUrl = tagFromSearch(window.location.search);
      if (fromUrl !== tagRef.current) setClientsTag(fromUrl);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const filtering = listTagFilter(clientsTag, crm) !== "";

  return (
    <PageFiches
      titre={t("menu.clientes")}
      action={commands.create ? { libelle: t("cliente.ajouter"), onClick: () => setCreating(true) } : null}
      recherche={{ valeur: clientsSearch, onInput: setClientsSearch, placeholder: t("cliente.rechercher") }}
      filtres={
        crm && (clientTags.length > 0 || filtering) ? (
          <div className="flex flex-col gap-3">
            <FiltreEtiquettes tags={clientTags} current={clientsTag} onChange={setClientsTag} />
            <div><BoutonCampagne tag={clientsTag} /></div>
          </div>
        ) : null
      }
    >
      {clients.length === 0 ? (
        <EtatVide
          message={filtering ? t("crm.aucune_etiquette_filtre", { etiquette: clientsTag }) : clientsSearch ? t("cliente.aucune") : t("cliente.aucune_encore")}
          action={filtering
            ? { libelle: t("crm.voir_toutes"), onClick: () => setClientsTag("") }
            : commands.create && !clientsSearch ? { libelle: t("cliente.ajouter"), onClick: () => setCreating(true) } : undefined}
        />
      ) : (
        <ListeFiches libelle={t("menu.clientes")}>
          {clients.map((c) => (
            <LigneFiche
              key={c.id}
              titre={c.name}
              detail={c.last_visit ? t("cliente.derniere_visite", { date: formatShortDate(c.last_visit, lang) }) : t("cliente.jamais_venue")}
              secondaire={crmTags(c.tags, crm).length > 0 ? <PucesEtiquettes tags={crmTags(c.tags, crm)} max={2} /> : undefined}
              fin={<span className="text-muted-foreground">{tn("cliente.nb_visites", c.visit_count ?? 0)}</span>}
              actif={isOpen(panel, "client", c.id)}
              onOpen={() => openPanel("client", c.id)}
              apres={<LienAppel client={c} />}
            />
          ))}
        </ListeFiches>
      )}
      <Pagination pag={clientsPag} setPage={setClientsPage} />
      {creating && <CreateClient onClose={() => setCreating(false)} />}
    </PageFiches>
  );
}
