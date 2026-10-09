import { useI18n } from "@/i18n/provider";
import { LANGS, type Lang } from "@/i18n/translate";
import { cn } from "@/lib/utils";

/**
 * Bouton FR / EN, discret, sur fond cuir (rail, « Plus », écrans d'entrée).
 * Sans `onChange`, il change la langue de l'appareil (avant la connexion) ;
 * avec `onChange`, il l'enregistre aussi pour le compte et revient à
 * l'ancienne langue si l'enregistrement échoue. `vertical` empile FR et EN
 * (rail replié de 64 px).
 */
export function LangSwitch({ onChange, onError, className, vertical = false }: {
  onChange?: (lang: Lang) => Promise<void>;
  onError?: (message: string) => void;
  className?: string;
  vertical?: boolean;
}) {
  const { lang, setLang, t } = useI18n();

  const choose = (next: Lang) => {
    if (next === lang) return;
    const previous = lang;
    setLang(next);
    onChange?.(next).catch(() => {
      setLang(previous);
      onError?.(t("langue.echec"));
    });
  };

  return (
    <div role="group" aria-label={t("langue.choix")} className={cn("inline-flex rounded-sm border border-sidebar-border p-0.5", vertical && "flex-col", className)}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={lang === code}
          aria-label={t(code === "fr" ? "langue.passer.fr" : "langue.passer.en")}
          onClick={() => choose(code)}
          className={cn(
            "etiquette min-h-11 min-w-11 rounded-sm px-2 transition-colors duration-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring",
            lang === code ? "bg-sidebar-accent text-sidebar-foreground" : "text-sidebar-foreground/60 hover:text-sidebar-foreground",
          )}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
