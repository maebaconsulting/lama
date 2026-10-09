import type { CompteDemo } from "../../lib/auth-types";
import { useDemo } from "../../demo-context";
import { ROLE_KEYS } from "../../lib/roles";
import { useI18n } from "@/i18n/provider";

/**
 * Comptes publics de la démonstration (démo publique DP-03) : rôle,
 * identifiant, mot de passe et code PIN, jamais l'administration. Avec
 * `onChoisir`, toucher un compte remplit le formulaire de connexion. Les
 * identifiants restent hors du bouton, en texte sélectionnable : on peut les
 * copier ; un clic sans sélection remplit aussi le formulaire. Rien hors
 * démonstration publique.
 */
export function ComptesDemo({ onChoisir }: { onChoisir?: (compte: CompteDemo) => void }) {
  const comptes = useDemo();
  const { t } = useI18n();
  if (!comptes) return null;
  return (
    <section aria-labelledby="comptes-demo-titre" className="mt-6 border-t border-filet pt-4">
      <h2 id="comptes-demo-titre" className="text-sm font-medium">{t("demo.comptes.titre")}</h2>
      {onChoisir && <p className="mt-1 text-xs text-encre-grise">{t("demo.comptes.aide")}</p>}
      <ul className="mt-3 grid gap-2">
        {comptes.map((compte) => {
          const ligneId = `compte-demo-${compte.login}`;
          const ligne = t("demo.comptes.ligne", { login: compte.login, mot_de_passe: compte.mot_de_passe, pin: compte.pin });
          return (
            <li key={compte.login} className="flex flex-col rounded-sm border border-filet text-sm">
              {onChoisir ? (
                <>
                  <button
                    type="button"
                    aria-describedby={ligneId}
                    className="flex min-h-11 w-full items-center rounded-sm px-3 pt-2 text-left font-medium transition-colors duration-200 hover:bg-muted focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    onClick={() => onChoisir(compte)}
                  >
                    {t(ROLE_KEYS[compte.role])}
                  </button>
                  {/* Hors du bouton : sélectionnable et copiable ; un clic sans sélection remplit le formulaire comme le bouton. */}
                  <p id={ligneId} className="cursor-text select-text px-3 pb-2 text-encre-grise" onClick={() => { if (!window.getSelection()?.toString()) onChoisir(compte); }}>
                    {ligne}
                  </p>
                </>
              ) : (
                <div className="flex flex-col px-3 py-2">
                  <span className="font-medium">{t(ROLE_KEYS[compte.role])}</span>
                  <span className="select-text text-encre-grise">{ligne}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
