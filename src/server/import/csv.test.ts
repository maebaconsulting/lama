import assert from "node:assert/strict";
import { test } from "node:test";
import { IMPORT_MAX_LIGNES } from "../../shared/import.ts";
import { decoderFichier, detecterSeparateur, lireCsv, lireTableau, MAX_ENREGISTREMENTS } from "./csv.ts";

const COLS = { obligatoires: ["nom", "telephone"], facultatives: ["notes"] } as const;

test("décodage : UTF-8 accepté et BOM retiré ; Windows-1252 (é = 0xE9) refusé", () => {
  assert.equal(decoderFichier(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xc3, 0xa9])), "Aé");
  assert.equal(decoderFichier(new Uint8Array([0x41, 0xe9])), null);
});

test("séparateur : `;` dès qu'il paraît dans l'en-tête hors guillemets, sinon `,`, sinon `;`", () => {
  assert.equal(detecterSeparateur("nom;telephone\nA,B;1"), ";");
  assert.equal(detecterSeparateur("nom,telephone\nA;B,1"), ",");
  assert.equal(detecterSeparateur('"nom;x",telephone'), ",");
  assert.equal(detecterSeparateur("nom"), ";");
});

test("guillemets RFC 4180 : séparateur, retour à la ligne et guillemet doublé dans un champ", () => {
  const r = lireCsv('a;b;c\r\n"x;y";"ligne 1\nligne 2";"il dit ""oui"""\r\n');
  assert.ok(r.ok);
  assert.deepEqual(r.enregistrements, [["a", "b", "c"], ["x;y", "ligne 1\nligne 2", 'il dit "oui"']]);
  const virgules = lireCsv('nom,notes\n"Dupont, Awa","a ""b"""\n');
  assert.ok(virgules.ok);
  assert.deepEqual(virgules.enregistrements, [["nom", "notes"], ["Dupont, Awa", 'a "b"']]);
});

test("fins de ligne Windows, Unix et Mac ; BOM retiré ; dernière ligne sans fin de ligne ; champ vide entre guillemets", () => {
  const r = lireCsv('\uFEFFa;b\r1;2\n3;4\r\n5;""');
  assert.ok(r.ok);
  assert.deepEqual(r.enregistrements, [["a", "b"], ["1", "2"], ["3", "4"], ["5", ""]]);
});

test("guillemet non fermé, ou texte collé après le guillemet fermant : fichier refusé, numéro de la ligne", () => {
  assert.deepEqual(lireCsv('a;b\n1;"2\n3;4'), { ok: false, erreur: { motif: "import.guillemets", valeurs: { ligne: 2 } } });
  assert.deepEqual(lireCsv('a;b\n1;2\n"3"x;4'), { ok: false, erreur: { motif: "import.guillemets", valeurs: { ligne: 3 } } });
});

test("en-tête : colonnes par leur nom, dans tout ordre, casse et espaces ignorés ; facultative absente lue vide", () => {
  const l = lireTableau(" Telephone ;NOM\n0600;Awa\n", COLS);
  assert.ok(l.ok);
  assert.deepEqual(l.tableau.colonnes, ["telephone", "nom"]);
  assert.deepEqual(l.tableau.lignes, [{ numero: 2, champs: { nom: "Awa", telephone: "0600", notes: "" } }]);
  assert.deepEqual(l.tableau.refusees, []);
  const virgules = lireTableau("nom,telephone\nAwa,0600", COLS);
  assert.ok(virgules.ok);
  assert.equal(virgules.tableau.lignes[0].champs.telephone, "0600");
});

test("en-tête fautif : colonne manquante, inconnue, en double ou sans nom ; fichier vide ou sans ligne", () => {
  assert.deepEqual(lireTableau("nom;notes\nA;B", COLS), { ok: false, erreur: { motif: "import.entete_manque", valeurs: { colonnes: "telephone" } } });
  assert.deepEqual(lireTableau("nom;telephone;age\nA;1;2", COLS), { ok: false, erreur: { motif: "import.entete_inconnue", valeurs: { colonne: "age", colonnes: "nom, telephone, notes" } } });
  assert.deepEqual(lireTableau("nom;telephone;nom\nA;1;B", COLS), { ok: false, erreur: { motif: "import.entete_double", valeurs: { colonne: "nom" } } });
  assert.deepEqual(lireTableau("nom;;telephone\nA;;1", COLS), { ok: false, erreur: { motif: "import.entete_vide", valeurs: { position: 2 } } });
  assert.deepEqual(lireTableau("", COLS), { ok: false, erreur: { motif: "import.vide" } });
  assert.deepEqual(lireTableau("nom;telephone\n;\n", COLS), { ok: false, erreur: { motif: "import.aucune_ligne" } });
});

test("lignes : vides ignorées, séparateurs en trop tolérés, nombre de champs faux refusé avec son numéro", () => {
  const l = lireTableau("nom;telephone;notes;;\nA;1;;;\n;;\nB\nC;3;x;y\n", COLS);
  assert.ok(l.ok);
  assert.deepEqual(l.tableau.lignes.map((x) => x.numero), [2]);
  assert.deepEqual(l.tableau.refusees, [
    { ligne: 4, motif: "import.colonnes", valeurs: { attendu: 3, lu: 1 } },
    { ligne: 5, motif: "import.colonnes", valeurs: { attendu: 3, lu: 4 } },
  ]);
});

test("ligne plus courte que l'en-tête : complétée si les colonnes manquantes sont facultatives, refusée sinon", () => {
  const l = lireTableau("nom;telephone;notes\nA;1\n", COLS);
  assert.ok(l.ok);
  assert.deepEqual(l.tableau.lignes, [{ numero: 2, champs: { nom: "A", telephone: "1", notes: "" } }]);
  assert.deepEqual(l.tableau.refusees, []);
  const obligatoire = lireTableau("nom;notes;telephone\nA;x\n", COLS);
  assert.ok(obligatoire.ok);
  assert.deepEqual(obligatoire.tableau.refusees, [{ ligne: 2, motif: "import.colonnes", valeurs: { attendu: 3, lu: 2 } }]);
});

test("en-tête : noms comparés sans accents ni majuscules («\u00a0Téléphone\u00a0», «\u00a0Nom\u00a0»)", () => {
  const l = lireTableau("Nom;Téléphone;NOTES\nA;1;x\n", COLS);
  assert.ok(l.ok);
  assert.deepEqual(l.tableau.colonnes, ["nom", "telephone", "notes"]);
  assert.equal(l.tableau.lignes[0].champs.telephone, "1");
});

test("limite : lecture arrêtée au-delà de 200 000 enregistrements bruts, lignes vides comprises", () => {
  // Résultat réduit à son motif : comparer 200 000 enregistrements ferait un rapport d'échec démesuré.
  const motif = (r: { ok: true } | { ok: false; erreur: { motif: string } }) => (r.ok ? "lu" : r.erreur.motif);
  assert.equal(motif(lireCsv(`nom;telephone\n${"\n".repeat(MAX_ENREGISTREMENTS)}`)), "import.trop_de_lignes");
  assert.equal(motif(lireTableau(`nom;telephone\nA;1\n${";\n".repeat(MAX_ENREGISTREMENTS)}`, COLS)), "import.trop_de_lignes");
  assert.equal(motif(lireCsv(`nom;telephone\n${"\n".repeat(MAX_ENREGISTREMENTS - 1)}`)), "lu");
});
