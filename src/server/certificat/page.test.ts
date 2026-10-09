import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { encode } from "uqr";
import { DICTIONARY } from "../messages.ts";
import { adresseHttps, appareilDe, echapper, empreinteDe, hoteDe, langueDePage, pageCertificat, pageConfirmation, profilMobileconfig, qrSvg } from "./page.ts";
import { autoriteLue, CHEMINS_HTTP, redirectionHttps, routesCertificat } from "./routes.ts";

/**
 * Page « Installer le certificat » (distribution D-09). L'autorité d'essai
 * ci-dessous a été fabriquée une fois par deploy/lama-certificat.sh (aucun
 * openssl requis pour ces essais) ; son empreinte est connue.
 */
const PEM = [
  "-----BEGIN CERTIFICATE-----",
  "MIICBjCCAaugAwIBAgIUVl1/5Z4PsiRYho/MW2GP5lJI1B0wCgYIKoZIzj0EAwIw",
  "PTENMAsGA1UECgwEbGFtYTEsMCoGA1UEAwwjQXV0b3JpdMOpIGRlIGxhbWEgMjAy",
  "NjEwMDUtMDRkZWI2YWMwHhcNMjYxMDA1MDkwNzA1WhcNMzYxMDAyMDkwNzA1WjA9",
  "MQ0wCwYDVQQKDARsYW1hMSwwKgYDVQQDDCNBdXRvcml0w6kgZGUgbGFtYSAyMDI2",
  "MTAwNS0wNGRlYjZhYzBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABMC8wWstQPNP",
  "GUDmZuroD1/ruoaeenk6vjwlazhIoW40mNv6ltWh/rPaN0n1yv3hHYrv+OUNy3CF",
  "0JkBOVkwClOjgYgwgYUwEgYDVR0TAQH/BAgwBgEB/wIBADAOBgNVHQ8BAf8EBAMC",
  "AQYwHQYDVR0OBBYEFHDBpG7eDdtPoE31Mj6aOE7XWWngMEAGA1UdHgEB/wQ2MDSg",
  "MjAMggpsYW1hLmxvY2FsMAqHCAoAAAD/AAAAMAqHCKwQAAD/8AAAMAqHCMCoAAD/",
  "/wAAMAoGCCqGSM49BAMCA0kAMEYCIQCQiIkDr93JoQDgdpJDlZ2B78Am/xiTRfDM",
  "qJ4nmC7vUwIhAJUftkFsXt5UH6KF2Hpr5UlWMpKgXOnqaVFk0sTB7hHo",
  "-----END CERTIFICATE-----",
].join("\n") + "\n";
const EMPREINTE = "F6:3A:1D:A9:C3:1E:28:A6:2A:01:3C:E1:4E:9D:E4:E7:46:27:19:F6:04:23:96:3F:39:04:CC:BC:B6:EA:AD:7F";

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; SM-A146P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
};

function dossierAvecAutorite(): string {
  const tls = join(mkdtempSync(join(tmpdir(), "lama-page-")), "tls");
  mkdirSync(tls);
  writeFileSync(join(tls, "autorite.crt"), PEM);
  return tls;
}

test("appareil reconnu par User-Agent : iPhone et iPad, Android, Windows, Mac, autre", () => {
  assert.equal(appareilDe(UA.iphone), "ios");
  assert.equal(appareilDe(UA.ipad), "ios");
  assert.equal(appareilDe(UA.android), "android");
  assert.equal(appareilDe(UA.windows), "windows");
  assert.equal(appareilDe(UA.mac), "mac");
  assert.equal(appareilDe("curl/8.7.1"), "autre");
  assert.equal(appareilDe(undefined), "autre");
});

test("langue : ?lang d'abord, sinon Accept-Language (anglais par défaut)", () => {
  assert.equal(langueDePage("en", "fr-FR,fr;q=0.9"), "en");
  assert.equal(langueDePage("fr", "en-US"), "fr");
  assert.equal(langueDePage(undefined, "fr-CM,fr;q=0.9"), "fr");
  assert.equal(langueDePage("de", "en-GB"), "en");
  assert.equal(langueDePage(undefined, undefined), "en");
});

test("hôte recopié seulement s'il est un nom ou une IPv4, port retiré ; sinon lama.local", () => {
  assert.equal(hoteDe("lama.local"), "lama.local");
  assert.equal(hoteDe("LAMA.local:80"), "lama.local");
  assert.equal(hoteDe("192.168.1.50:8080"), "192.168.1.50");
  for (const mauvais of ["evil.example.com", "8.8.8.8", "lama-2.local", "172.32.0.1", "192.168.1.300", "192.168.01.5", "", undefined, "lama.local\"><script>", "a b", "exemple.com/chemin", "[::1]:80", "-lama.local"]) assert.equal(hoteDe(mauvais), "lama.local", String(mauvais));
  assert.equal(hoteDe("192.168.1.20"), "192.168.1.20");
  assert.equal(hoteDe("10.0.0.7:80"), "10.0.0.7");
  assert.equal(hoteDe("172.16.4.2"), "172.16.4.2");
  assert.equal(hoteDe("127.0.0.1"), "127.0.0.1");
  assert.equal(adresseHttps("lama.local", 443, "/certificat/ok"), "https://lama.local/certificat/ok");
  assert.equal(adresseHttps("192.168.1.50", 8443, "/"), "https://192.168.1.50:8443/");
});

test("empreinte SHA-256 de l'autorité, comme openssl l'affiche", () => {
  assert.equal(empreinteDe(PEM), EMPREINTE);
});

test("page en français : fichier proposé selon l'appareil, étapes de chaque appareil, empreinte, bouton Vérifier, QR code", () => {
  const ios = pageCertificat({ lang: "fr", appareil: "ios", empreinte: EMPREINTE, hote: "lama.local", portHttps: 443 });
  assert.match(ios, /<html lang="fr">/);
  assert.match(ios, /<title>Installer le certificat de lama<\/title>/);
  assert.match(ios, /<details id="appareil-ios" open>/, "l'appareil reconnu est ouvert");
  assert.ok(ios.indexOf('id="appareil-ios"') < ios.indexOf('id="appareil-android"'), "et placé en premier");
  assert.match(ios, /href="\/certificat\/lama\.mobileconfig\?lang=fr">Télécharger le profil</);
  assert.match(ios, /href="\/certificat\/autorite\.crt" download="lama-autorite\.crt">Télécharger le certificat</);
  for (const appareil of ["ios", "android", "windows", "mac"]) assert.match(ios, new RegExp(`id="appareil-${appareil}"`));
  assert.ok(ios.includes(EMPREINTE));
  assert.match(ios, /href="https:\/\/lama\.local\/certificat\/ok\?lang=fr">Vérifier la connexion sécurisée</);
  assert.match(ios, /<img class="qr" src="\/certificat\/qr\.svg"/);
  assert.match(ios, /href="\/certificat\?lang=en"/);
  assert.ok(ios.includes(echapper(DICTIONARY["certificat.ios.3"].fr)));
  const android = pageCertificat({ lang: "fr", appareil: "android", empreinte: EMPREINTE, hote: "192.168.1.50", portHttps: 443 });
  assert.match(android, /<details id="appareil-android" open>/);
  assert.doesNotMatch(android, /<details id="appareil-ios" open>/);
  assert.match(android, /href="https:\/\/192\.168\.1\.50\/certificat\/ok\?lang=fr"/);
  assert.doesNotMatch(ios, /https?:\/\/(?!lama\.local)[a-z]/i, "aucune ressource externe");
});

test("page en anglais ; sans autorité fabriquée, la page le dit sans rien proposer", () => {
  const en = pageCertificat({ lang: "en", appareil: "windows", empreinte: EMPREINTE, hote: "lama.local", portHttps: 443 });
  assert.match(en, /<html lang="en">/);
  assert.match(en, /Check the secure connection/);
  assert.match(en, /href="\/certificat\?lang=fr"/);
  const absente = pageCertificat({ lang: "fr", appareil: "ios", empreinte: null, hote: "lama.local", portHttps: 443 });
  assert.ok(absente.includes(echapper(DICTIONARY["certificat.absent"].fr)));
  assert.doesNotMatch(absente, /mobileconfig|autorite\.crt|qr\.svg/);
});

test("profil iOS : autorité en DER, charge utile racine, identifiants stables, texte échappé", () => {
  const profil = profilMobileconfig(PEM, "fr");
  assert.match(profil, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(profil, /<string>com\.apple\.security\.root<\/string>/);
  const der = /<data>\n([\s\S]*?)\n\s*<\/data>/.exec(profil)![1].replace(/\s+/g, "");
  assert.deepEqual(Buffer.from(der, "base64"), new X509Certificate(PEM).raw);
  assert.equal(profilMobileconfig(PEM, "fr"), profil, "même profil à chaque téléchargement (remplace au lieu de s'ajouter)");
  assert.match(profil, /<string>lama, certificat de l&#39;institut<\/string>/);
  const uuids = [...profil.matchAll(/<string>([0-9A-F-]{36})<\/string>/g)].map((m) => m[1]);
  assert.equal(new Set(uuids).size, 2);
});

test("QR code : SVG de l'adresse de la page", () => {
  const svg = qrSvg("http://lama.local/certificat");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.equal(encode("http://lama.local/certificat", { ecc: "M" }).version, 3, "petit code (version 3) : lisible de loin, imprimable");
});

test("page de confirmation : sécurisée en https, sinon renvoi aux étapes", () => {
  assert.match(pageConfirmation("fr", true), /Connexion sécurisée[\s\S]*href="\/">Ouvrir lama/);
  assert.match(pageConfirmation("en", false), /Connection not secure[\s\S]*href="\/certificat">See the steps again/);
});

test("routes : page, certificat DER, profil, QR code, confirmation ; jamais gardés en cache", async () => {
  const app = routesCertificat({ tlsDir: dossierAvecAutorite(), securisee: false, portHttps: () => 443 });
  const page = await app.request("/certificat?lang=fr", { headers: { "user-agent": UA.android, host: "lama.local" } });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.match(await page.text(), /<details id="appareil-android" open>/);
  const crt = await app.request("/certificat/autorite.crt");
  assert.equal(crt.headers.get("content-type"), "application/x-x509-ca-cert");
  assert.deepEqual(Buffer.from(await crt.arrayBuffer()), new X509Certificate(PEM).raw);
  const profil = await app.request("/certificat/lama.mobileconfig", { headers: { "accept-language": "en" } });
  assert.equal(profil.headers.get("content-type"), "application/x-apple-aspen-config");
  assert.match(await profil.text(), /lama, institute certificate/);
  const qr = await app.request("/certificat/qr.svg", { headers: { host: "192.168.1.50" } });
  assert.equal(qr.headers.get("content-type"), "image/svg+xml");
  assert.equal(await qr.text(), qrSvg("http://192.168.1.50/certificat"));
  assert.match(await (await app.request("/certificat/ok")).text(), /Connection not secure/);
  const sure = routesCertificat({ tlsDir: dossierAvecAutorite(), securisee: true, portHttps: () => 443 });
  assert.match(await (await sure.request("/certificat/ok", { headers: { "accept-language": "fr" } })).text(), /Connexion sécurisée/);
});

test("routes : Host, User-Agent et Accept-Language hostiles ne sont jamais recopiés ; la langue forcée suit les liens", async () => {
  const app = routesCertificat({ tlsDir: dossierAvecAutorite(), securisee: false, portHttps: () => 443 });
  const hostile = { host: 'evil.example.com"><script>alert(1)</script>', "user-agent": "<script>x</script> iPhone", "accept-language": "<b>fr</b>" };
  const page = await (await app.request("/certificat?lang=en", { headers: hostile })).text();
  assert.doesNotMatch(page, /evil\.example|<script>alert|<script>x|<b>fr/);
  assert.match(page, /href="https:\/\/lama\.local\/certificat\/ok\?lang=en"/);
  assert.match(page, /href="\/certificat\/lama\.mobileconfig\?lang=en"/);
  const qr = await app.request("/certificat/qr.svg", { headers: { host: "evil.example.com" } });
  assert.equal(await qr.text(), qrSvg("http://lama.local/certificat"));
  const profil = await app.request("/certificat/lama.mobileconfig?lang=en", { headers: { "accept-language": "fr" } });
  assert.match(await profil.text(), /lama, institute certificate/);
  assert.equal(redirectionHttps("http://x/", "evil.example.com", 443).headers.get("location"), "https://lama.local/");
});

test("routes sans autorité lisible : page 503 qui le dit, fichiers introuvables", async () => {
  const vide = join(mkdtempSync(join(tmpdir(), "lama-page-")), "tls");
  for (const tlsDir of [null, vide]) {
    const app = routesCertificat({ tlsDir, securisee: false, portHttps: () => 443 });
    assert.equal((await app.request("/certificat")).status, 503);
    assert.equal((await app.request("/certificat/autorite.crt")).status, 404);
    assert.equal((await app.request("/certificat/lama.mobileconfig")).status, 404);
  }
  mkdirSync(vide, { recursive: true });
  writeFileSync(join(vide, "autorite.crt"), "pas un certificat");
  assert.equal(autoriteLue(vide), null);
});

test("redirection de l'écoute http : 301 vers https à la même adresse, jamais en cache ; la page et ses fichiers restent en http", () => {
  const r = redirectionHttps("http://lama.local/agenda?jour=2026-10-05", "lama.local", 443);
  assert.equal(r.status, 301);
  assert.equal(r.headers.get("location"), "https://lama.local/agenda?jour=2026-10-05");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(redirectionHttps("http://x/", "192.168.1.50:80", 8443).headers.get("location"), "https://192.168.1.50:8443/");
  assert.equal(redirectionHttps("http://x/", "mauvais hôte", 443).headers.get("location"), "https://lama.local/");
  assert.deepEqual([...CHEMINS_HTTP].sort(), ["/certificat", "/certificat/autorite.crt", "/certificat/lama.mobileconfig", "/certificat/qr.svg"]);
});
