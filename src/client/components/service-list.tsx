import { useState } from "preact/hooks";
import { useApp } from "../context";
import { useAuth } from "../auth-context";
import { useI18n } from "@/i18n/provider";
import { matchesSearch, pickText } from "@/lib/bilingual";
import { catalogCommands, isOpen } from "@/lib/fiches";
import { formatPrice } from "@/lib/format";
import { byCategory } from "@/lib/prestations";
import { EtatVide, Montant } from "./comptoir";
import { CreateService } from "./create-service";
import { PastilleEncre } from "./fiches/corps-fiche";
import { LigneFiche, ListeFiches, PageFiches } from "./fiches/liste-fiches";

/**
 * Prestations (sous-projet 4 § 6) : regroupées par catégorie (`byCategory`,
 * inactives gardées à leur place, grisées) ; chaque prestation en carte (nom,
 * durée, prix), sa fiche dans le panneau. Recherche sur le nom français et le
 * nom anglais, sans accents ; « Nouvelle prestation » pour la gérante.
 */
export function ServiceList() {
  const { services, openPanel, panel } = useApp();
  const { account } = useAuth();
  const { t, lang } = useI18n();
  const commands = catalogCommands(account.role);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const shown = services.filter((s) => matchesSearch(search, s.name, s.name_en));
  const groups = byCategory(shown, lang, { withInactive: true });

  return (
    <PageFiches
      titre={t("menu.prestations")}
      action={commands.manage ? { libelle: t("prestation.ajouter"), onClick: () => setCreating(true) } : null}
      recherche={{ valeur: search, onInput: setSearch, placeholder: t("prestation.rechercher") }}
    >
      {groups.length === 0 ? (
        <EtatVide
          message={services.length === 0 ? t("prestation.aucune") : t("prestation.aucune_trouvee")}
          action={commands.manage && !search ? { libelle: t("prestation.ajouter"), onClick: () => setCreating(true) } : undefined}
        />
      ) : (
        <div className="space-y-5">
          {groups.map((group) => {
            const titre = group.category || t("prestation.sans_categorie");
            return (
              <section key={titre} className="space-y-2">
                <h2 className="etiquette text-encre-grise">{titre}</h2>
                <ListeFiches libelle={titre}>
                  {group.services.map((svc) => (
                    <LigneFiche
                      key={svc.id}
                      titre={pickText(lang, svc.name, svc.name_en)}
                      pastille={<PastilleEncre color={svc.color} />}
                      detail={svc.active ? t("commun.minutes", { min: svc.duration }) : `${t("commun.minutes", { min: svc.duration })} · ${t("prestation.inactive")}`}
                      fin={<span className="chiffres whitespace-nowrap font-medium"><Montant valeur={formatPrice(svc.price, lang)} /></span>}
                      attenue={!svc.active}
                      actif={isOpen(panel, "service", svc.id)}
                      onOpen={() => openPanel("service", svc.id)}
                    />
                  ))}
                </ListeFiches>
              </section>
            );
          })}
        </div>
      )}
      {creating && <CreateService onClose={() => setCreating(false)} />}
    </PageFiches>
  );
}
