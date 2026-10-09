import { useState } from "preact/hooks";
import { useApp } from "../context";
import { useAuth } from "../auth-context";
import { useI18n } from "@/i18n/provider";
import { pickText } from "@/lib/bilingual";
import { catalogCommands, isOpen } from "@/lib/fiches";
import { EtatVide } from "./comptoir";
import { CreateStaff } from "./create-staff";
import { PastilleEncre } from "./fiches/corps-fiche";
import { LigneFiche, ListeFiches, PageFiches } from "./fiches/liste-fiches";

/**
 * Équipe (sous-projet 4 § 6) : chaque membre en carte (couleur, nom,
 * fonction, état), sa fiche dans le panneau ; « Nouveau membre » pour la
 * gérante seulement. Les fiches désactivées restent en fin de liste, grisées.
 */
export function StaffList() {
  const { staffMembers, openPanel, panel } = useApp();
  const { account } = useAuth();
  const { t, lang } = useI18n();
  const commands = catalogCommands(account.role);
  const [creating, setCreating] = useState(false);
  const shown = [...staffMembers].sort((a, b) => Number(b.active) - Number(a.active));

  return (
    <PageFiches titre={t("menu.equipe")} action={commands.manage ? { libelle: t("equipe.ajouter"), onClick: () => setCreating(true) } : null}>
      {shown.length === 0 ? (
        <EtatVide message={t("equipe.aucun")} action={commands.manage ? { libelle: t("equipe.ajouter"), onClick: () => setCreating(true) } : undefined} />
      ) : (
        <ListeFiches libelle={t("menu.equipe")}>
          {shown.map((s) => (
            <LigneFiche
              key={s.id}
              titre={s.name}
              pastille={<PastilleEncre color={s.color} />}
              detail={pickText(lang, s.title, s.title_en) || undefined}
              fin={!s.active ? <span className="etiquette text-encre-grise">{t("equipe.desactivee")}</span> : undefined}
              attenue={!s.active}
              actif={isOpen(panel, "staff", s.id)}
              onOpen={() => openPanel("staff", s.id)}
            />
          ))}
        </ListeFiches>
      )}
      {creating && <CreateStaff onClose={() => setCreating(false)} />}
    </PageFiches>
  );
}
