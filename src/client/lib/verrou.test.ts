import assert from "node:assert/strict";
import { test } from "node:test";
import { creerVerrou } from "./verrou.ts";

/** Verrou d'envoi (passe V 1.0, vague C) : un double appui ne part qu'une fois. */

/** Promesse réglable à la main, pour tenir une requête « en vol ». */
function attente() {
  let regler!: () => void;
  let refuser!: (e: Error) => void;
  const promesse = new Promise<void>((ok, ko) => { regler = ok; refuser = ko; });
  return { promesse, regler, refuser };
}

test("double appui sur la même clé : une seule requête, le second appel rend false", async () => {
  const verrou = creerVerrou();
  const vol = attente();
  let appels = 0;
  const action = () => { appels += 1; return vol.promesse; };
  const premier = verrou.lancer("suppression", action);
  const second = await verrou.lancer("suppression", action);
  assert.equal(second, false, "le second appui est ignoré");
  assert.equal(verrou.occupe("suppression"), true);
  vol.regler();
  assert.equal(await premier, true);
  assert.equal(appels, 1, "une seule requête");
  assert.equal(verrou.occupe("suppression"), false);
});

test("clés différentes : elles partent en parallèle (une ligne n'en bloque pas une autre)", async () => {
  const verrou = creerVerrou();
  const a = attente();
  const b = attente();
  const pa = verrou.lancer("12", () => a.promesse);
  const pb = verrou.lancer("13", () => b.promesse);
  assert.equal(verrou.occupe("12"), true);
  assert.equal(verrou.occupe("13"), true);
  a.regler();
  b.regler();
  assert.deepEqual(await Promise.all([pa, pb]), [true, true]);
});

test("refus de l'API : l'erreur remonte à l'appelant et la clé se libère, un nouvel appui repart", async () => {
  const verrou = creerVerrou();
  const vol = attente();
  const lance = verrou.lancer("delai", () => vol.promesse);
  vol.refuser(new Error("Créneau introuvable."));
  await assert.rejects(lance, /Créneau introuvable\./);
  assert.equal(verrou.occupe("delai"), false);
  assert.equal(await verrou.lancer("delai", async () => undefined), true);
});

test("onChange reçoit les clés en cours, à l'entrée et à la sortie", async () => {
  const vus: string[][] = [];
  const verrou = creerVerrou((enCours) => vus.push([...enCours]));
  await verrou.lancer("declarer", async () => undefined);
  assert.deepEqual(vus, [["declarer"], []]);
});
