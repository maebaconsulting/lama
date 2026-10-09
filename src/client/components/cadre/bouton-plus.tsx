import { useState } from "preact/hooks";
import { Plus } from "lucide-preact";
import { useApp } from "../../context";
import { useAuth } from "../../auth-context";
import { useI18n } from "@/i18n/provider";
import { defaultPrimaryAction, nextAppointment, plusWatchesStaff } from "@/lib/cadre";
import { CreateAppointment } from "@/components/create-appointment";
import { useWide } from "../../hooks/use-wide";
import { useCalendarRange, useDoualaClock } from "../../hooks/use-journee";
import type { Appointment } from "../../types";

/**
 * Prochain rendez-vous de la praticienne reliée à `staffId`, aujourd'hui à
 * Douala ; rechargé à chaque signal de l'agenda, au changement de jour, et
 * recalculé chaque minute (`use-journee.ts`, partagé avec l'accueil).
 */
function useProchainRendezVous(staffId: number | null): Appointment | null {
  const clock = useDoualaClock();
  const { appointments } = useCalendarRange(staffId === null ? null : { start: clock.day, end: clock.day });
  return nextAppointment(appointments, staffId, clock.day, clock.time);
}

/**
 * Bouton rond « + » du téléphone (sous-projet 4 § 3.3) : l'action principale,
 * selon le rôle. Réception et gérante : nouveau rendez-vous. Praticienne : la
 * fiche de son prochain rendez-vous dans le panneau, pour y ajouter une note
 * (absent s'il n'y en a plus aujourd'hui). Administrateur : aucun.
 */
export function BoutonPlus({ agendaDay }: { agendaDay?: string }) {
  const { account } = useAuth();
  const { openPanel } = useApp();
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const action = defaultPrimaryAction(account.role);
  // Masqué à partir de 768 px : aucune requête de l'agenda pour rien.
  const wide = useWide();
  const next = useProchainRendezVous(plusWatchesStaff(action, account.staff_id, wide));

  if (action === null || (action === "note-prochain-rdv" && !next)) return null;
  const label = action === "nouveau-rdv" ? t("agenda.nouveau_rdv") : t("cadre.note_prochain_rdv");
  const run = () => {
    if (action === "nouveau-rdv") setCreating(true);
    else if (next) openPanel("appointment", next.id);
  };

  return (
    <>
      <button
        type="button"
        aria-label={label}
        onClick={run}
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors duration-200 hover:bg-primary/85 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring md:hidden"
      >
        <Plus className="h-6 w-6" aria-hidden="true" />
      </button>
      {creating && <CreateAppointment defaultDate={agendaDay} onClose={() => setCreating(false)} />}
    </>
  );
}
