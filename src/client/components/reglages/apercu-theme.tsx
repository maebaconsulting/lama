import { useI18n } from "@/i18n/provider";
import { POLICES_APERCU } from "@/lib/reglages-en-ligne";
import { palette, type ThemeEnLigne } from "../../../shared/en-ligne";

/** Aperçu de la page de réservation aux couleurs choisies : couleurs exactes (même palette que le relais), polices approchées. */
export function ApercuTheme({ theme, nom }: { theme: ThemeEnLigne; nom: string }) {
  const { t } = useI18n();
  const p = palette(theme);
  const polices = POLICES_APERCU[theme.police];
  return (
    <figure className="max-w-sm space-y-2">
      <div className="rounded-sm border border-filet p-4" style={{ background: p.fond, color: p.texte, fontFamily: polices.courant }} aria-hidden="true">
        <p style={{ fontFamily: polices.grands, fontSize: "1.5rem", letterSpacing: "0.06em", lineHeight: 1.1 }}>{nom || t("en_ligne.apercu.nom")}</p>
        <p style={{ color: p.grise, fontSize: "0.8rem" }}>{t("en_ligne.apercu.sous_titre")}</p>
        <div className="mt-3 rounded-sm px-3 py-2" style={{ background: p.papier, border: `1px solid ${p.filet}` }}>
          <p style={{ fontWeight: 500 }}>{t("en_ligne.apercu.prestation")}</p>
          <p style={{ color: p.grise, fontSize: "0.8rem" }}>{t("en_ligne.apercu.detail")}</p>
        </div>
        <p className="mt-3 rounded-sm px-3 py-2 text-center" style={{ background: p.accent, color: p.surAccent, fontWeight: 500 }}>{t("en_ligne.apercu.bouton")}</p>
      </div>
      <figcaption className="text-xs text-muted-foreground">{t("en_ligne.apercu.legende")}</figcaption>
    </figure>
  );
}
