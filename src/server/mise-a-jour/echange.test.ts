import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { demandeEnAttente, ecrireDemande, ecrireMode, lireEtat, mecanismePose } from "./echange.ts";

/** Dossier d'échange avec le service root (spec du 21/10/2026, M-8, M-11) : ce que lama écrit et ce qu'il accepte de lire. */

const ETAT = { operation: "1761000000-42", version_cible: "1.2.0", etape: "controle", resultat: null, motif: null, debut: 1761000000000, fin: null, version_precedente: "1.1.0" };
const dossier = () => mkdtempSync(join(tmpdir(), "lama-echange-"));

test("etat.json : lu tel que l'écrit le service root (M-8)", () => {
  const d = dossier();
  writeFileSync(join(d, "etat.json"), `${JSON.stringify(ETAT)}\n`);
  assert.deepEqual(lireEtat(d), ETAT);
  const fini = { ...ETAT, etape: "termine", resultat: "echec", motif: "demarrage", fin: 1761000300000, version_cible: null };
  writeFileSync(join(d, "etat.json"), JSON.stringify(fini));
  assert.deepEqual(lireEtat(d), fini);
});

test("etat.json malformé, géant, lien, dossier ou absent : null, rien ne casse (M-17)", () => {
  const d = dossier();
  assert.equal(lireEtat(d), null, "absent");
  for (const contenu of [
    "{", "[]", "null", "\"texte\"", JSON.stringify({ ...ETAT, etape: "pirate" }), JSON.stringify({ ...ETAT, motif: "autre" }),
    JSON.stringify({ ...ETAT, resultat: "peut-etre" }), JSON.stringify({ ...ETAT, version_cible: "../x" }), JSON.stringify({ ...ETAT, debut: -1 }),
    JSON.stringify({ ...ETAT, debut: null }), JSON.stringify({ ...ETAT, fin: "demain" }), JSON.stringify({ ...ETAT, operation: "x" }),
    JSON.stringify({ ...ETAT, version_precedente: 3 }), `${JSON.stringify(ETAT)}${" ".repeat(5000)}`,
  ]) {
    writeFileSync(join(d, "etat.json"), contenu);
    assert.equal(lireEtat(d), null, contenu.slice(0, 60));
  }
  const ailleurs = join(dossier(), "etat.json");
  writeFileSync(ailleurs, JSON.stringify(ETAT));
  const avecLien = dossier();
  symlinkSync(ailleurs, join(avecLien, "etat.json"));
  assert.equal(lireEtat(avecLien), null, "lien jamais suivi");
  const avecDossier = dossier();
  mkdirSync(join(avecDossier, "etat.json"));
  assert.equal(lireEtat(avecDossier), null, "dossier");
});

test("demande et mode : écrits d'un seul geste, au format lu par le service root (M-8, M-13)", () => {
  const d = dossier();
  assert.equal(demandeEnAttente(d), false);
  ecrireDemande(d, "1.2.0");
  assert.equal(readFileSync(join(d, "demande.json"), "utf8"), "{\"version\":\"1.2.0\"}\n");
  assert.equal(demandeEnAttente(d), true);
  assert.throws(() => ecrireDemande(d, "1.2.0\",\"url\":\"x"), /Version invalide/);
  ecrireMode(d, "automatique");
  ecrireMode(d, "manuel");
  assert.equal(readFileSync(join(d, "mode"), "utf8"), "manuel\n");
  assert.deepEqual(readdirSync(d).sort(), ["demande.json", "mode"], "aucun fichier temporaire laissé");
});

test("mécanisme posé : le dossier d'échange existe et n'est pas un lien (M-11, M-16)", () => {
  const d = dossier();
  assert.equal(mecanismePose(d), true);
  assert.equal(mecanismePose(join(d, "absent")), false);
  const lien = join(dossier(), "lien");
  symlinkSync(d, lien);
  assert.equal(mecanismePose(lien), false);
});
