/**
 * Page « Installer le certificat » (distribution D-09) : servie par lama
 * lui-même, en HTTP sur le port 80 (un appareil qui n'a pas encore approuvé
 * l'autorité ne peut pas ouvrir la version https). Fonctions pures : la page,
 * le profil iOS, le QR code ; les routes sont dans `routes.ts`.
 */
import { createHash, X509Certificate } from "node:crypto";
import { renderSVG } from "uqr";
import { langOf, message, type Lang, type MessageKey } from "../messages.ts";

export type Appareil = "ios" | "android" | "windows" | "mac" | "autre";

/** Ordre d'affichage des étapes, l'appareil reconnu ouvert en premier. */
export const APPAREILS: readonly Exclude<Appareil, "autre">[] = ["ios", "android", "windows", "mac"];

/**
 * Appareil d'après l'en-tête `User-Agent`. Un iPad récent se présente comme
 * un Mac : la page le corrige elle-même (écran tactile), voir `pageCertificat`.
 */
export function appareilDe(userAgent: string | null | undefined): Appareil {
  const ua = userAgent ?? "";
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Windows/.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/.test(ua)) return "mac";
  return "autre";
}

/** Langue de la page : `?lang=fr` ou `?lang=en` d'abord, sinon `Accept-Language` (anglais par défaut, comme l'API). */
export function langueDePage(lang: string | undefined, acceptLanguage: string | null | undefined): Lang {
  if (lang === "fr" || lang === "en") return lang;
  return langOf(acceptLanguage);
}

/**
 * Hôte demandé (`Host`), sans le port, réduit à ce que l'autorité de l'institut
 * peut couvrir : `lama.local`, ou une adresse IPv4 privée (10/8, 172.16/12,
 * 192.168/16) ou 127.0.0.1. Il est recopié dans la page, le QR code et
 * l'adresse de redirection : toute autre valeur (nom étranger, adresse
 * publique, texte malformé) devient `lama.local`.
 */
export function hoteDe(host: string | null | undefined): string {
  const sansPort = (host ?? "").trim().toLowerCase().replace(/:\d{1,5}$/, "");
  if (sansPort === "lama.local") return sansPort;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(sansPort);
  if (m) {
    const o = m.slice(1).map(Number);
    const prive = o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168) || sansPort === "127.0.0.1";
    if (prive && o.every((n) => n <= 255) && m.slice(1).every((x, i) => String(o[i]) === x)) return sansPort;
  }
  return "lama.local";
}

/** Adresse https de la même machine : port omis s'il vaut 443. */
export function adresseHttps(hote: string, port: number, chemin: string): string {
  return `https://${hote}${port === 443 ? "" : `:${port}`}${chemin}`;
}

/** Empreinte SHA-256 d'un certificat PEM, en paires hexadécimales majuscules séparées par deux-points (comme `openssl`). */
export function empreinteDe(pem: string): string {
  return new X509Certificate(pem).fingerprint256;
}

/** Texte échappé pour HTML et XML. */
export function echapper(texte: string): string {
  return texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** UUID stable tiré d'un texte : le même profil téléchargé deux fois remplace le premier au lieu de s'ajouter. */
function uuidDe(texte: string): string {
  const h = createHash("sha256").update(texte).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`.toUpperCase();
}

/**
 * Profil `.mobileconfig` d'iOS et d'iPadOS : l'autorité (DER, base64) en charge
 * utile `com.apple.security.root`. Non signé : l'appareil l'indique, c'est attendu.
 */
export function profilMobileconfig(pem: string, lang: Lang): string {
  const cert = new X509Certificate(pem);
  const empreinte = cert.fingerprint256.replace(/:/g, "");
  const t = (key: MessageKey) => echapper(message(lang, key));
  const der = cert.raw.toString("base64").replace(/(.{64})/g, "$1\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key>
      <string>lama-autorite.crt</string>
      <key>PayloadContent</key>
      <data>
${der}
      </data>
      <key>PayloadDescription</key>
      <string>${t("certificat.profil_description")}</string>
      <key>PayloadDisplayName</key>
      <string>${t("certificat.profil_autorite")}</string>
      <key>PayloadIdentifier</key>
      <string>local.lama.autorite.${empreinte.slice(0, 16)}</string>
      <key>PayloadType</key>
      <string>com.apple.security.root</string>
      <key>PayloadUUID</key>
      <string>${uuidDe(`autorite:${empreinte}`)}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>${t("certificat.profil_description")}</string>
  <key>PayloadDisplayName</key>
  <string>${t("certificat.profil_nom")}</string>
  <key>PayloadIdentifier</key>
  <string>local.lama.profil.${empreinte.slice(0, 16)}</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${uuidDe(`profil:${empreinte}`)}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;
}

/** QR code (SVG) d'une adresse, niveau de correction M, marge de deux modules. */
export function qrSvg(adresse: string): string {
  return renderSVG(adresse, { ecc: "M", border: 2 });
}

const ETAPES: Record<Exclude<Appareil, "autre">, MessageKey[]> = {
  ios: ["certificat.ios.1", "certificat.ios.2", "certificat.ios.3", "certificat.ios.4"],
  android: ["certificat.android.1", "certificat.android.2", "certificat.android.3", "certificat.android.4"],
  windows: ["certificat.windows.1", "certificat.windows.2", "certificat.windows.3", "certificat.windows.4"],
  mac: ["certificat.mac.1", "certificat.mac.2", "certificat.mac.3", "certificat.mac.4"],
};

const TITRES: Record<Exclude<Appareil, "autre">, MessageKey> = {
  ios: "certificat.appareil.ios",
  android: "certificat.appareil.android",
  windows: "certificat.appareil.windows",
  mac: "certificat.appareil.mac",
};

/** Feuille de style de la page : sobre (bleu foncé, blanc, gris), lisible sur téléphone, thème sombre suivi. */
const STYLE = `
:root{color-scheme:light dark;--fond:#ffffff;--texte:#1b2430;--gris:#5b6573;--filet:#d5dae1;--accent:#1f3a5f;--sur-accent:#ffffff;--encart:#f3f5f8}
@media (prefers-color-scheme:dark){:root{--fond:#12171e;--texte:#e8ecf1;--gris:#a3adba;--filet:#2c3540;--accent:#8fb3dd;--sur-accent:#0d1a2b;--encart:#1a212b}}
*{box-sizing:border-box}
body{margin:0;background:var(--fond);color:var(--texte);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:40rem;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.6rem;line-height:1.2;margin:0 0 12px}
h2{font-size:1.1rem;margin:28px 0 8px}
p{margin:0 0 12px}
.gris{color:var(--gris)}
.bouton{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:6px;background:var(--accent);color:var(--sur-accent);text-decoration:none;font-weight:600;margin:4px 0}
.bouton.second{background:transparent;color:var(--accent);border:1px solid var(--accent)}
details{border-top:1px solid var(--filet);padding:8px 0}
summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:600}
ol{padding-left:1.4rem;margin:8px 0}
li{margin:6px 0}
.empreinte{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85rem;word-break:break-all;background:var(--encart);padding:10px 12px;border-radius:6px}
.qr{width:200px;height:200px;background:#fff;padding:8px;border-radius:6px}
nav{margin-bottom:16px;font-size:.9rem}
nav a{color:var(--accent)}
`;

export interface PageCertificat {
  lang: Lang;
  appareil: Appareil;
  /** Empreinte de l'autorité ; `null` si elle n'est pas encore fabriquée sur le serveur. */
  empreinte: string | null;
  hote: string;
  /** Port https de lama (443 en service). */
  portHttps: number;
}

/** Page « Installer le certificat », complète (HTML autonome, sans ressource externe). */
export function pageCertificat(p: PageCertificat): string {
  const t = (key: MessageKey, values?: Record<string, string | number>) => echapper(message(p.lang, key, values));
  const autre: Lang = p.lang === "fr" ? "en" : "fr";
  const tete = `<!doctype html>
<html lang="${p.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t("certificat.titre")}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<nav><a href="/certificat?lang=${autre}" hreflang="${autre}">${t("certificat.autre_langue")}</a></nav>
<h1>${t("certificat.titre")}</h1>`;
  if (!p.empreinte) {
    return `${tete}
<p>${t("certificat.absent")}</p>
</main>
</body>
</html>
`;
  }
  const ordre = [...APPAREILS].sort((a, b) => Number(b === p.appareil) - Number(a === p.appareil));
  const fichier = (a: Exclude<Appareil, "autre">) => a === "ios"
    ? `<a class="bouton" href="/certificat/lama.mobileconfig?lang=${p.lang}">${t("certificat.telecharger_profil")}</a>`
    : `<a class="bouton" href="/certificat/autorite.crt" download="lama-autorite.crt">${t("certificat.telecharger_certificat")}</a>`;
  const sections = ordre.map((a) => `<details id="appareil-${a}"${a === p.appareil ? " open" : ""}>
<summary>${t(TITRES[a])}</summary>
${fichier(a)}
<ol>${ETAPES[a].map((k) => `<li>${t(k)}</li>`).join("")}</ol>
</details>`).join("\n");
  const verifier = echapper(adresseHttps(p.hote, p.portHttps, `/certificat/ok?lang=${p.lang}`));
  return `${tete}
<p>${t("certificat.intro")}</p>
<p class="gris">${t("certificat.une_fois")}</p>
<h2>${t("certificat.etapes")}</h2>
${sections}
<h2>${t("certificat.empreinte_titre")}</h2>
<p>${t("certificat.empreinte_aide")}</p>
<p class="empreinte">${echapper(p.empreinte)}</p>
<h2>${t("certificat.verifier_titre")}</h2>
<p>${t("certificat.verifier_aide")}</p>
<p><a class="bouton second" href="${verifier}">${t("certificat.verifier")}</a></p>
<h2>${t("certificat.qr_titre")}</h2>
<p>${t("certificat.qr_aide")}</p>
<img class="qr" src="/certificat/qr.svg" alt="${t("certificat.qr_alt")}" width="200" height="200">
</main>
<script>
// Un iPad récent se présente comme un Mac : écran tactile, c'est un iPad.
(function () {
  if (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) {
    var ios = document.getElementById("appareil-ios");
    var mac = document.getElementById("appareil-mac");
    if (ios && mac) { mac.open = false; ios.open = true; ios.parentNode.insertBefore(ios, ios.parentNode.querySelector("details")); }
  }
})();
</script>
</body>
</html>
`;
}

/** Page de `https://…/certificat/ok` : confirme la connexion sécurisée, ou dit qu'elle ne l'est pas encore. */
export function pageConfirmation(lang: Lang, securisee: boolean): string {
  const t = (key: MessageKey) => echapper(message(lang, key));
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t(securisee ? "certificat.ok_titre" : "certificat.non_securise_titre")}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${t(securisee ? "certificat.ok_titre" : "certificat.non_securise_titre")}</h1>
<p>${t(securisee ? "certificat.ok_texte" : "certificat.non_securise_texte")}</p>
<p><a class="bouton" href="${securisee ? "/" : "/certificat"}">${t(securisee ? "certificat.ouvrir_lama" : "certificat.retour_etapes")}</a></p>
</main>
</body>
</html>
`;
}
