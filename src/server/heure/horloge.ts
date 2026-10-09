/**
 * Réglage de l'horloge du système (distribution D-12) par l'interface
 * `timedate1` de systemd, avec `timedatectl`, sous le compte `lama` : la
 * règle polkit `deploy/polkit/50-lama-heure.rules` l'autorise pour ces seuls
 * gestes (couper la synchronisation, régler l'heure, la rétablir), sans sudo
 * ni droits root. `timedated` refuse de régler l'heure tant que la
 * synchronisation automatique est active : elle est coupée le temps du
 * réglage, puis rétablie (sans effet hors ligne, elle reprend quand internet passe).
 */
import { execFile } from "node:child_process";

/** `synchro: false` : l'heure est réglée mais la synchronisation automatique n'a pas pu être rétablie. */
export type ReglageHeure = { ok: true; synchro?: false } | { ok: false; motif: "autorisation" | "absente" | "echec"; detail: string };

/** Horloge du système, remplacée par une fausse dans les essais (liaison `HORLOGE`). */
export interface HorlogeSysteme {
  regler(ms: number): Promise<ReglageHeure>;
}

export type Executer = (cmd: string, args: string[]) => Promise<{ code: number; stderr: string; absent?: boolean }>;

export const executer: Executer = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 30_000 }, (error, _stdout, stderr) => {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    resolve({ code: error ? (typeof code === "number" ? code : 1) : 0, stderr: String(stderr), absent: code === "ENOENT" });
  });
});

/** Refus de polkit (règle absente) : `timedatectl` sans demande de mot de passe le dit ainsi. */
const REFUS = /access denied|interactive authentication required|not authorized/i;

export function horlogeTimedatectl(exec: Executer = executer): HorlogeSysteme {
  const timedatectl = (...args: string[]) => exec("timedatectl", ["--no-ask-password", ...args]);
  const refus = (r: { stderr: string; absent?: boolean }): ReglageHeure => {
    const detail = r.stderr.trim().split("\n").pop() ?? "";
    if (r.absent) return { ok: false, motif: "absente", detail: "timedatectl" };
    return { ok: false, motif: REFUS.test(r.stderr) ? "autorisation" : "echec", detail };
  };
  return {
    async regler(ms: number): Promise<ReglageHeure> {
      const coupe = await timedatectl("set-ntp", "false");
      if (coupe.code !== 0) return refus(coupe);
      let regle: { code: number; stderr: string; absent?: boolean };
      try {
        regle = await timedatectl("set-time", `@${Math.round(ms / 1000)}`);
      } catch (e) {
        regle = { code: 1, stderr: String((e as Error)?.message ?? e) };
      }
      // La synchronisation est toujours rétablie ; son propre échec (code ou exception) ne défait pas l'heure réglée.
      let synchro = true;
      try {
        const retabli = await timedatectl("set-ntp", "true");
        if (retabli.code !== 0) {
          synchro = false;
          console.error(`timedatectl set-ntp true a échoué\u00a0: ${retabli.stderr.trim()}`);
        }
      } catch (e) {
        synchro = false;
        console.error(`timedatectl set-ntp true a échoué\u00a0: ${String((e as Error)?.message ?? e)}`);
      }
      if (regle.code !== 0) return refus(regle);
      return synchro ? { ok: true } : { ok: true, synchro: false };
    },
  };
}
