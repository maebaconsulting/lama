/**
 * Fausse passerelle SMS Gateway for Android en mémoire (spec du 04/10/2026,
 * § Tests) : `POST /message` et `GET /health` en authentification basique.
 * `mode` : « ok » (202 et identifiant), « refus » (400), « erreur » (500),
 * « muet » (pas de réponse : la requête échoue comme un délai dépassé).
 * Sert aux essais (fonction `fetch` injectée). Jamais en production.
 */
export interface FakeGateway {
  fetch: typeof fetch;
  sent: { phoneNumbers: string[]; text: string }[];
  lastUrl: string;
  mode: "ok" | "refus" | "erreur" | "muet";
}

export function createFakeGateway(username: string, password: string): FakeGateway {
  const expected = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const fake: FakeGateway = {
    sent: [],
    lastUrl: "",
    mode: "ok",
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      fake.lastUrl = url;
      if (fake.mode === "muet") throw new TypeError("fetch failed");
      const headers = new Headers(init?.headers);
      if (headers.get("authorization") !== expected) return new Response("Unauthorized", { status: 401 });
      const path = new URL(url).pathname;
      if (fake.mode === "erreur") return new Response("{}", { status: 500 });
      if (path === "/health" && (init?.method ?? "GET") === "GET") return Response.json({ status: "pass" });
      if (path === "/message" && init?.method === "POST") {
        if (fake.mode === "refus") return Response.json({ message: "invalid phone" }, { status: 400 });
        const body = JSON.parse(String(init.body)) as { textMessage: { text: string }; phoneNumbers: string[] };
        fake.sent.push({ phoneNumbers: body.phoneNumbers, text: body.textMessage.text });
        return Response.json({ id: `m${fake.sent.length}`, state: "Pending" }, { status: 202 });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch,
  };
  return fake;
}
