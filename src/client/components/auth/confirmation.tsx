import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useRef, useState } from "preact/hooks";
import { api } from "../../api";
import { createSharedRequest, withConfirmation } from "../../lib/confirmation";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Champ, Erreur } from "../champ";

type Run = <T>(action: () => Promise<T>) => Promise<T | null>;
const ConfirmationContext = createContext<Run>(null!);

/** Exécute une action sensible, en demandant le mot de passe si le serveur l'exige. */
export function useConfirmation(): Run {
  return useContext(ConfirmationContext);
}

export function ConfirmationProvider({ children }: { children: ComponentChildren }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Une seule demande à la fois : si deux actions sensibles se déclenchent en
  // même temps, la seconde attend la même saisie au lieu d'ouvrir une seconde
  // boîte de dialogue qui écraserait la première (elle resterait alors bloquée).
  const shared = useRef<ReturnType<typeof createSharedRequest> | null>(null);
  if (!shared.current) {
    shared.current = createSharedRequest(() => {
      setPassword("");
      setError(null);
      setOpen(true);
    });
  }

  const obtain = useCallback(() => shared.current!.request(), []);

  const close = (ok: boolean) => {
    setOpen(false);
    setPassword("");
    shared.current!.settle(ok);
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api("POST", "/api/auth/confirm", { password });
      close(true);
    } catch (err) {
      setPassword("");
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const run = useCallback<Run>((action) => withConfirmation(action, obtain), [obtain]);

  return (
    <ConfirmationContext.Provider value={run}>
      {children}
      <Dialog open={open} onOpenChange={(o: boolean) => { if (!o && !pending) close(false); }}>
        <DialogContent compact focusChamp>
          <DialogTitle>{t("confirmation.titre")}</DialogTitle>
          <DialogDescription>{t("confirmation.texte")}</DialogDescription>
          <form className="space-y-4" onSubmit={submit}>
            <Champ id="confirmation-mot-de-passe" type="password" label={t("connexion.mot_de_passe")} autoComplete="current-password" value={password} onInput={(e: Event) => setPassword((e.currentTarget as HTMLInputElement).value)} autoFocus />
            <Erreur message={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={pending} onClick={() => close(false)}>{t("commun.annuler")}</Button>
              <Button type="submit" disabled={pending || !password}>{t("confirmation.bouton")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </ConfirmationContext.Provider>
  );
}
