import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { blockLabelKey } from "../lib/agenda.ts";
import { DICTIONARIES, translate, type Key } from "./translate.ts";

/** Vague D de la passe V 1.0 : textes français et anglais (décisions 11 à 13). */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const fr = DICTIONARIES.fr;
const en = DICTIONARIES.en;
const keys = Object.keys(fr) as Key[];

test("V1-30 : délier WhatsApp ne s'appelle plus « Se déconnecter »", () => {
  assert.equal(fr["whatsapp.deconnecter"], "Délier le téléphone");
  assert.equal(en["whatsapp.deconnecter"], "Unlink the phone");
  assert.deepEqual(keys.filter((k) => fr[k] === "Se déconnecter"), ["menu.deconnexion"]);
  assert.deepEqual(keys.filter((k) => en[k] === "Sign out"), ["menu.deconnexion"]);
});

test("V1-31 : « Praticienne » à la prise, au déplacement et sur la fiche d'un rendez-vous", () => {
  assert.equal(fr["rdv.praticienne"], "Praticienne");
  assert.equal(en["rdv.praticienne"], "Practitioner");
  for (const file of ["../components/create-appointment.tsx", "../components/reschedule-appointment.tsx", "../components/appointment-detail.tsx"]) {
    const src = read(file);
    assert.match(src, /t\("rdv\.praticienne"\)/, file);
    assert.doesNotMatch(src, /t\("colonne\.membre"\)/, file);
  }
});

test("V1-32 : la note d'une cliente porte le même nom à la création et dans la fiche", () => {
  assert.match(read("../components/create-client.tsx"), /<Label htmlFor="nc-notes-cliente">\{t\("cliente\.note"\)\}<\/Label>/);
});

test("V1-33 : le libellé du champ d'envoi d'un produit n'est pas un texte d'exemple", () => {
  assert.equal(fr["whatsapp.chercher_produit"], "Rechercher un produit");
  assert.equal(en["whatsapp.chercher_produit"], "Search for a product");
  assert.match(read("../components/produits/envoi-produit.tsx"), /t\(chercheProduit \? "whatsapp\.chercher_produit" : "whatsapp\.chercher_cliente"\)/);
});

test("V1-34 : nom lu d'un bloc sans cliente, sans virgule double, dans les deux langues", () => {
  const values = { plage: "09:00 - 10:00", cliente: "", statut: "Réservé" };
  assert.equal(blockLabelKey(false, "Aïcha"), "agenda.bloc_rdv");
  assert.equal(blockLabelKey(true, "Aïcha"), "agenda.bloc_rdv_retard");
  assert.equal(blockLabelKey(false, null), "agenda.bloc_rdv_sans_cliente");
  assert.equal(blockLabelKey(true, "  "), "agenda.bloc_rdv_sans_cliente_retard");
  assert.equal(translate("fr", blockLabelKey(false, ""), values), "09:00 - 10:00, Réservé");
  assert.equal(translate("fr", blockLabelKey(true, null), values), "09:00 - 10:00, Réservé, en retard");
  assert.equal(translate("en", blockLabelKey(true, null), { ...values, statut: "Booked" }), "09:00 - 10:00, Booked, late");
  for (const lang of ["fr", "en"] as const) {
    for (const late of [false, true]) assert.doesNotMatch(translate(lang, blockLabelKey(late, null), values), /, ,/);
  }
  assert.match(read("../components/agenda/grille.tsx"), /aria-label=\{t\(blockLabelKey\(tone === "retard", apt\.client_name\), \{ plage, cliente: apt\.client_name \?\? "", statut \}\)\}/);
});

test("V1-35 : la charte écrit « Échelle » et les milliers comme le reste de la charte", () => {
  const charte = read("../components/charte.tsx");
  assert.match(charte, /\{"Échelle\\u00a0: 0,75/);
  assert.doesNotMatch(charte, /Échelle :/, "espace ordinaire avant le deux-points");
  assert.doesNotMatch(charte, />\s*(?:25|12) 000\s*</, "milliers sans espace fine insécable");
  assert.equal((charte.match(/\{"25\\u202f000"\}/g) ?? []).length, 2);
  assert.match(charte, /\{"12\\u202f000"\}/);
});

test("V1-36 : le nombre ne reste jamais seul en fin de ligne", () => {
  assert.equal(fr["commun.nb_rdv.one"], "{count}\u00a0rendez-vous");
  assert.equal(fr["commun.nb_rdv.other"], "{count}\u00a0rendez-vous");
  assert.equal(fr["produit.en_stock"], "{stock}\u00a0en stock");
});

test("V1-37 : apostrophe droite partout, point final à tous les états vides", () => {
  for (const file of ["./fr.ts", "./en.ts"]) assert.ok(!read(file).includes("\u2019"), `${file} : apostrophe courbe`);
  const etatsVides: Key[] = [
    "tableau.aucun_rdv", "rdv.aucun", "rdv.aucune_note", "cliente.aucune", "cliente.aucun_rdv", "cliente.aucune_encore", "cliente.aucune_facture",
    "equipe.aucun", "prestation.aucune", "prestation.aucune_trouvee", "produit.aucun", "produit.aucun_encore",
  ];
  for (const key of etatsVides) {
    for (const lang of ["fr", "en"] as const) assert.ok(DICTIONARIES[lang][key].endsWith("."), `${lang}.${key} sans point final`);
  }
});

test("V1-38 : « appointment », jamais « booking »", () => {
  assert.deepEqual(keys.filter((k) => /booking/i.test(en[k])), []);
  assert.equal(en["agenda.nouveau_rdv"], "New appointment");
  assert.equal(en["rdv.creer"], "Create appointment");
  assert.equal(en["rdv.deplacer_titre"], "Reschedule appointment");
});

test("V1-39 à V1-43 : touche « Clear », « Charged by », « Job title », « Edit », tournures", () => {
  assert.equal(en["poste.effacer"], "Clear");
  assert.equal(en["facture.encaisse_par"], "Charged by");
  assert.deepEqual(keys.filter((k) => /Role in/.test(en[k])), []);
  assert.equal(en["donnee.fonction_fr"], "Job title in French");
  assert.equal(en["donnee.fonction_en"], "Job title in English (optional)");
  assert.equal(en["cliente.modifier_titre"], "Edit client");
  assert.equal(en["prestation.modifier_titre"], "Edit service");
  assert.equal(en["produit.modifier_titre"], "Edit product");
  assert.equal(en["cliente.langue_messages"], "Message language");
  assert.equal(en["cliente.canal"], "Send messages via");
  assert.equal(en["fidelite.sens"], "Add or remove");
  assert.equal(en["accueil.groupe_a_traiter"], "Needs attention");
  assert.equal(en["calendrier.ouvrir"], "Choose a date");
  assert.equal(en["journee.voir_agenda"], "View the team calendar");
  assert.match(en["journee.sans_fiche"], /staff record/);
});

test("V1-44 : le document remis à la cliente s'appelle « receipt », jamais « ticket »", () => {
  const documents: Key[] = [
    "caisse.imprimer_ticket", "caisse.envoyer_whatsapp", "caisse.preparation_ticket", "caisse.ticket_pdf",
    "a_envoyer.type.ticket", "whatsapp.texte.ticket.fr", "whatsapp.texte.ticket.en",
  ];
  for (const key of documents) {
    assert.doesNotMatch(en[key], /ticket/i, key);
    assert.match(en[key], /receipt/i, key);
  }
});

test("V1-45 : « follow-up » pour les relances, « reminder » réservé au rappel de rendez-vous", () => {
  assert.deepEqual(keys.filter((k) => /relance/i.test(fr[k]) && /remind/i.test(en[k])), []);
  assert.equal(en["relances.titre"], "Follow-up messages");
  assert.match(en["whatsapp.texte.rappel.fr"], /Reminder/, "le rappel de rendez-vous garde « reminder »");
});

test("V1-46 : « Planning du jour de l'équipe »", () => {
  assert.equal(fr["agenda.planning"], "Planning du jour de l'équipe");
});

test("compte d'un nom qui commence par une voyelle : jamais « Compte de Administrateur » (vérification au navigateur)", () => {
  for (const nom of ["Administrateur", "Ève Ondoa", "Grace Nkoulou"]) {
    for (const key of ["comptes.compte_de", "comptes.cree", "comptes.modifie"] as const) {
      const text = translate("fr", key, { nom });
      assert.ok(text.includes(nom), `${key} : ${text}`);
      assert.doesNotMatch(text, /\bde (?=[A-ZÉÈÊa-zéèê])/, `${key} sans « de + nom » : ${text}`);
    }
  }
  assert.equal(translate("fr", "comptes.compte_de", { nom: "Administrateur" }), "Compte\u00a0: Administrateur");
  assert.equal(translate("en", "comptes.compte_de", { nom: "Administrateur" }), "Account: Administrateur");
});
