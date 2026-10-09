import assert from "node:assert/strict";
import { test } from "node:test";
import {
  absenceLine, cardChoice, cardMatches, absenceText, birthdayLabel, birthdayParts, birthdayValue, DEFAULT_ABSENCE_DAYS, isBirthdayToday, keyFigures,
  monthNames, parseTagInput, shownTags, tagFromSearch, tagSuggestions, withTagParam,
} from "./crm.ts";
import { formatAmount, formatPrice, formatShortDate } from "./format.ts";

/**
 * Mini CRM à l'écran (spec du 04/10/2026, § 1) : anniversaire sans année,
 * saisie des étiquettes, ligne d'absence, chiffres clés de la fiche,
 * étiquette du filtre gardée dans l'adresse.
 */

test("anniversaire : jour et mois lus, jour ramené au dernier du mois, libellé dans les deux langues", () => {
  assert.deepEqual(birthdayParts("10-14"), { day: 14, month: 10 });
  assert.equal(birthdayParts("02-30"), null);
  assert.equal(birthdayParts(""), null);
  assert.equal(birthdayValue(14, 10), "10-14");
  assert.equal(birthdayValue(31, 4), "04-30", "31 avril ramené au 30");
  assert.equal(birthdayValue(29, 2), "02-29");
  assert.equal(birthdayValue(null, 4), "");
  assert.equal(birthdayLabel("10-14", "fr"), "14\u00a0octobre");
  assert.equal(birthdayLabel("05-01", "fr"), "1er\u00a0mai");
  assert.equal(birthdayLabel("10-14", "en"), "14 October");
  assert.equal(birthdayLabel("", "fr"), "");
  assert.equal(monthNames("fr")[0], "janvier");
  assert.equal(monthNames("en")[11], "December");
});

test("anniversaire aujourd'hui (jour de Douala) ; le 29 février fêté le 28 les années non bissextiles", () => {
  assert.ok(isBirthdayToday("10-04", "2026-10-04"));
  assert.ok(!isBirthdayToday("10-05", "2026-10-04"));
  assert.ok(isBirthdayToday("02-29", "2027-02-28"));
  assert.ok(!isBirthdayToday("02-29", "2028-02-28"), "2028 est bissextile");
  assert.ok(isBirthdayToday("02-29", "2028-02-29"));
  assert.ok(!isBirthdayToday("", "2026-10-04"));
});

test("saisie des étiquettes : virgule ou Entrée ajoute, doublons repliés ignorés, 30 caractères et 10 étiquettes au plus", () => {
  assert.deepEqual(parseTagInput("VIP, peau  sensible,ma", []), { tags: ["VIP", "peau sensible"], rest: "ma" });
  assert.deepEqual(parseTagInput("vip,", ["VIP"]), { tags: ["VIP"], rest: "" });
  assert.deepEqual(parseTagInput("Mariee,", ["Mariée"]), { tags: ["Mariée"], rest: "" });
  assert.deepEqual(parseTagInput(`${"x".repeat(35)},`, []), { tags: ["x".repeat(30)], rest: "" });
  const ten = Array.from({ length: 10 }, (_, i) => `E${i}`);
  assert.deepEqual(parseTagInput("onzième,", ten), { tags: ten, rest: "" });
  assert.deepEqual(parseTagInput(" , ,", []), { tags: [], rest: "" });
});

test("étiquettes proposées : celles qui contiennent la saisie, pas encore choisies ; lignes de la liste : deux puis « +N »", () => {
  const all = [{ tag: "VIP", count: 3 }, { tag: "Peau sensible", count: 2 }, { tag: "Mariée", count: 1 }];
  assert.deepEqual(tagSuggestions("ma", all, []), ["Mariée"]);
  assert.deepEqual(tagSuggestions("", all, ["vip"]), ["Peau sensible", "Mariée"]);
  assert.deepEqual(tagSuggestions("SENS", all, []), ["Peau sensible"]);
  assert.deepEqual(shownTags(["VIP", "Mariée", "Peau sensible", "Fidèle"]), { shown: ["VIP", "Mariée"], more: 2 });
  assert.deepEqual(shownTags(["VIP"]), { shown: ["VIP"], more: 0 });
});

test("ligne d'état : prochain rendez-vous d'abord, jamais venue, absente dès 1 jour, mise en avant au seuil", () => {
  assert.equal(DEFAULT_ABSENCE_DAYS, 60);
  const next = { id: 4, date: "2026-10-12", time: "10:00" };
  assert.deepEqual(absenceLine({ visits: 3, days_since: 80, next_appointment: next }), { kind: "next", date: "2026-10-12", time: "10:00" });
  assert.deepEqual(absenceLine({ visits: 0, days_since: null, next_appointment: null }), { kind: "never" });
  assert.equal(absenceLine({ visits: 2, days_since: 0, next_appointment: null }), null, "venue aujourd'hui");
  assert.deepEqual(absenceLine({ visits: 2, days_since: 59, next_appointment: null }), { kind: "absent", days: 59, over: false });
  assert.deepEqual(absenceLine({ visits: 2, days_since: 60, next_appointment: null }), { kind: "absent", days: 60, over: true });
  assert.deepEqual(absenceLine({ visits: 2, days_since: 20, next_appointment: null }, 15), { kind: "absent", days: 20, over: true });
  assert.deepEqual(absenceLine({ visits: 2, days_since: 80, next_appointment: null }, null), { kind: "absent", days: 80, over: false }, "seuil pas encore lu : ligne sans mise en avant");
  assert.deepEqual(absenceLine({ visits: 2, days_since: 80, next_appointment: null }, DEFAULT_ABSENCE_DAYS), { kind: "absent", days: 80, over: true }, "lecture échouée : seuil de 60");
  assert.equal(absenceText({ kind: "absent", days: 74, over: true }, "fr"), "Absente depuis 74\u00a0jours");
  assert.equal(absenceText({ kind: "absent", days: 1, over: false }, "fr"), "Absente depuis 1\u00a0jour");
  assert.equal(absenceText({ kind: "absent", days: 74, over: true }, "en"), "Away for 74 days");
  assert.equal(absenceText({ kind: "never" }, "fr"), "Pas encore venue");
  assert.equal(absenceText({ kind: "next", date: "2026-10-12", time: "10:00" }, "fr"), `Prochain rendez-vous le ${formatShortDate("2026-10-12", "fr")} à 10:00`);
});

test("chiffres clés : visites toujours, total et panier seulement quand le serveur les rend (jamais à la praticienne)", () => {
  assert.deepEqual(keyFigures({ visits: 8, total_spent: 128000, average_basket: 42667 }, "fr"), [
    { id: "visits", value: "8", label: "Visites" },
    { id: "spent", value: formatPrice(128000, "fr"), label: "Total dépensé" },
    { id: "basket", value: formatPrice(42667, "fr"), label: "Panier moyen" },
  ]);
  assert.deepEqual(keyFigures({ visits: 8 }, "en"), [{ id: "visits", value: "8", label: "Visits" }]);
});

test("chiffres clés : tuile « Points » seulement si la synthèse porte la fidélité (quatre tuiles pour la gérante)", () => {
  const loyalty = { balance: 1500, next_tier: null };
  assert.deepEqual(keyFigures({ visits: 8, total_spent: 128000, average_basket: 42667, loyalty }, "fr").map((f) => f.id), ["visits", "spent", "basket", "points"]);
  assert.deepEqual(keyFigures({ visits: 8, loyalty }, "en").at(-1), { id: "points", value: formatAmount(1500, "en"), label: "Points" });
  assert.equal(keyFigures({ visits: 8, loyalty: null }, "fr").some((f) => f.id === "points"), false);
});

test("étiquette du filtre dans l'adresse : lue, posée, retirée, autres paramètres et ancre gardés", () => {
  assert.equal(tagFromSearch("?etiquette=Peau+sensible"), "Peau sensible");
  assert.equal(tagFromSearch("?cliente=3"), "");
  assert.equal(withTagParam("/clientes?cliente=12", "Peau sensible"), "/clientes?cliente=12&etiquette=Peau+sensible");
  assert.equal(withTagParam("/clientes", "VIP"), "/clientes?etiquette=VIP");
  assert.equal(withTagParam("/clientes?etiquette=VIP&cliente=3#haut", ""), "/clientes?cliente=3#haut");
  assert.equal(withTagParam("/clients?etiquette=VIP", "Mariée"), "/clients?etiquette=Mari%C3%A9e");
});

test("numéro de carte à la caisse : trouvé dès 4 caractères (espaces, tirets, majuscules ignorés), choisi s'il est exact et unique", () => {
  assert.ok(cardMatches("lam-000 42", "LAM00042"));
  assert.ok(cardMatches("0004", "LAM00042"));
  assert.ok(!cardMatches("OC", "LAM00042"), "moins de 4 caractères");
  assert.ok(!cardMatches("LAM00042", null));
  const clients = [{ id: 1, card: "LAM00042" }, { id: 2, card: null }, { id: 3, card: "LAM00043" }];
  assert.equal(cardChoice("lam00042", clients), 1);
  assert.equal(cardChoice("LAM0004", clients), null, "partiel : pas de choix automatique");
  assert.equal(cardChoice("Aïcha", clients), null);
});
