import { useEffect, useState } from "preact/hooks";
import { api, ApiError } from "../../api";
import type { Device, Role } from "../../lib/auth-types";
import { PAD_KEYS, pinSlots, press } from "../../lib/pin-pad";
import { ROLE_KEYS } from "../../lib/roles";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Erreur } from "../champ";
import { EtatErreur } from "../comptoir";
import { Couverture } from "./couverture";
import { ComptesDemo } from "./comptes-demo";

type Membre = { id: number; display_name: string; role: Role; locked: boolean };

/** Poste partagé : on touche son nom, on tape son PIN (spec 2 § 3.3) ; l'écran passe ensuite à la langue de la personne. */
export function Poste({ device, onDone, onPassword }: { device: Device; onDone: () => Promise<void>; onPassword: () => void }) {
  const { t, tn } = useI18n();
  const [membres, setMembres] = useState<Membre[] | null>(null);
  const [choisi, setChoisi] = useState<Membre | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);

  // Équipe du poste, relue aussi au retour sur les cartes : un compte bloqué entre-temps y apparaît (V1-07).
  const charger = () => {
    setLoadError(null);
    api<{ accounts: Membre[] }>("GET", "/api/auth/roster").then(
      (r) => setMembres(r.accounts),
      (err) => {
        // Poste révoqué entre-temps : l'état relu renverra vers la connexion.
        if (err instanceof ApiError && err.code === "poste_inconnu") void onDone();
        else setLoadError((err as Error).message);
      },
    );
  };
  useEffect(charger, []); // eslint-disable-line react-hooks/exhaustive-deps

  const envoyer = async (value: string) => {
    if (!choisi) return;
    setPending(true);
    setError(null);
    try {
      await api("POST", "/api/auth/pin", { account_id: choisi.id, pin: value });
      setPin("");
      await onDone();
    } catch (err) {
      setPin("");
      // PIN refusé (401) : message propre au pavé, pas celui de la connexion par mot de passe (retouche 6).
      setError(err instanceof ApiError && err.status === 401 ? t("poste.pin_incorrect") : (err as Error).message);
      setPending(false);
    }
  };

  const touche = (key: string) => {
    if (pending) return;
    const next = press(pin, key);
    setPin(next.value);
    if (next.submit) void envoyer(next.value);
  };

  useEffect(() => {
    if (!choisi) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) touche(e.key);
      else if (e.key === "Backspace") touche("effacer");
      else if (e.key === "Enter") touche("valider");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!choisi) {
    return (
      <Couverture titre={t("poste.qui")} sousTitre={device.name} large>
        {membres === null && !loadError && <p className="text-sm text-encre-grise">{t("poste.chargement")}</p>}
        {loadError && <EtatErreur message={loadError} onRetry={charger} />}
        {membres?.length === 0 && <p className="text-sm text-encre-grise">{t("poste.aucun_pin")}</p>}
        {/* Une carte par personne (§ 7.2) : initiale, nom en grand, rôle ; toute la carte se touche. */}
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {membres?.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                aria-disabled={m.locked ? "true" : undefined}
                className={cn("flex min-h-16 w-full items-center gap-3 rounded-sm border border-filet bg-card p-3 text-left transition-colors duration-200 hover:bg-muted focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring", m.locked && "cursor-not-allowed opacity-60")}
                onClick={() => { if (m.locked) return; setChoisi(m); setError(null); }}
              >
                <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-filet font-serif text-xl">
                  {m.display_name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-serif text-lg leading-tight">{m.display_name}</span>
                  <span className="etiquette text-encre-grise">{t(ROLE_KEYS[m.role])}</span>
                  {m.locked && <span className="etiquette text-encre-rouge">{t("poste.bloque")}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Erreur message={error} />
        <Button variant="link" className="mt-4 w-full" onClick={onPassword}>{t("poste.par_mot_de_passe")}</Button>
        {/* Démonstration publique (DP-03) : codes PIN des comptes publics. */}
        <ComptesDemo />
      </Couverture>
    );
  }

  return (
    <Couverture titre={choisi.display_name} sousTitre={t("poste.tapez_pin")}>
      {/* Cases du PIN : quatre au moins, pleines au fil des chiffres ; le nombre est annoncé aux lecteurs d'écran. */}
      <p aria-live="polite" className="flex h-8 items-center justify-center gap-3">
        <span className="sr-only">{tn("poste.chiffres", pin.length)}</span>
        {pinSlots(pin.length).map((plein, i) => (
          <span key={i} aria-hidden="true" className={cn("h-3.5 w-3.5 rounded-full border border-foreground", plein && "bg-foreground")} />
        ))}
      </p>
      {/* Message près des cases, avant le pavé (retouche 6) : Ngozi le lit là où elle regarde. */}
      <div className="mt-2"><Erreur message={error} /></div>
      {/* Pavé numérique de boutons de 64 px (§ 7.2), chiffres en Garamond. */}
      <div className="mx-auto mt-5 grid max-w-72 grid-cols-3 gap-3">
        {PAD_KEYS.map((k) => (
          <Button
            key={k}
            type="button"
            variant={k === "valider" ? "default" : "outline"}
            className={cn("h-16 min-w-16 px-2", /^\d$/.test(k) ? "font-serif text-2xl" : "text-sm")}
            disabled={pending}
            onClick={() => touche(k)}
          >
            {k === "effacer" ? t("poste.effacer") : k === "valider" ? t("poste.valider") : k}
          </Button>
        ))}
      </div>
      <Button variant="link" className="mt-2 w-full" onClick={() => { setChoisi(null); setPin(""); setError(null); charger(); }}>{t("poste.changer")}</Button>
    </Couverture>
  );
}
