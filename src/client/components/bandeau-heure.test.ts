import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { bandeauHeure } from "../lib/heure.ts";

/** Bandeau d'heure (distribution D-11, D-13) : texte (fonction pure) et câblage dans `bandeaux.tsx`. */

const VU = Date.parse("2026-10-05T13:00:00Z");
const ok = { serveur: VU, derniere_facture: VU - 3_600_000, caisse_bloquee: false };

test("écart de plus de 2 minutes : les deux heures et l'écart ; rien en deçà ni sans écart lu", () => {
  assert.deepEqual(bandeauHeure(ok, 14 * 60_000, VU, "fr"), {
    long: "L'heure du serveur diffère de cet appareil de 14\u00a0min (serveur 05/10/2026 14:14, appareil 05/10/2026 14:00).",
    court: "Heure du serveur décalée de 14\u00a0min.",
    gerante: "Heure du serveur décalée\u00a0: prévenez l'administrateur.",
  });
  assert.equal(bandeauHeure(ok, -3 * 3_600_000, VU, "en")!.long, "The server time differs from this device by 3 h (server 05/10/2026 11:00, device 05/10/2026 14:00).");
  assert.equal(bandeauHeure(ok, 14 * 60_000, VU, "en")!.gerante, "Server clock off: tell the administrator.");
  assert.equal(bandeauHeure(ok, 90_000, VU, "fr"), null);
  assert.equal(bandeauHeure(ok, null, VU, "fr"), null);
});

test("caisse bloquée : le bandeau l'explique, avant l'écart", () => {
  const bloquee = { serveur: VU - 3 * 86_400_000, derniere_facture: VU, caisse_bloquee: true };
  assert.deepEqual(bandeauHeure(bloquee, -3 * 86_400_000, VU, "fr"), {
    long: "Caisse bloquée\u00a0: l'heure du serveur (02/10/2026 14:00) est antérieure à la dernière facture (05/10/2026 14:00). Ventes, avoirs et acomptes attendent sa correction.",
    court: "Caisse bloquée\u00a0: heure à corriger.",
    gerante: "Caisse bloquée\u00a0: prévenez l'administrateur.",
  });
});

test("bandeaux : administrateur et gérante, lien « Corriger l'heure » pour l'administrateur, la gérante prévient", () => {
  const source = readFileSync(new URL("./bandeaux.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(voitHeure\(role\)\) api<EtatHeure>\("GET", "\/api\/heure"\)\.then\(\(etat\) => setHeure\(\{ etat, ecart: dernierEcart\(\), vu: Date\.now\(\) \}\)/);
  assert.match(source, /useRefresh\(\["invoices"\], chargerHeure\);/);
  assert.match(source, /const reglagesHeure = pathFor\("reglages", lang, "heure"\);/);
  assert.match(source, /href=\{reglagesHeure\} onClick=\{\(e\) => \{ e\.preventDefault\(\); navigate\(reglagesHeure\); \}\}>\{t\("bandeau\.voir_heure"\)\}<\/a>/);
  // Téléphone : forme courte sans coupure ; la gérante lit la consigne dans le texte court, l'administrateur a le lien.
  assert.match(source, /<span className="@md:hidden">\{role === "admin" \? texteHeure\.court : texteHeure\.gerante\}<\/span>/);
  const bandeau = source.slice(source.indexOf("{texteHeure && ("), source.indexOf("{file && !file.online"));
  assert.doesNotMatch(bandeau, /truncate/);
  assert.match(bandeau, /\{texteHeure\.long\}\{role !== "admin" && <>\{" "\}\{t\("bandeau\.prevenir_admin"\)\}<\/>\}/);
});
