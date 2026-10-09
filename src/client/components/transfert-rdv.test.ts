import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** Fenêtre « Transférer des rendez-vous » et ses points d'entrée (spec du 04/10/2026, § 2). */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const fenetre = read("./transfert-rdv.tsx");

test("fenêtre : proposition chargée du serveur, choix présélectionnés, case cochée, corps envoyé tel que calculé", () => {
  assert.match(fenetre, /api<Proposal>\("GET", `\/api\/transfers\/proposal\?\$\{new URLSearchParams\(\{ staff_id: fromId, from, to \}\)\}`\)/);
  assert.match(fenetre, /setChoices\(initialChoices\(p\.appointments\)\)/);
  assert.match(fenetre, /const \[notify, setNotify\] = useState\(true\);/);
  assert.match(fenetre, /await api<\{ moved: number \}>\("POST", "\/api\/transfers", transferBody\(proposal\.from\.id, rows, choices, notify\)\);/);
  assert.match(fenetre, /const blocked = busyChoices\(rows, choices, staff\);/, "choix occupé refusé avant l'envoi");
});

test("fenêtre : « à replacer » en trait de cuir, collègues libres d'abord puis « occupée », 409 rechargé avec un message", () => {
  assert.match(fenetre, /choice === null && "border-l-2 border-primary"/);
  assert.match(fenetre, /\{t\("transfert\.a_replacer"\)\}/);
  assert.match(fenetre, /options\.free\.map\(\(s\) => <option key=\{s\.id\} value=\{s\.id\}>\{s\.name\}<\/option>\)\}\s*\{options\.busy\.map/);
  assert.match(fenetre, /<option value="">\{t\("transfert\.laisser", \{ nom: fromName \}\)\}<\/option>/);
  assert.match(fenetre, /if \(conflicts\) \{ keepRows\.current = true; setReloads\(\(n\) => n \+ 1\); \}/);
  assert.match(fenetre, /\{t\("transfert\.vide"\)\}/);
  assert.match(fenetre, /emitRefresh\(\[\.\.\.refreshPlan\(\["appointments"\]\), "staff"\]\);/);
});

test("points d'entrée : fiche d'une praticienne et agenda, gérante et réception seulement", () => {
  const fiche = read("./fiches/fiche-membre.tsx");
  assert.match(fiche, /const transfer = canManageAppointments\(account\.role\);/);
  assert.match(fiche, /\{transfer && <Button variant="outline" className=\{cn\(ACTION, "col-span-2"\)\} onClick=\{\(\) => setTransferring\(true\)\}>\{t\("transfert\.ouvrir"\)\}<\/Button>\}/);
  assert.match(fiche, /<TransfertRdv staffId=\{staff\.id\} staffName=\{staff\.name\} day=\{null\} onClose=\{\(\) => setTransferring\(false\)\} onDone=\{setTransferNotice\} \/>/);
  const agenda = read("./calendar-view.tsx");
  assert.match(agenda, /\{commands\.move && \(\s*<Button variant="outline" size="sm" className="col-span-2 w-full md:w-auto" onClick=\{\(\) => setTransfer\(true\)\}>/);
  assert.match(agenda, /staffId=\{wide \? null : columns\.find\(\(c\) => c\.key === shown\)\?\.staffId \?\? null\}/);
  assert.match(agenda, /day=\{calendarDate\}/);
});

test("fenêtre : plus de « Chargement » bloqué, proposition vidée au rechargement (sauf après un 409), « Au » borné, avis après transfert", () => {
  assert.match(fenetre, /if \(!fromId \|\| !from \|\| !to\) \{ setProposal\(null\); setLoading\(false\); return; \}/);
  assert.match(fenetre, /if \(keepRows\.current\) keepRows\.current = false;\s*else setProposal\(null\);/);
  assert.match(fenetre, /if \(conflicts\) \{ keepRows\.current = true; setReloads\(\(n\) => n \+ 1\); \}/);
  assert.match(fenetre, /<ChampDate id="transfert-au" required min=\{from\} max=\{lastDay\(from\)\}/);
  assert.match(fenetre, /setFrom\(v\); setTo\(clampTo\(v, to\)\);/);
  assert.match(fenetre, /onDone\?\.\(leftover > 0 \? tn\("transfert\.fait_reste", done\.moved, \{ reste: leftover \}\) : tn\("transfert\.fait", done\.moved\)\);/);
  assert.match(read("./fiches/fiche-membre.tsx"), /<Succes message=\{transferNotice\} \/>[\s\S]*onDone=\{setTransferNotice\}/);
  assert.match(read("./calendar-view.tsx"), /<Succes message=\{transferNotice\} \/>[\s\S]*onDone=\{setTransferNotice\}/);
});
