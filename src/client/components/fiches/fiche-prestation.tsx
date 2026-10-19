import { useState } from "preact/hooks";
import { useApp } from "../../context";
import { useAuth } from "../../auth-context";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { pickText } from "@/lib/bilingual";
import { catalogCommands } from "@/lib/fiches";
import { EMPTY, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Service } from "../../types";
import { Montant } from "../comptoir";
import { CreateService } from "../create-service";
import { Erreur } from "../champ";
import { ListeSupplements, RecopierSupplements, useProduits } from "../supplements/liste-prestation";
import { ACTION, EnTeteFiche, LigneDetail, PastilleEncre, SuppressionFiche } from "./corps-fiche";

const FOCUS = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Bascule « Active » en grand (§ 6) : un interrupteur (`role="switch"`) de
 * 48 px sur toute la largeur, le mot écrit à côté, inactif pendant
 * l'enregistrement (double appui).
 */
function BasculeActive({ active, disabled, onToggle }: { active: boolean; disabled: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={disabled}
      onClick={onToggle}
      className={cn("flex min-h-12 w-full items-center justify-between gap-4 rounded-sm border border-filet bg-card px-4 py-3 text-left transition-colors duration-200 hover:bg-muted disabled:opacity-60", FOCUS)}
    >
      <span className="space-y-0.5">
        <span className="block font-medium">{active ? t("prestation.active") : t("prestation.inactive")}</span>
        <span className="block text-sm text-muted-foreground">{active ? t("prestation.active_aide") : t("prestation.inactive_aide")}</span>
      </span>
      <span className={cn("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-200", active ? "border-primary bg-primary" : "border-filet bg-muted")} aria-hidden="true">
        <span className={cn("absolute h-5 w-5 rounded-full transition-transform duration-200", active ? "translate-x-6 bg-primary-foreground" : "translate-x-1 bg-encre-grise")} />
      </span>
    </button>
  );
}

/**
 * Fiche d'une prestation dans le panneau (sous-projet 4 § 6) : nom,
 * description, catégorie, durée, prix et couleur, dans la langue de l'écran
 * avec la version anglaise à côté ; pour la gérante : la bascule « Active »
 * en grand, Modifier, et Supprimer (refusé par le serveur si la prestation
 * figure dans des rendez-vous : la désactiver plutôt).
 */
export function FichePrestation({ service }: { service: Service }) {
  const { updateService, deleteService, setError, services } = useApp();
  const { account } = useAuth();
  const { t, lang } = useI18n();
  const commands = catalogCommands(account.role);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [liste, setListe] = useState(false);
  const [recopie, setRecopie] = useState(false);
  const refs = service.supplements ?? [];
  // Les produits ne sont demandés que si la liste en contient un (pour les nommer) ; le dialogue charge les siens.
  const charge = useProduits(refs.some((r) => r.kind === "product"));
  const nomRef = (kind: "service" | "product", id: number) => {
    const item = kind === "service" ? services.find((s) => s.id === id) : charge.connus.get(id);
    // Les produits sont chargés par page (ou pas encore) : un produit absent n'est pas forcément retiré.
    if (kind === "product") return item ? pickText(lang, item.name, item.name_en) : t("prestation.produit_numero", { id });
    return item ? pickText(lang, item.name, item.name_en) : t("caisse.article_retire");
  };
  const name = pickText(lang, service.name, service.name_en);
  const description = pickText(lang, service.description, service.description_en);
  const category = pickText(lang, service.category, service.category_en);
  // Version dans l'autre langue, montrée seulement si elle existe et diffère.
  const other = lang === "fr" ? service.name_en : service.name;

  const toggle = async () => {
    setSaving(true);
    try {
      await updateService(service.id, { active: service.active ? 0 : 1 });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 p-4">
      <EnTeteFiche titre={name} pastille={<PastilleEncre color={service.color} grande />} sousTitre={other && other !== name ? other : undefined} />

      {commands.manage && (
        <div className="space-y-2">
          <BasculeActive active={Boolean(service.active)} disabled={saving} onToggle={toggle} />
          <Button variant="outline" className={cn(ACTION, "w-full")} onClick={() => setEditing(true)}>{t("commun.modifier")}</Button>
        </div>
      )}

      <dl className="grid gap-4 border-t border-filet pt-4 @md:grid-cols-2">
        <LigneDetail libelle={t("colonne.duree")}>{t("commun.minutes", { min: service.duration })}</LigneDetail>
        <LigneDetail libelle={t("colonne.prix")}><span className="chiffres text-lg font-medium"><Montant valeur={formatPrice(service.price, lang)} /></span></LigneDetail>
        <LigneDetail libelle={t("colonne.categorie")}>{category || t("prestation.sans_categorie")}</LigneDetail>
        <LigneDetail libelle={t("prestation.en_ligne")}>{service.en_ligne ? t("commun.oui") : t("commun.non")}</LigneDetail>
        <LigneDetail libelle={t("prestation.supplement_seulement")}>{service.supplement_seulement ? t("commun.oui") : t("commun.non")}</LigneDetail>
        {!commands.manage && <LigneDetail libelle={t("colonne.statut")}>{service.active ? t("prestation.active") : t("prestation.inactive")}</LigneDetail>}
        <div className="@md:col-span-2">
          <LigneDetail libelle={t("prestation.description")}><span className="whitespace-pre-line">{description || EMPTY}</span></LigneDetail>
        </div>
        <div className="@md:col-span-2">
          <LigneDetail libelle={t("prestation.supplements_possibles")}>
            {refs.length === 0 ? EMPTY : (
              <ol className="space-y-0.5">
                {refs.map((r) => <li key={`${r.kind}${r.ref_id}`}>{nomRef(r.kind, r.ref_id)}</li>)}
              </ol>
            )}
            <Erreur message={charge.error} />
          </LigneDetail>
        </div>
      </dl>

      {commands.manage && (
        <div className="flex flex-wrap gap-2">
          {!service.supplement_seulement && <Button variant="outline" className={ACTION} onClick={() => setListe(true)}>{t("prestation.modifier_supplements")}</Button>}
          {refs.length > 0 && <Button variant="outline" className={ACTION} onClick={() => setRecopie(true)}>{t("prestation.recopier")}</Button>}
        </div>
      )}

      {commands.manage && (
        <SuppressionFiche
          question={t("prestation.supprimer_question", { nom: name })}
          bloquee={(service.appointment_count ?? 0) > 0 ? t("prestation.suppression_impossible") : null}
          onDelete={() => deleteService(service.id)}
        />
      )}

      {editing && <CreateService key={service.id} service={service} onClose={() => setEditing(false)} />}
      {liste && <ListeSupplements service={service} onClose={() => setListe(false)} />}
      {recopie && <RecopierSupplements service={service} onClose={() => setRecopie(false)} />}
    </div>
  );
}
