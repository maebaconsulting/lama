/**
 * Faux Meta en mémoire (WhatsApp Business Cloud API, spec du 21/10/2026, W-20) : mêmes chemins
 * (`/{version}/{numéro}/messages`, `/{version}/{numéro}/media`, lecture du numéro,
 * `/{version}/{compte}/message_templates` par pages), même jeton en en-tête, mêmes formes de réponse et
 * d'erreur (`{ error: { message, type, code, error_subcode, fbtrace_id } }`) que la documentation de Meta.
 * Un message libre n'est accepté que dans la fenêtre de 24 h ; un modèle doit être approuvé, avec son
 * en-tête et le bon nombre de valeurs, jamais vides. Sert aux essais (fonction `fetch` injectée) et, par
 * `serveFakeMeta`, à la vérification au navigateur. Jamais en production.
 */
import { createServer, type Server } from "node:http";
import { GRAPH_VERSION } from "./meta-api.ts";
import { MODELES_META, numeroter } from "./modeles-meta.ts";
import { TEMPLATE_KINDS, type TemplateKind } from "./textes.ts";

export interface FakeMetaTemplate { name: string; language: string; status: string; category: string; params: number | null; header: "aucun" | "document" | "image" }
export interface FakeMetaSent {
  id: string; to: string; type: string;
  text?: string;
  template?: { name: string; language: string; header?: { type: string; media: string; filename?: string }; body: string[] };
  document?: { media: string; filename: string; caption: string };
  image?: { media: string; caption: string };
}
export interface FakeMeta {
  fetch: typeof fetch;
  token: string;
  phoneId: string;
  wabaId: string;
  phone: { display_phone_number: string; verified_name: string; quality_rating: string };
  templates: FakeMetaTemplate[];
  sent: FakeMetaSent[];
  media: Map<string, { mime: string; filename: string; size: number }>;
  /** Numéros (chiffres seuls) qui ont écrit à l'institut depuis moins de 24 h : seuls à recevoir un message libre. */
  window: Set<string>;
  /** Numéros sans WhatsApp : refus 131026. */
  unknownNumbers: Set<string>;
  /** Prochain appel refusé avec ce statut HTTP et ce code d'erreur de Meta. */
  failNext: { status: number; code: number; subcode?: number } | null;
  /** Meta injoignable : chaque appel échoue comme un `fetch` sans réseau. */
  down: boolean;
  /** Appels reçus (`MÉTHODE /chemin`), pour vérifier qu'aucun appel n'a eu lieu. */
  calls: string[];
  /** Taille d'une page de la liste des modèles. */
  pageSize: number;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const failure = (status: number, code: number, message: string, subcode?: number) =>
  json(status, { error: { message, type: "OAuthException", code, ...(subcode !== undefined ? { error_subcode: subcode } : {}), fbtrace_id: "Afaux" } });
/** Règle de Meta pour une valeur de modèle. */
const valeurRefusee = (v: unknown) => typeof v !== "string" || !v.trim() || /[\n\t]| {5,}/.test(v);

export function createFakeMeta(opts: { token?: string; phoneId?: string; wabaId?: string } = {}): FakeMeta {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Corps = any;

  function sendTemplate(template: Corps, ok: (s: Omit<FakeMetaSent, "id" | "to" | "type">) => Response): Response {
    const name = String(template?.name ?? "");
    const language = String(template?.language?.code ?? "");
    const known = fake.templates.find((t) => t.name === name && t.language === language);
    if (!known || known.status !== "APPROVED") return failure(404, 132001, "Template name does not exist in the translation");
    const components: Corps[] = Array.isArray(template.components) ? template.components : [];
    const header = components.find((c) => c?.type === "header")?.parameters?.[0];
    const body: unknown[] = (components.find((c) => c?.type === "body")?.parameters ?? []).map((p: Corps) => p?.text);
    if (known.header !== "aucun" && (header?.type !== known.header || !fake.media.has(header?.[known.header]?.id))) {
      return failure(400, 132012, "Parameter format does not match format in the created template");
    }
    if (known.params !== null && body.length !== known.params) return failure(400, 132000, "Number of parameters does not match the expected number of params");
    if (body.some(valeurRefusee)) return failure(400, 100, "Invalid parameter");
    const entete = header ? { header: { type: String(header.type), media: String(header[header.type].id), ...(header.type === "document" ? { filename: String(header.document.filename ?? "") } : {}) } } : {};
    return ok({ template: { name, language, ...entete, body: body as string[] } });
  }

  function send(body: Corps): Response {
    const to = String(body?.to ?? "");
    if (body?.messaging_product !== "whatsapp" || !/^\d{6,15}$/.test(to)) return failure(400, 100, "Invalid parameter");
    if (fake.unknownNumbers.has(to)) return failure(400, 131026, "Message undeliverable");
    const id = `wamid.essai${fake.sent.length + 1}`;
    const ok = (sent: Omit<FakeMetaSent, "id" | "to" | "type">) => {
      fake.sent.push({ id, to, type: String(body.type), ...sent });
      return json(200, { messaging_product: "whatsapp", contacts: [{ input: to, wa_id: to }], messages: [{ id }] });
    };
    if (body.type === "template") return sendTemplate(body.template, ok);
    // Message libre : seulement dans la fenêtre de 24 h ouverte par la cliente.
    if (!fake.window.has(to)) return failure(400, 131047, "Re-engagement message");
    if (body.type === "text" && typeof body.text?.body === "string") return ok({ text: body.text.body });
    if (body.type === "document" && fake.media.has(body.document?.id)) {
      return ok({ document: { media: body.document.id, filename: String(body.document.filename ?? ""), caption: String(body.document.caption ?? "") } });
    }
    if (body.type === "image" && fake.media.has(body.image?.id)) return ok({ image: { media: body.image.id, caption: String(body.image.caption ?? "") } });
    return failure(400, 100, "Invalid parameter");
  }

  const fake: FakeMeta = {
    token: opts.token ?? "jeton-essai",
    phoneId: opts.phoneId ?? "106540352242922",
    wabaId: opts.wabaId ?? "102290129340398",
    phone: { display_phone_number: "+237 6 99 00 00 00", verified_name: "Institut Ébène", quality_rating: "GREEN" },
    templates: [], sent: [], media: new Map(), window: new Set(), unknownNumbers: new Set(), failNext: null, down: false, calls: [], pageSize: 100,
    fetch: async (input, init = {}) => {
      if (fake.down) throw new TypeError("fetch failed");
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = (init.method ?? "GET").toUpperCase();
      fake.calls.push(`${method} ${url.pathname}`);
      const headers = new Headers(init.headers);
      if (headers.get("authorization") !== `Bearer ${fake.token}`) return failure(401, 190, "Invalid OAuth access token - Cannot parse access token");
      if (fake.failNext) {
        const { status, code, subcode } = fake.failNext;
        fake.failNext = null;
        return failure(status, code, "Erreur simulée", subcode);
      }
      const prefix = `/${GRAPH_VERSION}/`;
      if (!url.pathname.startsWith(prefix)) return failure(400, 100, "Unknown path components");
      const [id, edge, ...rest] = url.pathname.slice(prefix.length).split("/");
      if (rest.length) return failure(400, 100, "Unknown path components");
      const inconnu = () => failure(400, 100, `Unsupported get request. Object with ID '${id}' does not exist`, 33);
      if (method === "GET" && !edge) return id === fake.phoneId ? json(200, { ...fake.phone, id }) : inconnu();
      if (method === "GET" && edge === "message_templates") {
        if (id !== fake.wabaId) return inconnu();
        const debut = Number(url.searchParams.get("after") ?? 0);
        const taille = Math.min(fake.pageSize, Number(url.searchParams.get("limit") ?? 25));
        const suite = new URL(url.href);
        suite.searchParams.set("after", String(debut + taille));
        return json(200, {
          data: fake.templates.slice(debut, debut + taille).map((t, i) => ({ name: t.name, language: t.language, status: t.status, category: t.category, id: String(9000 + debut + i) })),
          paging: { cursors: { before: String(debut), after: String(debut + taille) }, ...(debut + taille < fake.templates.length ? { next: suite.href } : {}) },
        });
      }
      const requete = () => new Request(url.href, { method, headers, body: init.body as BodyInit });
      if (method === "POST" && edge === "media" && id === fake.phoneId) {
        const form = await requete().formData();
        const file = form.get("file");
        const type = form.get("type");
        if (form.get("messaging_product") !== "whatsapp" || typeof type !== "string" || !(file instanceof Blob)) return failure(400, 100, "Invalid parameter");
        if (!["application/pdf", "image/png", "image/jpeg"].includes(type)) return failure(400, 131053, "Media upload error");
        const mediaId = `media-${fake.media.size + 1}`;
        fake.media.set(mediaId, { mime: type, filename: file instanceof File ? file.name : "", size: file.size });
        return json(200, { id: mediaId });
      }
      if (method === "POST" && edge === "messages" && id === fake.phoneId) return send(JSON.parse(await requete().text()));
      return failure(400, 100, "Unsupported request");
    },
  };
  return fake;
}

/** Dépose les douze modèles de lama dans le faux Meta, approuvés dans les deux langues sauf indication. */
export function registerLamaTemplates(fake: FakeMeta, statuses: Partial<Record<TemplateKind, string>> = {}, langs: readonly ("fr" | "en")[] = ["fr", "en"]): void {
  for (const kind of TEMPLATE_KINDS) {
    const m = MODELES_META[kind];
    for (const lang of langs) {
      fake.templates.push({
        name: m.nom, language: lang, status: statuses[kind] ?? "APPROVED", category: m.categorie === "marketing" ? "MARKETING" : "UTILITY",
        params: numeroter(m.corps[lang]).ordre.length, header: m.entete,
      });
    }
  }
}

/**
 * Le faux Meta derrière un vrai port HTTP (vérification au navigateur, avec `LAMA_META_BASE=http://127.0.0.1:<port>`
 * côté lama). Commandes d'essai sans jeton : `GET /__faux/sent` (messages reçus), `POST /__faux/fenetre/<numéro>`
 * (la cliente vient d'écrire : fenêtre de 24 h ouverte). Meta injoignable : arrêter le processus.
 */
export function serveFakeMeta(fake: FakeMeta, port: number): Promise<Server> {
  const server = createServer(async (req, res) => {
    const fenetre = /^\/__faux\/fenetre\/(\d{6,15})$/.exec(req.url ?? "");
    if (fenetre) {
      fake.window.add(fenetre[1]);
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
      method: req.method, headers: req.headers as Record<string, string>, body: (chunks.length ? Buffer.concat(chunks) : undefined) as BodyInit | undefined,
    }).catch(() => new Response("", { status: 502 }));
    res.writeHead(reply.status, Object.fromEntries(reply.headers));
    res.end(Buffer.from(await reply.arrayBuffer()));
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}
