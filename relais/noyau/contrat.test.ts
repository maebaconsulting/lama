import assert from "node:assert/strict";
import { test } from "node:test";
import { Decision, DemandeEntrante, Disponibilites, Offre } from "./contrat.ts";

const texte = (fr: string, en = fr) => ({ fr, en });
const offre = () => ({
  version: 12,
  institut: {
    nom: "Institut Éclat", fuseau: "Africa/Douala", telephone: "+237600000000",
    devise: { code: "XAF", decimales: 0, symbole: "F", position: "apres" },
    langues: ["fr", "en"], texte_donnees: texte("Vos données servent à traiter votre demande.", "Your data is used to handle your request."),
  },
  prestations: [{ id: "s12", nom: texte("Soin visage éclat", "Radiance facial"), categorie: texte("Visage", "Face"), description: texte(""), duree: 60, prix: 25000 }],
  praticiennes: [{ id: "p3", prenom: "Awa", prestations: ["s12"] }],
});
const dispo = () => ({
  version: 3481, genere_le: 1792170000000, du: "2026-10-16", au: "2026-11-15", pas: 15, delai_minimal: 120,
  plages: { p3: { "2026-10-20": [["09:00", "12:30"], ["14:00", "19:00"]] } },
});
const demande = () => ({
  type: "creneau", prestation: "s12", praticienne: "p3", date: "2026-10-20", heure: "10:00", souhait: null,
  cliente: { nom: "Mireille Ngo", telephone: "+237699123456", langue: "fr" }, note: "",
});

test("offre : exemple de la spec accepté, champs facultatifs remplis par défaut, champ inconnu ignoré", () => {
  const r = Offre.safeParse({ ...offre(), inconnu: 1 });
  assert.ok(r.success, JSON.stringify(r.error?.issues));
  assert.equal(r.data.institut.logo, null);
  assert.equal(r.data.praticiennes[0].photo, null);
  assert.equal("inconnu" in r.data, false);
});

test("offre : prestation inconnue d'une praticienne, identifiant en double, prix nul, fuseau inconnu refusés", () => {
  const a = offre(); a.praticiennes[0].prestations = ["s99"];
  assert.equal(Offre.safeParse(a).success, false);
  const b = offre(); b.prestations.push({ ...b.prestations[0] });
  assert.equal(Offre.safeParse(b).success, false);
  const c = offre(); c.prestations[0].prix = 0;
  assert.equal(Offre.safeParse(c).success, false);
  const d = offre(); d.institut.fuseau = "Mars/Olympe";
  assert.equal(Offre.safeParse(d).success, false);
});

test("offre : logo de plus de 200 ko refusé, petit logo accepté", () => {
  const gros = { ...offre(), institut: { ...offre().institut, logo: `data:image/png;base64,${"A".repeat(280_000)}` } };
  assert.equal(Offre.safeParse(gros).success, false);
  const petit = { ...offre(), institut: { ...offre().institut, logo: "data:image/png;base64,iVBORw0KGgo=" } };
  assert.equal(Offre.safeParse(petit).success, true);
});

test("offre vide acceptée (réservation momentanément indisponible)", () => {
  assert.equal(Offre.safeParse({ ...offre(), prestations: [], praticiennes: [] }).success, true);
});

test("plages : exemple de la spec accepté ; plage à l'envers, date hors de du..au, 24:00 refusés", () => {
  assert.equal(Disponibilites.safeParse(dispo()).success, true);
  const a = dispo(); a.plages.p3["2026-10-20"] = [["12:00", "09:00"]];
  assert.equal(Disponibilites.safeParse(a).success, false);
  const b = dispo(); (b.plages.p3 as Record<string, string[][]>)["2026-12-01"] = [["09:00", "10:00"]];
  assert.equal(Disponibilites.safeParse(b).success, false);
  const c = dispo(); c.plages.p3["2026-10-20"] = [["09:00", "24:00"]];
  assert.equal(Disponibilites.safeParse(c).success, false);
  assert.equal(Disponibilites.safeParse({ ...dispo(), du: "2026-11-20" }).success, false);
});

test("plages : horizon de 92 jours au plus de du à au", () => {
  const plages = {};
  assert.equal(Disponibilites.safeParse({ ...dispo(), plages, du: "2026-10-16", au: "2027-01-16" }).success, true, "92 jours");
  const trop = Disponibilites.safeParse({ ...dispo(), plages, du: "2026-10-16", au: "2027-01-17" });
  assert.equal(trop.success, false, "93 jours");
  assert.deepEqual(trop.error?.issues.map((i) => i.path), [["au"]]);
  assert.equal(Disponibilites.safeParse({ ...dispo(), plages, du: "2026-10-16", au: "2026-13-01" }).success, false, "date invalide refusée sans erreur");
});

test("demande : créneau sans heure, rappel sans souhait, téléphone non E.164 refusés", () => {
  assert.equal(DemandeEntrante.safeParse(demande()).success, true);
  assert.equal(DemandeEntrante.safeParse({ ...demande(), heure: null }).success, false);
  assert.equal(DemandeEntrante.safeParse({ ...demande(), type: "rappel", date: null, heure: null }).success, false);
  assert.equal(DemandeEntrante.safeParse({ ...demande(), type: "rappel", date: null, heure: null, souhait: { jours: ["lun"], moments: ["matin"], precision: "" } }).success, true);
  assert.equal(DemandeEntrante.safeParse({ ...demande(), cliente: { ...demande().cliente, telephone: "699123456" } }).success, false);
  assert.equal(DemandeEntrante.safeParse({ ...demande(), cliente: { ...demande().cliente, nom: "   " } }).success, false);
});

test("décision : autre horaire sans horaire refusé ; refus minimal accepté avec horaire et message nuls", () => {
  assert.equal(Decision.safeParse({ decision: "autre_horaire" }).success, false);
  const r = Decision.safeParse({ decision: "refusee" });
  assert.ok(r.success);
  assert.deepEqual(r.data, { decision: "refusee", horaire: null, message: null });
  assert.equal(Decision.safeParse({ decision: "autre_horaire", horaire: { date: "2026-10-21", heure: "11:00", praticienne: "Awa" } }).success, true);
  assert.equal(Decision.safeParse({ decision: "annulee" }).success, false);
});

const THEME = { fond: "#F3EDE3", accent: "#141312", police: "elegante" };
const JOUR = [["09:00", "20:00"]];
const SOIR = [["09:30", "22:00"]];
const HORAIRES = { lun: JOUR, mar: JOUR, mer: JOUR, jeu: JOUR, ven: SOIR, sam: SOIR, dim: [] };
const avecInstitut = (champs: Record<string, unknown>) => ({ ...offre(), institut: { ...offre().institut, ...champs } });

test("offre : thème et horaires facultatifs ; absents, ils restent absents", () => {
  const sans = Offre.safeParse(offre());
  assert.ok(sans.success);
  assert.equal("theme" in sans.data.institut, false);
  assert.equal("horaires" in sans.data.institut, false);
  const avec = Offre.safeParse(avecInstitut({ theme: THEME, horaires: HORAIRES }));
  assert.ok(avec.success, JSON.stringify(avec.error?.issues));
  assert.deepEqual(avec.data.institut.theme, THEME);
  assert.deepEqual(avec.data.institut.horaires?.ven, [["09:30", "22:00"]]);
});

test("offre : thème refusé pour une couleur mal formée, une police inconnue ou un accent trop proche du fond", () => {
  for (const theme of [{ ...THEME, fond: "F3EDE3" }, { ...THEME, accent: "#14131" }, { ...THEME, police: "gothique" }]) {
    assert.equal(Offre.safeParse(avecInstitut({ theme })).success, false, JSON.stringify(theme));
  }
  const proche = Offre.safeParse(avecInstitut({ theme: { ...THEME, accent: "#E0D5C5" } }));
  assert.equal(proche.success, false);
  assert.match(JSON.stringify(proche.error?.issues), /3:1/);
});

test("offre : horaires refusés si un jour manque, plus de deux plages ou une plage à l'envers", () => {
  const { dim: _dim, ...sansDimanche } = HORAIRES;
  for (const horaires of [sansDimanche, { ...HORAIRES, lun: [["08:00", "10:00"], ["11:00", "12:00"], ["13:00", "14:00"]] }, { ...HORAIRES, mar: [["20:00", "09:00"]] }]) {
    assert.equal(Offre.safeParse(avecInstitut({ horaires })).success, false, JSON.stringify(horaires));
  }
});

test("cliente.nom : une seule ligne de 1 à 8 mots de lettres, sinon 422 ; noms d'ici acceptés", () => {
  const avec = (nom: string) => DemandeEntrante.safeParse({ ...demande(), cliente: { ...demande().cliente, nom } });
  for (const nom of ["Ngo Bassa Mireille", "N'Dri Kouassi", "N’Dri Kouassi", "Marie-Claire Ébodé", "Jean P. Ngo"]) assert.ok(avec(nom).success, nom);
  const huitMots = "a b c d e f g h";
  assert.ok(avec(huitMots).success, "8 mots");
  for (const nom of ["appelez\nle +237 6xx", "www.x.com", "http://x.cm", "Awa\u202eNgo", "Awa\u200bNgo", "Awa  Ngo", "Awa 2", "x@exemple.cm", ".", `${huitMots} i`, `${"a".repeat(60)} ${"b".repeat(60)}`]) {
    assert.equal(avec(nom).success, false, JSON.stringify(nom));
  }
});

test("cliente : prénom facultatif (ajout du 18/10/2026), vide ou trop long refusé ; champ inconnu ignoré", () => {
  const avec = DemandeEntrante.safeParse({ ...demande(), cliente: { ...demande().cliente, prenom: " Mireille " } });
  assert.ok(avec.success, JSON.stringify(avec.error?.issues));
  assert.equal(avec.data.cliente.prenom, "Mireille");
  const sans = DemandeEntrante.safeParse(demande());
  assert.ok(sans.success);
  assert.equal("prenom" in sans.data.cliente, false, "absent, il reste absent");
  assert.equal(DemandeEntrante.safeParse({ ...demande(), cliente: { ...demande().cliente, prenom: "  " } }).success, false);
  assert.equal(DemandeEntrante.safeParse({ ...demande(), cliente: { ...demande().cliente, prenom: "x".repeat(61) } }).success, false);
  for (const prenom of ["appelez\nle +237 6xx", "www.x.com", "http://x.cm", "Awa2", "Marie Claire Anne Ngo", "Awa  Ndiaye"]) {
    assert.equal(DemandeEntrante.safeParse({ ...demande(), cliente: { ...demande().cliente, prenom } }).success, false, JSON.stringify(prenom));
  }
  for (const prenom of ["Marie-Claire", "N'Dri", "N’Dri", "Ngo Bassa"]) {
    assert.equal(DemandeEntrante.safeParse({ ...demande(), cliente: { ...demande().cliente, prenom } }).success, true, prenom);
  }
  const futur = DemandeEntrante.safeParse({ ...demande(), cliente: { ...demande().cliente, champ_futur: 1 }, champ_futur: 1 });
  assert.ok(futur.success, "un champ ajouté plus tard ne fait jamais refuser une demande");
});

test("décision : issue facultative d'un rappel clos (ajout du 18/10/2026), absente pour un lama plus ancien", () => {
  const r = Decision.safeParse({ decision: "traitee", issue: "sans_suite" });
  assert.ok(r.success);
  assert.equal(r.data.issue, "sans_suite");
  const ancien = Decision.safeParse({ decision: "traitee" });
  assert.ok(ancien.success);
  assert.equal(ancien.data.issue, undefined);
  assert.equal(Decision.safeParse({ decision: "traitee", issue: "oubliee" }).success, false);
  assert.ok(Decision.safeParse({ decision: "acceptee", champ_futur: true }).success, "champ inconnu ignoré");
});
