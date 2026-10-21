import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Écrans WhatsApp (sous-projet 7), vérifiés par la source (pas de DOM dans
 * ces tests) ; les règles sont testées en exécution dans `lib/whatsapp.test.ts`.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Connexions (administrateur) : fournisseur, risque de WAHA en une phrase, clé jamais relue, état et QR", () => {
  const connexions = read("./connexions.tsx");
  assert.match(connexions, /<FournisseurWhatsapp \/>\s*<EtatWhatsapp \/>/);
  assert.doesNotMatch(connexions, /whatsapp_a_venir/);
  const fournisseur = read("./fournisseur-whatsapp.tsx");
  assert.match(fournisseur, /aria-describedby="whatsapp-risque"/);
  assert.match(fournisseur, /t\("whatsapp\.risque"\)/);
  assert.match(fournisseur, /type="password"/);
  assert.match(fournisseur, /if \(cle\.trim\(\)\) writes\.push\(\["waha\.cle", cle\.trim\(\)\]\);/, "clé vide : gardée");
  assert.match(fournisseur, /await confirm\(\(\) => api\("PUT"/, "réglages de l'administrateur : mot de passe retapé");
});

test("QR code relayé par lama : le navigateur ne parle qu'à /api/whatsapp, rafraîchi toutes les 5 s", () => {
  const etat = read("./etat-whatsapp.tsx");
  assert.match(etat, /api<\{ image: string \}>\("GET", "\/api\/whatsapp\/qr"\)/);
  assert.doesNotMatch(etat, /3000|waha\.adresse/);
  assert.match(etat, /const POLL_MS = 5000;/);
  assert.match(etat, /<BoutonDestructif libelle=\{t\("whatsapp\.deconnecter"\)\}/, "se déconnecter demande confirmation");
  assert.match(etat, /canLinkWhatsapp\(account\.role\)/);
  assert.match(etat, /className=\{statusAlarming\(status\.data\) \? "text-sm text-encre-rouge" : "text-sm"\}/, "QR code à scanner en encre normale (vague 2)");
});

test("rubrique WhatsApp de la gérante : textes avec « Rétablir le texte par défaut », heures d'envoi sans champ natif", () => {
  const rubrique = read("./whatsapp.tsx");
  assert.match(rubrique, /\{text\.value !== text\.default && <Button variant="ghost" disabled=\{busy\} onClick=\{\(\) => void save\(text\.default\)\}>\{t\("whatsapp\.retablir"\)\}<\/Button>\}/);
  assert.match(rubrique, /\{text\.kind !== "ticket" && <p className="text-xs text-muted-foreground">\{t\("sms\.compteur"/, "compteur de SMS pour tous les textes sauf le ticket, dont « Produit recommandé »");
  assert.match(rubrique, /<ChampHeure id="whatsapp-silence-debut"/);
  assert.match(rubrique, /Number\(form\[key\]\)/, "délai du rappel envoyé en nombre");
  assert.match(rubrique, /HOURS_KEYS = \[[^\]]*"whatsapp\.indicatif"/, "indicatif par défaut lu avec les autres réglages de la gérante (décision 9)");
  assert.match(rubrique, /changedKeysIn\(baseline, form, SMS_KEYS\)/, "le bouton du secours SMS ne dépend que de ses propres champs");
  assert.match(rubrique, /<Champ id="whatsapp-indicatif-gerante" inputMode="numeric" label=\{t\("whatsapp\.indicatif"\)\} value=\{form\["whatsapp\.indicatif"\]\} onInput=\{set\("whatsapp\.indicatif"\)\}/, "indicatif par défaut modifiable par la gérante, même libellé qu'en Connexions");
});

test("« À envoyer à la main » : « Ouvrir WhatsApp » suspend d'abord l'envoi automatique, puis ouvre wa.me dans l'onglet ouvert au clic ; puis envoyé ou ignoré", () => {
  const liste = read("./a-envoyer.tsx");
  const ouvrir = liste.slice(liste.indexOf("const open = async"), liste.indexOf("return (", liste.indexOf("const open = async")));
  const rang = (motif: RegExp) => ouvrir.search(motif);
  assert.ok(rang(/window\.open\("", "_blank"\)/) >= 0, "onglet ouvert dans le geste du clic (Safari bloque un onglet ouvert après une attente)");
  assert.ok(rang(/window\.open\("", "_blank"\)/) < rang(/await api\("POST", `\/api\/whatsapp\/manual\/\$\{item\.id\}\/open`\)/), "onglet, puis suspension");
  assert.ok(rang(/await api\("POST", `\/api\/whatsapp\/manual\/\$\{item\.id\}\/open`\)/) < rang(/tab\.location\.href = link/), "WhatsApp ouvert seulement une fois l'envoi automatique suspendu");
  assert.match(ouvrir, /tab\?\.close\(\);/, "refus (message en train de partir) : l'onglet vide se referme");
  assert.match(ouvrir, /const link = waLink\(item\.to, item\.text\);/);
  assert.match(liste, /onClick=\{\(\) => void open\(item\)\}>\{t\(manualOpenKey\(item\)\)\}<\/Button>/);
  assert.doesNotMatch(liste, /href=\{waLink/, "plus de lien direct : il ouvrirait WhatsApp sans suspendre l'envoi automatique");
  assert.match(liste, /resolve\(item\.id, "sent"\)/);
  assert.match(liste, /resolve\(item\.id, "ignored"\)/);
  const rubriques = read("./reglages.tsx");
  assert.match(rubriques, /"a-envoyer": AEnvoyer,/);
  assert.match(rubriques, /whatsapp: Whatsapp,/);
});

test("pastille sur les Réglages (rail, « Plus » du téléphone) et bandeau de session pour la gérante et la réception", () => {
  assert.match(read("../cadre/rail.tsx"), /view === "reglages" \? <><CompteurAEnvoyer \/><PastilleMiseAJour \/><\/>/);
  const telephone = read("../cadre/telephone.tsx");
  assert.match(telephone, /\{views\.includes\("reglages"\) && <CompteurAEnvoyer \/>\}/);
  assert.match(telephone, /\{view === "reglages" && <CompteurAEnvoyer \/>\}/);
  const bandeaux = read("../bandeaux.tsx");
  assert.match(bandeaux, /\{sessionAlert\(whatsapp\) && \(/);
  assert.match(bandeaux, /if \(canSeeManual\(role\)\) api<WhatsappStatus>\("GET", "\/api\/whatsapp\/status"\)/);
  assert.match(bandeaux, /const WHATSAPP_POLL_MS = 60_000;/);
});

test("fiche cliente : accord, langue et message libre pour la réception et la gérante seulement", () => {
  const fiche = read("../fiches/fiche-cliente.tsx");
  assert.match(fiche, /\{canSeeManual\(account\.role\) && <WhatsappCliente client=\{client\} \/>\}/);
  const bloc = read("../fiches/whatsapp-cliente.tsx");
  assert.match(bloc, /aria-pressed=\{client\.channel === value\}/);
  assert.match(bloc, /change\(\{ channel: value \}\)/);
  assert.match(bloc, /<option value="">\{t\("cliente\.langue_institut"\)\}<\/option>/);
  assert.match(bloc, /api\("POST", `\/api\/clients\/\$\{client\.id\}\/whatsapp`, \{ text \}\)/);
  assert.match(bloc, /disabled=\{busy \|\| !text\.trim\(\)\}/, "un message à la fois, jamais vide");
});

test("rubrique Messages : blocs « Relances » et « Campagnes » (mini CRM)", () => {
  const rubrique = read("./whatsapp.tsx");
  assert.match(rubrique, /<Relances \/>/);
  assert.match(rubrique, /<Campagnes \/>/);
  const relances = read("./relances.tsx");
  assert.match(relances, /relanceChanges\(baseline, form\)/, "valeurs contrôlées avant l'envoi");
  assert.match(relances, /<ChampHeure id="relances-heure"/, "heure d'envoi sans champ natif");
  assert.match(relances, /<Case id="relances-anniversaire"/);
  assert.match(relances, /<Case id="relances-absence"/);
  const campagnes = read("./campagnes.tsx");
  assert.match(campagnes, /api<\{ campaigns: CampaignRow\[\] \}>\("GET", "\/api\/campaigns"\), \["outbox"\]/, "rechargée quand la file change");
});
