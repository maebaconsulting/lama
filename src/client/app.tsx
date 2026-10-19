import { embedded, reportLocation } from "@clawnify/app/client";
import { useEffect, useMemo, useState } from "preact/hooks";
import { AppContext } from "./context";
import { useAppState } from "./hooks/use-app";
import { useRouter } from "./hooks/use-router";
import { useAuth } from "./auth-context";
import { useFormation } from "./formation-context";
import { useI18n } from "./i18n/provider";
import { canSell, forbiddenSection, homePath, loadsActivity, mayOpen, settingsPanelAllowed } from "./lib/roles";
import { pathFor } from "./lib/routes";
import { defaultPrimaryAction, railFolded } from "./lib/cadre";
import { ConfirmationProvider } from "./components/auth/confirmation";
import { useIdleLock } from "./hooks/use-idle-lock";
import { useRealtime } from "./hooks/use-realtime";
import { useLarge, useWide } from "./hooks/use-wide";
import { NavigationIntegree } from "./components/cadre/navigation";
import { Rail } from "./components/cadre/rail";
import { EnTeteTelephone, OngletsTelephone } from "./components/cadre/telephone";
import { Panneau } from "./components/cadre/panneau";
import { BoutonPlus } from "./components/cadre/bouton-plus";
import { EtatChargement, EtatErreur } from "./components/comptoir";
import { Bandeaux } from "./components/bandeaux";
import { Dashboard } from "./components/dashboard";
import { CalendarView } from "./components/calendar-view";
import { AppointmentList } from "./components/appointment-list";
import { AppointmentDetail, clearNoteDrafts } from "./components/appointment-detail";
import { ClientList } from "./components/client-list";
import { FicheCliente } from "./components/fiches/fiche-cliente";
import { FicheMembre } from "./components/fiches/fiche-membre";
import { FichePrestation } from "./components/fiches/fiche-prestation";
import { FicheProduit } from "./components/fiches/fiche-produit";
import { StaffList } from "./components/staff-list";
import { ServiceList } from "./components/service-list";
import { ProductList } from "./components/product-list";
import { ErrorBanner } from "./components/error-banner";
import { Charte } from "./components/charte";
import { Reglages } from "./components/reglages/reglages";
import { FicheCompte } from "./components/reglages/fiche-compte";
import { FichePoste } from "./components/reglages/fiche-poste";
import { Vente } from "./components/caisse/vente";
import { FicheFacture } from "./components/caisse/fiche-facture";
import { CaisseJour } from "./components/caisse/caisse-jour";
import { DemandesEnLigne } from "./components/demandes/demandes-en-ligne";
import { cn } from "./lib/utils";
import { inertBehindPanel, panelView, type PanelError, type PanelView } from "./lib/panneau";
import type { ComponentChildren } from "preact";

export function App() {
  const { account, session, logout } = useAuth();
  const role = account.role;
  const formation = useFormation();
  // Place réservée en bas seulement pour les rôles qui ont un bouton « + » (jamais
  // l'administrateur) ; dépend du rôle, pas du prochain rendez-vous de la praticienne,
  // pour qu'aucun saut de mise en page n'arrive quand sa journée se termine.
  const hasPrimaryAction = defaultPrimaryAction(role) !== null;
  useIdleLock(session, logout);
  useRealtime();
  // Tablette partagée : verrouiller, se déconnecter ou la veille démontent l'app ;
  // les brouillons de note partent avec, la personne suivante ne les voit pas.
  useEffect(() => clearNoteDrafts, []);

  const isAgent = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has("agent") || params.get("mode") === "agent";
  }, []);

  useEffect(() => {
    if (isAgent) {
      document.documentElement.setAttribute("data-agent", "");
    }
  }, [isAgent]);

  const { lang, t } = useI18n();
  const { view, id, panel, navigate, replace, openPanel, closePanel } = useRouter(lang);
  // Pas de « + » flottant dans les Réglages (retouche 3) : il recouvrait les champs
  // de Mon compte ; la page et le bandeau d'erreur ne lui gardent plus de place.
  // Ni sur l'écran « Vente » (sous-projet 5) : il couvrirait le bas du ticket et la barre « Ticket » ;
  // ni sur « Caisse du jour » (vague 3), où il couvrirait le champ des espèces comptées au téléphone.
  const plusShown = hasPrimaryAction && view !== "reglages" && view !== "vente" && view !== "caisse";
  // Écran interdit pour ce rôle (lien ancien, adresse tapée) : retour à l'accueil du rôle.
  useEffect(() => {
    if (!mayOpen(role, view, id)) navigate(homePath(role));
  }, [role, view, id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Rubrique des Réglages interdite ou inconnue (report du sous-projet 3) : l'adresse est
  // corrigée en /reglages au lieu de rester affichée sur une autre rubrique.
  useEffect(() => {
    if (view === "reglages" && forbiddenSection(role, id, formation)) replace(pathFor("reglages", lang));
  }, [role, view, id, formation]); // eslint-disable-line react-hooks/exhaustive-deps
  const appState = useAppState(isAgent, navigate, role, openPanel, closePanel, panel);
  const panelKey = panel ? `${panel.kind}:${panel.id}` : "";
  useEffect(() => { reportLocation(window.location.pathname + window.location.search); }, [view, id, panelKey]);

  // Échec du chargement de l'élément du panneau (introuvable, réseau), rattaché à
  // l'élément demandé : montré dans le panneau de cet élément seulement.
  const [panelFailure, setPanelFailure] = useState<PanelError | null>(null);

  // Ouvre l'élément indiqué par l'adresse (rendez-vous, cliente). Cet effet s'exécute
  // dans le même cycle que la redirection ci-dessus : sans sa garde, l'administrateur
  // (ou un rôle sans droit sur l'écran) enverrait une requête d'activité avant d'être renvoyé.
  // Panneau fermé ou changé d'élément : la demande en cours est ignorée et l'ancienne
  // fiche n'est plus suivie en direct.
  useEffect(() => {
    setPanelFailure(null);
    if (!loadsActivity(role) || !mayOpen(role, view, id)) return;
    if (panel?.kind === "appointment") loadPanelItem(panel.kind, Number(panel.id));
    else appState.selectAppointment(null);
    if (panel?.kind === "client") loadPanelItem(panel.kind, Number(panel.id));
    else appState.selectClient(null);
    if (panel?.kind === "product") loadPanelItem(panel.kind, Number(panel.id));
    else appState.selectProduct(null);
  }, [view, panelKey, role]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Charge l'élément du panneau (ouverture et « Réessayer ») ; seul l'échec de la dernière demande arrive ici. */
  function loadPanelItem(kind: "appointment" | "client" | "product", itemId: number) {
    setPanelFailure(null);
    const load = kind === "appointment" ? appState.selectAppointment(itemId)
      : kind === "client" ? appState.selectClient(itemId)
      : appState.selectProduct(itemId);
    load.catch((err: Error) => setPanelFailure({ id: itemId, message: err.message }));
  }

  /** Panneau d'un élément : sa fiche une fois chargée, sinon l'erreur (avec « Réessayer ») ou le chargement. */
  const panneauDe = (titre: string, shown: PanelView, fiche: () => ComponentChildren, retry?: () => void) => (
    <Panneau titre={titre} onClose={closePanel}>
      {shown.kind === "fiche" ? fiche()
        : shown.kind === "erreur" ? <div className="p-4"><EtatErreur message={shown.message} onRetry={retry} /></div>
        : <EtatChargement />}
    </Panneau>
  );

  /**
   * Fiche tirée d'une liste déjà chargée en entier (équipe, prestations) :
   * trouvée, elle s'affiche ; liste encore en chargement, on attend ; sinon
   * la fiche n'existe plus (supprimée ailleurs, lien ancien).
   */
  const depuisListe = (found: boolean): PanelView =>
    found ? { kind: "fiche" } : appState.loading ? { kind: "chargement" } : { kind: "erreur", message: t("fiche.introuvable") };

  /** Panneau de détail (sous-projet 4 § 3.3) : un rendez-vous, une fiche de la vague 4, un compte ou un poste des Réglages. */
  const renderPanel = () => {
    if (!panel) return null;
    const itemId = Number(panel.id);
    // Fiches des Réglages (§ 7.1) : chacune lit sa liste, l'administrateur compris (sans activité).
    if (panel.kind === "account" || panel.kind === "device") {
      if (view !== "reglages" || !settingsPanelAllowed(role, panel.kind)) return null;
      return panel.kind === "account"
        ? <Panneau titre={t("panneau.compte")} onClose={closePanel}><FicheCompte key={itemId} id={itemId} /></Panneau>
        : <Panneau titre={t("panneau.poste")} onClose={closePanel}><FichePoste key={itemId} id={itemId} /></Panneau>;
    }
    if (!loadsActivity(role)) return null;
    switch (panel.kind) {
      case "appointment":
        return panneauDe(t("panneau.rendez_vous"), panelView(itemId, appState.selectedAppointment?.id, panelFailure),
          () => <AppointmentDetail key={itemId} />, () => loadPanelItem("appointment", itemId));
      case "client":
        return panneauDe(t("panneau.cliente"), panelView(itemId, appState.selectedClient?.id, panelFailure),
          () => <FicheCliente key={itemId} />, () => loadPanelItem("client", itemId));
      case "staff": {
        const staff = appState.staffMembers.find((s) => s.id === itemId);
        return panneauDe(t("panneau.membre"), depuisListe(Boolean(staff)), () => staff && <FicheMembre key={itemId} staff={staff} />);
      }
      case "service": {
        const service = appState.services.find((s) => s.id === itemId);
        return panneauDe(t("panneau.prestation"), depuisListe(Boolean(service)), () => service && <FichePrestation key={itemId} service={service} />);
      }
      case "product":
        return panneauDe(t("panneau.produit"), panelView(itemId, appState.selectedProduct?.id, panelFailure),
          () => <FicheProduit key={itemId} />, () => loadPanelItem("product", itemId));
      // Facture ou avoir (sous-projet 5 § 6.1) : la fiche se charge elle-même ; gérante et réception seulement.
      case "invoice":
        return canSell(role) ? <Panneau titre={t("panneau.facture")} onClose={closePanel}><FicheFacture key={itemId} id={itemId} /></Panneau> : null;
      default:
        return null;
    }
  };

  const renderMain = () => {
    switch (view) {
      case "calendar": return <CalendarView />;
      case "appointments": return <AppointmentList />;
      case "clients": return <ClientList />;
      case "staff": return <StaffList />;
      case "services": return <ServiceList />;
      case "products": return <ProductList />;
      case "charte": return <Charte />;
      case "reglages": return <Reglages section={id} />;
      // Une vente par rendez-vous : l'écran repart de zéro quand l'adresse change de rendez-vous.
      case "vente": return <Vente key={id ?? "comptoir"} appointmentId={id} />;
      case "caisse": return <CaisseJour />;
      case "demandes": return <DemandesEnLigne />;
      default: return mayOpen(role, "dashboard") ? <Dashboard /> : <Reglages section={null} />;
    }
  };

  // Panneau ouvert en colonne (1280 px et plus) : il touche le bord droit et porte lui-même la zone sûre de droite.
  const panneau = renderPanel();
  // Téléphone : le panneau couvre l'écran, tout ce qui est dessous devient inerte.
  const wide = useWide();
  const large = useLarge();
  const covered = inertBehindPanel(panneau !== null, wide);

  return (
    <AppContext.Provider value={appState}>
      <ConfirmationProvider>
        <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
          <div className="contents" inert={covered}>
            {embedded ? <NavigationIntegree currentView={view} /> : <><Rail currentView={view} folded={railFolded(panneau !== null, large)} /><EnTeteTelephone /></>}
          </div>
          {/* Sur téléphone, la barre d'onglets et le « + » flottent en bas : la page garde leur place pour ne rien masquer. À partir de 768 px, le rail absorbe l'encoche de gauche. */}
          {/* La page /charte reste claire jusqu'aux bords (marges des zones sûres et des onglets comprises). */}
          <main inert={covered} className={cn(
            "min-h-0 min-w-0 flex-1 overflow-auto bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]",
            !embedded && (plusShown
              ? "pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-0 md:pl-0"
              : "pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0 md:pl-0"),
            panneau && "panneau-ouvert xl:pr-0",
            // Écran « Vente » : il prend la hauteur laissée par les bandeaux, le bouton « Encaisser » et la barre « Ticket » restent en vue.
            view === "vente" && "flex flex-col",
          )} data-theme={view === "charte" ? "light" : undefined}>
            <Bandeaux />
            {appState.loading ? (
              <div className="flex h-full items-center justify-center"><EtatChargement /></div>
            ) : (
              renderMain()
            )}
          </main>
          {panneau}
          <div className="contents" inert={covered}>
            {!embedded && <OngletsTelephone currentView={view} />}
            {!embedded && plusShown && <BoutonPlus agendaDay={view === "calendar" ? appState.calendarDate : undefined} />}
          </div>
        </div>
        <ErrorBanner withPlus={plusShown} />
      </ConfirmationProvider>
    </AppContext.Provider>
  );
}
