import { render } from "preact";
import "@fontsource/cormorant-garamond/latin-300.css";
import "@fontsource/eb-garamond/400.css";
import "@fontsource/eb-garamond/400-italic.css";
import "@fontsource/eb-garamond/500.css";
import "@fontsource/jost/300.css";
import "@fontsource/jost/400.css";
import "@fontsource/jost/500.css";
import { App } from "./app";
import { Porte } from "./components/auth/porte";
import { readDeviceTheme } from "./i18n/device-lang";
import { I18nProvider } from "./i18n/provider";
import { applyTheme, ThemeProvider } from "./theme-provider";
import { enregistrerServiceWorker } from "./lib/mise-a-jour";
import { capterInstallation } from "./lib/installation";
import "./styles.css";

// Thème retenu par l'appareil posé avant le premier rendu : aucun éclair du mauvais thème (sous-projet 4 § 3.2).
applyTheme(readDeviceTheme());

// Invitation à installer (PWA, P-06) : captée avant le premier rendu, le navigateur peut l'envoyer très tôt.
capterInstallation(window);

// Service worker (PWA, P-03) : https ou localhost seulement, jamais sous le serveur de développement de Vite.
// Une nouvelle version est cherchée au retour sur l'écran et toutes les 30 minutes.
void enregistrerServiceWorker({
  conteneur: navigator.serviceWorker,
  securise: window.isSecureContext,
  dev: import.meta.env.DEV,
  recharger: () => location.reload(),
}).then((inscription) => {
  if (!inscription) return;
  const chercher = () => { inscription.update().catch(() => undefined); };
  setInterval(chercher, 30 * 60_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") chercher(); });
}, () => undefined);

render(<I18nProvider><ThemeProvider><Porte><App /></Porte></ThemeProvider></I18nProvider>, document.getElementById("app")!);
