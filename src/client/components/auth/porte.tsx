import type { ComponentChildren } from "preact";
import { AuthContext } from "../../auth-context";
import { crmActiveOf } from "../../lib/crm";
import { marqueEtat } from "../../lib/marque";
import { MarqueContext } from "../../marque-context";
import { FormationContext } from "../../formation-context";
import { DemoContext } from "../../demo-context";
import { useAuthGate, type AuthGate } from "../../hooks/use-auth";
import { Connexion } from "./connexion";
import { Chargement, Injoignable, Maintenance } from "./etats";
import { Installation } from "./installation";
import { Poste } from "./poste";

/**
 * Affiche l'écran qui convient et ne monte l'app (`children`) qu'une fois la
 * session ouverte ; pose pour tous les écrans l'affichage de la marque lu dans
 * l'état public (réglage « marque.ecran »).
 */
export function Porte({ children }: { children: ComponentChildren }) {
  const gate = useAuthGate();
  const { state } = gate;
  // Base de formation (D-18) et démonstration publique (DP-03) : connues de chaque écran, ceux d'entrée compris.
  return (
    <FormationContext.Provider value={state?.formation === true}>
      <DemoContext.Provider value={state?.demo?.comptes ?? null}>
        <MarqueContext.Provider value={marqueEtat(state?.marque)}>{ecran(gate, children)}</MarqueContext.Provider>
      </DemoContext.Provider>
    </FormationContext.Provider>
  );
}

function ecran(gate: AuthGate, children: ComponentChildren) {
  const { state } = gate;
  switch (gate.screen) {
    case "chargement": return <Chargement />;
    case "injoignable": return <Injoignable onRetry={gate.reload} refus={gate.refus} />;
    case "maintenance": return <Maintenance />;
    case "installation": return <Installation onDone={gate.reload} />;
    case "poste": return <Poste device={state!.device!} onDone={gate.reload} onPassword={() => gate.setWantsPassword(true)} />;
    case "connexion": return <Connexion device={state!.device} onDone={gate.reload} onBackToPoste={() => gate.setWantsPassword(false)} />;
    case "app": return (
      <AuthContext.Provider
        key={state!.account!.id}
        value={{ account: state!.account!, device: state!.device, session: state!.session, crm: crmActiveOf(state), reload: gate.reload, logout: gate.logout }}
      >
        {children}
      </AuthContext.Provider>
    );
  }
}
