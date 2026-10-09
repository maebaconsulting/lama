import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Ticket, avoir et reçu d'acompte par WhatsApp à l'écran (sous-projet 7,
 * vague 2), vérifiés par la source (pas de DOM dans ces tests).
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("bouton « Envoyer par WhatsApp » : réception et gérante, met le document en file, dit le résultat", () => {
  const bouton = read("./envoi-whatsapp.tsx");
  assert.match(bouton, /if \(!canSeeManual\(account\.role\)\) return null;/);
  assert.match(bouton, /await api\("POST", "\/api\/whatsapp\/documents", \{ kind, id \}\);/);
  assert.match(bouton, /setOk\(t\("whatsapp\.document_en_file"\)\);/);
  assert.match(bouton, /<Erreur message=\{error\} \/>/);
});

test("bouton présent sur la facture émise, la fiche d'une facture ou d'un avoir, et chaque reçu d'acompte", () => {
  const emise = read("./emise.tsx");
  assert.match(emise, /<BoutonsTicket invoice=\{invoice\} direct=\{\{ kind: "invoice", id: invoice\.id \}\} outcome=\{invoice\} \/>\s*\{invoice\.client_id !== null && <EnvoiWhatsapp kind="invoice" id=\{invoice\.id\} queued=\{invoice\.whatsapp_queued\} \/>\}/);
  const fiche = read("./fiche-facture.tsx");
  assert.match(fiche, /\{inv\.client_id !== null && !\(inv\.kind === "invoice" && inv\.cancelled\) && <EnvoiWhatsapp kind=\{inv\.kind === "credit_note" \? "credit" : "invoice"\} id=\{inv\.id\} \/>\}/, "facture entièrement reprise : envoyer l'avoir plutôt");
  const acompte = read("./acompte-rdv.tsx");
  assert.match(acompte, /<BoutonsTicket source=\{depositSource\(d\)\} direct=\{\{ kind: "deposit", id: d\.id \}\} \/>\s*\{d\.client_id !== null && <EnvoiWhatsapp kind="deposit" id=\{d\.id\} \/>\}/);
});

test("case « Envoyer par WhatsApp » à l'encaissement : cliente lue pour son numéro et son accord, envoyée avec la vente", () => {
  const paiement = read("./paiement.tsx");
  assert.match(paiement, /const choice = ticketChoice\(client\.data\);/);
  assert.match(paiement, /const whatsapp = choice\.offered && \(whatsappChoice \?\? choice\.checked\);/);
  assert.match(paiement, /\.\.\.\(whatsapp \? \{ whatsapp: true \} : \{\}\)/);
  assert.match(paiement, /\{choice\.offered && \(\s*<Case id="caisse-whatsapp" label=\{t\("caisse\.envoyer_whatsapp"\)\} checked=\{whatsapp\} disabled=\{retourBloque\} onChange=\{setWhatsappChoice\} \/>\s*\)\}/);
});

test("« À envoyer à la main » d'un ticket : le PDF est téléchargé avant d'ouvrir WhatsApp, la réception le joint", () => {
  const liste = read("../reglages/a-envoyer.tsx");
  const ouvrir = liste.slice(liste.indexOf("const open = async"), liste.indexOf("return (", liste.indexOf("const open = async")));
  assert.ok(ouvrir.indexOf("/open`)") < ouvrir.indexOf("await download(item.document)"), "suspendu d'abord");
  assert.ok(ouvrir.indexOf("await download(item.document)") < ouvrir.indexOf("tab.location.href = link"), "PDF téléchargé avant WhatsApp");
  assert.match(liste, /save\(await apiBlob\(documentPdfPath\(doc\)\), `\$\{doc\.number\}\.pdf`\)/);
  assert.match(liste, /a\.download = name;/);
  assert.match(liste, /\{t\(manualOpenKey\(item\)\)\}/);
  assert.match(liste, /\{item\.document && <p className="text-xs text-muted-foreground">\{t\("a_envoyer\.joindre", \{ numero: item\.document\.number \}\)\}<\/p>\}/);
});
