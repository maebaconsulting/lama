/**
 * Faux WAHA en mémoire (sous-projet 7 § 4) : mêmes chemins, en-tête
 * `X-Api-Key`, états de session et réponses que WAHA 2026.9 (moteur GOWS),
 * relevés sur la documentation et un conteneur réel (voir le plan de la
 * vague 1). Sert aux tests (fonction `fetch` injectée) et, par
 * `serveFakeWaha`, à la vérification au navigateur. Jamais en production.
 */
import { createServer, type Server } from "node:http";
import { crc32, deflateSync } from "node:zlib";

export type FakeStatus = "STOPPED" | "STARTING" | "SCAN_QR_CODE" | "WORKING" | "FAILED";

/** Image PNG en niveaux de gris, un octet par pixel (0 noir, 255 blanc), agrandie `scale` fois. */
function png(modules: boolean[][], scale: number): Buffer {
  const size = modules.length * scale;
  const raw = Buffer.alloc((size + 1) * size, 255);
  for (let y = 0; y < size; y++) {
    raw[y * (size + 1)] = 0;
    for (let x = 0; x < size; x++) if (modules[Math.floor(y / scale)][Math.floor(x / scale)]) raw[y * (size + 1) + 1 + x] = 0;
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Faux QR code (29 modules, trois repères, motif pseudo-aléatoire fixe, marge blanche) : il a l'air d'un QR, il n'en est pas un. */
function fakeQr(): string {
  const n = 29;
  const m = Array.from({ length: n + 8 }, () => Array<boolean>(n + 8).fill(false));
  let seed = 7;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { seed = (seed * 1103515245 + 12345) % 2147483648; m[y + 4][x + 4] = seed % 3 === 0; }
  for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    for (let y = -1; y < 8; y++) for (let x = -1; x < 8; x++) {
      const inside = x >= 0 && x < 7 && y >= 0 && y < 7;
      const ring = inside && (x === 0 || x === 6 || y === 0 || y === 6);
      const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      const px = ox + x + 4, py = oy + y + 4;
      if (px >= 4 && py >= 4 && px < n + 4 && py < n + 4) m[py][px] = ring || core;
    }
  }
  return png(m, 6).toString("base64");
}

/** QR code rendu par le faux WAHA (image PNG en base64). */
export const FAKE_QR_PNG = fakeQr();

export interface FakeWaha {
  fetch: typeof fetch;
  /** Aucune session au départ, comme au premier démarrage du conteneur. */
  sessions: Map<string, { status: FakeStatus; me: { id: string; pushName: string } | null }>;
  /** Messages reçus ; `file` pour un document ou une photo, sans son contenu : type, nom et taille ; `image` pour un envoi par `/api/sendImage`. */
  sent: { session: string; chatId: string; text: string; file?: { mimetype: string; filename: string; size: number }; image?: true }[];
  /** Statut rendu par `/api/sendImage` pour simuler une passerelle qui refuse cette commande ; `null` : acceptée. */
  imageRefusal: number | null;
  /** Numéros (chiffres seuls) qui n'ont pas WhatsApp. */
  unknownNumbers: Set<string>;
  /** Passerelle éteinte : chaque appel échoue comme un `fetch` vers un port fermé. */
  down: boolean;
  /** Prochain envoi refusé pour excès de débit (429). */
  rateLimitNext: boolean;
  /** Le téléphone de l'institut scanne le QR code : la session passe à WORKING. */
  scan(session?: string, phone?: string): void;
  /** La session tombe (téléphone éteint trop longtemps, appareil délié). */
  drop(session?: string): void;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const notExpected = (session: string, status: FakeStatus, expected: FakeStatus = "WORKING") => json(422, {
  error: "Session status is not as expected. Try again later or restart the session", session, status, expected: [expected],
});
const missing = (session: string) => json(422, { error: `Session "${session}" does not exist`, session });
const notFound = () => json(404, { message: "Session not found", error: "Not Found", statusCode: 404 });

export function createFakeWaha(apiKey = "cle-essai"): FakeWaha {
  const fake: FakeWaha = {
    sessions: new Map(),
    sent: [],
    unknownNumbers: new Set(),
    down: false,
    rateLimitNext: false,
    imageRefusal: null,
    scan(session = "default", phone = "237699000000") {
      fake.sessions.set(session, { status: "WORKING", me: { id: `${phone}@c.us`, pushName: "Institut" } });
    },
    drop(session = "default") {
      if (fake.sessions.has(session)) fake.sessions.set(session, { status: "SCAN_QR_CODE", me: null });
    },
    fetch: async (input, init = {}) => {
      if (fake.down) throw new TypeError("fetch failed");
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const headers = new Headers(init.headers);
      if (headers.get("x-api-key") !== apiKey) return json(401, { message: "Unauthorized", statusCode: 401 });
      const method = (init.method ?? "GET").toUpperCase();
      const body = init.body ? JSON.parse(String(init.body)) : {};
      const path = url.pathname;
      let m: RegExpExecArray | null;

      if (method === "POST" && path === "/api/sessions") {
        if (fake.sessions.has(body.name)) return json(422, { message: `Session '${body.name}' already exists. Use PUT to update it.`, error: "Unprocessable Entity", statusCode: 422 });
        fake.sessions.set(body.name, { status: body.start === false ? "STOPPED" : "SCAN_QR_CODE", me: null });
        return json(201, { name: body.name, status: body.start === false ? "STOPPED" : "STARTING", config: {}, me: null });
      }
      if ((m = /^\/api\/sessions\/([^/]+)(?:\/(start|stop|logout))?$/.exec(path))) {
        const [, name, action] = m;
        const s = fake.sessions.get(name);
        if (!s) return notFound();
        if (method === "GET" && !action) return json(200, { name, status: s.status, config: {}, me: s.me, engine: { engine: "GOWS" } });
        // Démarrer une session déjà démarrée n'est pas une erreur (201, état inchangé), comme WAHA.
        if (method === "POST" && action === "start") {
          if (s.status === "STOPPED") s.status = s.me ? "WORKING" : "SCAN_QR_CODE";
          return json(201, { name, status: s.status, config: {}, me: s.me });
        }
        if (method === "POST" && action === "stop") { s.status = "STOPPED"; return json(201, { name, status: "STOPPED", config: {}, me: s.me }); }
        // Délier : WAHA redémarre la session pour un nouveau QR code.
        if (method === "POST" && action === "logout") { s.me = null; s.status = "SCAN_QR_CODE"; return json(201, { name, status: "STARTING", config: {}, me: null }); }
      }
      if (method === "GET" && (m = /^\/api\/([^/]+)\/auth\/qr$/.exec(path))) {
        const s = fake.sessions.get(m[1]);
        if (!s) return missing(m[1]);
        if (s.status !== "SCAN_QR_CODE") return notExpected(m[1], s.status, "SCAN_QR_CODE");
        if (headers.get("accept") === "application/json") return json(200, { mimetype: "image/png", data: FAKE_QR_PNG });
        return new Response(Buffer.from(FAKE_QR_PNG, "base64"), { status: 200, headers: { "content-type": "image/png" } });
      }
      if (method === "GET" && path === "/api/contacts/check-exists") {
        const name = url.searchParams.get("session") ?? "";
        const s = fake.sessions.get(name);
        if (!s) return missing(name);
        if (s.status !== "WORKING") return notExpected(name, s.status);
        const phone = url.searchParams.get("phone") ?? "";
        const exists = !fake.unknownNumbers.has(phone);
        return json(200, { numberExists: exists, chatId: exists ? `${phone}@c.us` : null });
      }
      if (method === "POST" && path === "/api/sendText") {
        const s = fake.sessions.get(body.session);
        if (!s) return missing(body.session);
        if (s.status !== "WORKING") return notExpected(body.session, s.status);
        if (fake.rateLimitNext) { fake.rateLimitNext = false; return json(429, { statusCode: 429, message: "Too Many Requests" }); }
        if (typeof body.chatId !== "string" || !body.chatId.endsWith("@c.us") || typeof body.text !== "string") return json(400, { statusCode: 400, message: "Bad Request" });
        fake.sent.push({ session: body.session, chatId: body.chatId, text: body.text });
        return json(201, { id: `true_${body.chatId}_${fake.sent.length}`, body: body.text });
      }
      // Images des produits : photo (`file.data` en base64), légende facultative ; `imageRefusal` simule une passerelle sans `sendImage`.
      if (method === "POST" && path === "/api/sendImage") {
        const s = fake.sessions.get(body.session);
        if (!s) return missing(body.session);
        if (s.status !== "WORKING") return notExpected(body.session, s.status);
        if (fake.imageRefusal !== null) return json(fake.imageRefusal, { statusCode: fake.imageRefusal, message: "sendImage refused" });
        const file = body.file ?? {};
        if (typeof body.chatId !== "string" || !body.chatId.endsWith("@c.us") || typeof file.mimetype !== "string" || typeof file.filename !== "string" || typeof file.data !== "string") {
          return json(400, { statusCode: 400, message: "Bad Request" });
        }
        fake.sent.push({ session: body.session, chatId: body.chatId, text: typeof body.caption === "string" ? body.caption : "", file: { mimetype: file.mimetype, filename: file.filename, size: Buffer.from(file.data, "base64").length }, image: true });
        return json(201, { id: `true_${body.chatId}_${fake.sent.length}` });
      }
      // Vague 2 : document (`file.data` en base64, ou `file.url`, que lama n'utilise pas), légende facultative.
      if (method === "POST" && path === "/api/sendFile") {
        const s = fake.sessions.get(body.session);
        if (!s) return missing(body.session);
        if (s.status !== "WORKING") return notExpected(body.session, s.status);
        const file = body.file ?? {};
        if (typeof body.chatId !== "string" || !body.chatId.endsWith("@c.us") || typeof file.mimetype !== "string" || typeof file.filename !== "string" || typeof file.data !== "string") {
          return json(400, { statusCode: 400, message: "Bad Request" });
        }
        fake.sent.push({ session: body.session, chatId: body.chatId, text: typeof body.caption === "string" ? body.caption : "", file: { mimetype: file.mimetype, filename: file.filename, size: Buffer.from(file.data, "base64").length } });
        return json(201, { id: `true_${body.chatId}_${fake.sent.length}` });
      }
      return json(404, { statusCode: 404, message: `Cannot ${method} ${path}`, error: "Not Found" });
    },
  };
  return fake;
}

/**
 * Le faux WAHA derrière un vrai port HTTP (vérification au navigateur, port
 * libre au choix). Commandes d'essai sans clé : `POST /__faux/scan` (le
 * téléphone scanne), `POST /__faux/drop` (la session tombe), `GET /__faux/sent`
 * (messages reçus). Passerelle injoignable : arrêter le processus.
 */
export function serveFakeWaha(fake: FakeWaha, port: number): Promise<Server> {
  const server = createServer(async (req, res) => {
    if (req.url === "/__faux/scan" || req.url === "/__faux/drop") {
      if (req.url === "/__faux/scan") fake.scan();
      else fake.drop();
      res.writeHead(204).end();
      return;
    }
    if (req.url === "/__faux/sent") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(fake.sent));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const reply = await fake.fetch(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method, headers: req.headers as Record<string, string>, body: chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined,
    }).catch(() => new Response("", { status: 502 }));
    res.writeHead(reply.status, Object.fromEntries(reply.headers));
    res.end(Buffer.from(await reply.arrayBuffer()));
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}
