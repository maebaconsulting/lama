import { useAuth } from "../auth-context";
import { Aujourdhui } from "./accueil/aujourdhui";
import { MaJournee } from "./accueil/ma-journee";

/**
 * Accueil selon le rôle (sous-projet 4 § 5) : « Ma journée » pour la
 * praticienne, « Aujourd'hui » pour la réception et la gérante (la gérante y
 * voit aussi sa semaine). L'administrateur n'arrive jamais ici : son accueil
 * est Réglages (`homePath`).
 */
export function Dashboard() {
  const { account } = useAuth();
  return account.role === "practitioner" ? <MaJournee /> : <Aujourdhui />;
}
