import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apresHeure, apresRefus, cleEtatSuivi, formatDuree, formatPrix, indicatifDe, jetonDepuisAncre, joursAffiches, langueInitiale, libelleDate,
  libelleDateLong, lienSuivi, modeRappel, parCategorie, premierJour, prestationDepuisAdresse, salonDepuisChemin, texteRecu, versE164, type Prestation, type Vitrine,
} from "./parcours.ts";
import { t } from "./textes.ts";

const XAF = { code: "XAF", decimales: 0, symbole: "F", position: "apres" as const };
const EUR = { code: "EUR", decimales: 2, symbole: "€", position: "avant" as const };
const prestation = (id: string, categorie: string): Prestation =>
  ({ id, nom: { fr: id, en: id }, categorie: { fr: categorie, en: `${categorie} (en)` }, description: { fr: "", en: "" }, duree: 30, prix: 1000 });

test("prestations groupées par catégorie, dans l'ordre de l'offre", () => {
  const g = parCategorie([prestation("a", "Visage"), prestation("b", "Mains"), prestation("c", "Visage")], "fr");
  assert.deepEqual(g.map((x) => [x.categorie, x.prestations.map((p) => p.id)]), [["Visage", ["a", "c"]], ["Mains", ["b"]]]);
  assert.equal(parCategorie([prestation("a", "Visage")], "en")[0].categorie, "Visage (en)");
});

test("prix dans la devise de l'institut, durée lisible", () => {
  assert.equal(formatPrix(25000, XAF, "fr"), "25\u202f000\u00a0F");
  assert.equal(formatPrix(25000, XAF, "en"), "25,000\u00a0F");
  assert.equal(formatPrix(1550, EUR, "fr"), "€15,50");
  assert.equal(formatPrix(1550, EUR, "en"), "€15.50");
  assert.equal(formatDuree(30, "fr"), "30\u00a0min");
  assert.equal(formatDuree(60, "fr"), "1\u00a0h");
  assert.equal(formatDuree(90, "en"), "1\u00a0h\u00a030");
});

test("libellés de date, sans effet du fuseau de l'appareil", () => {
  assert.deepEqual(libelleDate("2026-10-20", "fr"), { jour: "mar.", numero: "20", mois: "oct." });
  assert.deepEqual(libelleDate("2026-10-20", "en"), { jour: "Tue", numero: "20", mois: "Oct" });
  assert.equal(libelleDateLong("2026-10-20", "fr"), "mardi 20 octobre");
  assert.equal(libelleDateLong("2026-10-20", "en"), "Tuesday, October 20");
});

test("bandeau des dates : d'aujourd'hui (ou du début des plages) à la fin des plages", () => {
  const v = { aujourdhui: "2026-10-20", du: "2026-10-19", au: "2026-10-23" } as Vitrine;
  assert.equal(premierJour(v), "2026-10-20");
  assert.equal(premierJour({ ...v, du: "2026-10-22" }), "2026-10-22");
  assert.deepEqual(joursAffiches("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.equal(joursAffiches("2026-01-01", "2026-12-31").length, 62);
});

test("téléphone saisi à la main converti au format international, ou refusé", () => {
  assert.equal(indicatifDe("+237600000000"), "+237");
  assert.equal(indicatifDe("+33 1 23 45 67 89"), "+33");
  assert.equal(indicatifDe("+15145550000"), "+1");
  assert.equal(indicatifDe(""), null);
  assert.equal(versE164("699 12 34 56", "+237"), "+237699123456");
  assert.equal(versE164("06.12.34.56.78", "+33"), "+33612345678");
  assert.equal(versE164("00237 699-12-34-56", "+33"), "+237699123456");
  assert.equal(versE164("+237 (699) 12 34 56", null), "+237699123456");
  assert.equal(versE164("699123456", null), null);
  assert.equal(versE164("12", "+237"), null);
  assert.equal(versE164("six neuf neuf", "+237"), null);
  assert.equal(versE164("237 699 12 34 56", "+237"), "+237699123456");
  assert.equal(versE164("+237 0699123456", "+237"), "+237699123456");
  assert.equal(versE164("+33 (0)6 12 34 56 78", "+33"), "+33612345678");
  assert.equal(versE164("0699123456", "+237"), "+237699123456");
  assert.equal(versE164("6991234567", "+237"), null);
  assert.equal(versE164("69912345", "+237"), null);
  assert.equal(versE164("+15145550000", "+237"), "+15145550000");
});

test("langue de départ : paramètre de l'adresse, puis navigateur, puis français", () => {
  assert.equal(langueInitiale(["fr", "en"], "en-GB", null), "en");
  assert.equal(langueInitiale(["fr", "en"], "fr-CM", null), "fr");
  assert.equal(langueInitiale(["fr", "en"], "de-DE", null), "fr");
  assert.equal(langueInitiale(["en"], "fr-FR", null), "en");
  assert.equal(langueInitiale(["fr", "en"], "fr-FR", "en"), "en");
  assert.equal(langueInitiale(["fr", "en"], "fr-FR", "xx"), "fr");
});

test("après le choix de l'heure : praticienne du filtre « Avec », sinon « Sans préférence », jamais une seconde question", () => {
  assert.deepEqual(apresHeure("p1"), { etape: "coordonnees", praticienne: "p1" });
  assert.deepEqual(apresHeure(null), { etape: "coordonnees", praticienne: null });
});

test("suivi : rappel clos « Sans suite » dit « close » ; autres issues et lama plus ancien gardent leur texte", () => {
  assert.equal(cleEtatSuivi({ etat: "traitee", issue: "sans_suite" }), "suivi.close");
  assert.equal(cleEtatSuivi({ etat: "traitee", issue: "injoignable" }), "suivi.traitee");
  assert.equal(cleEtatSuivi({ etat: "traitee", issue: "rdv_pris" }), "suivi.traitee");
  assert.equal(cleEtatSuivi({ etat: "traitee", issue: null }), "suivi.traitee");
  assert.equal(cleEtatSuivi({ etat: "traitee" }), "suivi.traitee", "réponse sans champ issue");
  assert.equal(cleEtatSuivi({ etat: "confirmee", issue: null }), "suivi.confirmee");
  assert.equal(t("fr", "suivi.close"), "Votre demande est close");
  assert.equal(t("fr", "suivi.traitee"), "L'institut vous a contactée");
});

test("refus du serveur : retour à l'étape utile, jamais d'écran sans issue", () => {
  assert.deepEqual(apresRefus("indisponible"), { etape: "horaire", message: "refus.indisponible" });
  assert.deepEqual(apresRefus("rappel_seulement"), { etape: "rappel", message: "refus.rappel_seulement" });
  assert.deepEqual(apresRefus("ferme"), { etape: "prestation", message: "refus.ferme" });
  assert.deepEqual(apresRefus("inconnue"), { etape: "prestation", message: "refus.inconnue" });
  assert.deepEqual(apresRefus("trop_de_demandes"), { etape: "coordonnees", message: "refus.trop_ip" });
  assert.deepEqual(apresRefus("introuvable"), { etape: "sans_salon", message: "page.sans_salon" });
  assert.deepEqual(apresRefus("trop_de_demandes_telephone"), { etape: "coordonnees", message: "refus.trop" });
  assert.deepEqual(apresRefus("verification"), { etape: "coordonnees", message: "refus.verification" });
  assert.deepEqual(apresRefus("donnees_invalides"), { etape: "coordonnees", message: "refus.autre" });
  assert.deepEqual(apresRefus("corps_trop_gros"), { etape: "coordonnees", message: "refus.autre" });
});

test("recours « Être rappelée » : plages trop anciennes ou aucun jour libre", () => {
  assert.equal(modeRappel("rappel", ["2026-10-21"]), true);
  assert.equal(modeRappel("ouvert", []), true);
  assert.equal(modeRappel("ouvert", ["2026-10-21"]), false);
});

test("salon de la page : premier segment de l'adresse, adresses du relais exclues", () => {
  assert.equal(salonDepuisChemin("/eclat/"), "eclat");
  assert.equal(salonDepuisChemin("/eclat"), "eclat");
  assert.equal(salonDepuisChemin("/institut-eclat-2/"), "institut-eclat-2");
  assert.equal(salonDepuisChemin("/"), null);
  assert.equal(salonDepuisChemin(""), null);
  assert.equal(salonDepuisChemin("/gestion/"), null);
  assert.equal(salonDepuisChemin("/api/x"), null);
  assert.equal(salonDepuisChemin("/Eclat/"), null);
  assert.equal(salonDepuisChemin("/-eclat/"), null);
});

test("lien de suivi dans l'ancre de l'adresse, jeton relu", () => {
  assert.equal(lienSuivi("https://reserver.exemple.com/eclat/", "abc_-1"), "https://reserver.exemple.com/eclat/#suivi=abc_-1");
  assert.equal(jetonDepuisAncre("#suivi=abc_-1"), "abc_-1");
  assert.equal(jetonDepuisAncre("#suivi=a<b"), null);
  assert.equal(jetonDepuisAncre(""), null);
});

test("« Demande reçue » : « dès l'ouverture » quand l'institut est fermé à l'instant du dépôt", () => {
  assert.equal(texteRecu(false, false), "recu.creneau");
  assert.equal(texteRecu(false, true), "recu.ouverture");
  assert.equal(texteRecu(true, false), "recu.rappel");
  assert.equal(texteRecu(true, true), "recu.rappel_ouverture");
  assert.equal(t("fr", "recu.ouverture"), "Dès l'ouverture, nous vérifions la disponibilité et revenons vers vous pour confirmer votre rendez-vous.");
  assert.equal(t("en", "recu.rappel_ouverture"), "The institute will call you back as soon as it opens.");
});

test("prestation choisie d'avance par l'adresse : seulement si l'offre la propose encore", () => {
  const offre = [prestation("s12", "Visage"), prestation("s30", "Mains")];
  assert.equal(prestationDepuisAdresse("?prestation=s30", offre)?.id, "s30");
  assert.equal(prestationDepuisAdresse("?lang=en&prestation=s12", offre)?.id, "s12");
  assert.equal(prestationDepuisAdresse("?prestation=s99", offre), null, "retirée de l'offre : la liste");
  assert.equal(prestationDepuisAdresse("", offre), null);
  assert.equal(prestationDepuisAdresse("?prestation=", offre), null);
  assert.equal(prestationDepuisAdresse("?prestation=s12", []), null);
});
