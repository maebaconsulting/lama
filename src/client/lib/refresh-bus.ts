import type { RefreshKey } from "./realtime.ts";

type Listener = (keys: RefreshKey[]) => void;
const listeners = new Set<Listener>();

export function onRefresh(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function emitRefresh(keys: RefreshKey[]): void {
  for (const fn of [...listeners]) fn(keys);
}
