/**
 * Routes de la page « Installer le certificat » (distribution D-09), montées
 * par `boot.ts` sur l'écoute http (port 80, seules routes servies sans
 * redirection) et sur l'écoute https. L'autorité est relue à chaque demande :
 * un certificat fabriqué après le démarrage est servi aussitôt.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import { Hono } from "hono";
import { adresseHttps, appareilDe, empreinteDe, hoteDe, langueDePage, pageCertificat, pageConfirmation, profilMobileconfig, qrSvg } from "./page.ts";

/** Chemins servis en http sans redirection (D-07) : la page et ses fichiers ; `/certificat/ok` part en https. */
export const CHEMINS_HTTP = new Set(["/certificat", "/certificat/autorite.crt", "/certificat/lama.mobileconfig", "/certificat/qr.svg"]);

export interface OptionsCertificat {
  /** Dossier de l'autorité (`LAMA_TLS_DIR`), `null` sans HTTPS configuré. */
  tlsDir: string | null;
  /** Vrai sur l'écoute https. */
  securisee: boolean;
  /** Port https de lama, pour le bouton « Vérifier » (443 en service). */
  portHttps: () => number;
}

/** PEM de l'autorité s'il est lisible et valide, sinon `null`. */
export function autoriteLue(tlsDir: string | null): string | null {
  if (!tlsDir) return null;
  const file = join(tlsDir, "autorite.crt");
  if (!existsSync(file)) return null;
  try {
    const pem = readFileSync(file, "utf8");
    new X509Certificate(pem);
    return pem;
  } catch {
    return null;
  }
}

const SANS_CACHE = { "Cache-Control": "no-store" };

export function routesCertificat(o: OptionsCertificat): Hono {
  const app = new Hono();
  app.get("/certificat", (c) => {
    const pem = autoriteLue(o.tlsDir);
    const html = pageCertificat({
      lang: langueDePage(c.req.query("lang"), c.req.header("accept-language")),
      appareil: appareilDe(c.req.header("user-agent")),
      empreinte: pem ? empreinteDe(pem) : null,
      hote: hoteDe(c.req.header("host")),
      portHttps: o.portHttps(),
    });
    return c.html(html, pem ? 200 : 503, SANS_CACHE);
  });
  app.get("/certificat/autorite.crt", (c) => {
    const pem = autoriteLue(o.tlsDir);
    if (!pem) return c.notFound();
    return c.body(new Uint8Array(new X509Certificate(pem).raw), 200, {
      ...SANS_CACHE,
      "Content-Type": "application/x-x509-ca-cert",
      "Content-Disposition": 'attachment; filename="lama-autorite.crt"',
    });
  });
  app.get("/certificat/lama.mobileconfig", (c) => {
    const pem = autoriteLue(o.tlsDir);
    if (!pem) return c.notFound();
    const lang = langueDePage(c.req.query("lang"), c.req.header("accept-language"));
    return c.body(profilMobileconfig(pem, lang), 200, {
      ...SANS_CACHE,
      "Content-Type": "application/x-apple-aspen-config",
      "Content-Disposition": 'attachment; filename="lama.mobileconfig"',
    });
  });
  app.get("/certificat/qr.svg", (c) => {
    const adresse = `http://${hoteDe(c.req.header("host"))}/certificat`;
    return c.body(qrSvg(adresse), 200, { ...SANS_CACHE, "Content-Type": "image/svg+xml" });
  });
  app.get("/certificat/ok", (c) => {
    const lang = langueDePage(c.req.query("lang"), c.req.header("accept-language"));
    return c.html(pageConfirmation(lang, o.securisee), 200, SANS_CACHE);
  });
  return app;
}

/** Réponse de l'écoute http hors de la page du certificat : 301 vers la même adresse en https, jamais gardée en cache. */
export function redirectionHttps(url: string, host: string | undefined, portHttps: number): Response {
  const { pathname, search } = new URL(url);
  return new Response(null, { status: 301, headers: { Location: adresseHttps(hoteDe(host), portHttps, `${pathname}${search}`), "Cache-Control": "no-store" } });
}
