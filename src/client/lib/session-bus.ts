import type { SessionSignal } from "./http.ts";

type Listener = (signal: SessionSignal) => void;
const listeners = new Set<Listener>();

/** Abonne la porte d'entrée aux refus qui changent d'écran ; renvoie le désabonnement. */
export function onSessionSignal(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function emitSessionSignal(signal: SessionSignal): void {
  for (const fn of [...listeners]) fn(signal);
}
