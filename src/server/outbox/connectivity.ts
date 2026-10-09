let online = true;
export function isOnline(): boolean { return online; }
export function setOnline(value: boolean): void { online = value; }

/** Requête légère (HEAD, 5 s) : en ligne si le serveur distant répond, quel que soit le code. */
export async function httpCheck(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return res.status < 600;
  } catch {
    return false;
  }
}
