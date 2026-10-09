import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Clientes (sous-projet 4 § 6), câblées sur les règles de `lib/fiches.ts`
 * (testées en exécution dans `lib/fiches.test.ts`) et le panneau de détail.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const liste = read("../client-list.tsx");
const fiche = read("./fiche-cliente.tsx");
const commun = read("./liste-fiches.tsx");
const corps = read("./corps-fiche.tsx");

test("liste des fiches : cartes tant que la liste est étroite, lignes denses dès 36 rem, colonne secondaire dès 56 rem (panneau posé compris)", () => {
  assert.match(commun, /<div className="hors-panneau @container flex max-w-5xl flex-col gap-5 p-4 sm:p-6">/);
  assert.match(commun, /<ul aria-label=\{libelle\} className="flex min-w-0 flex-col gap-2 @xl:gap-0 @xl:rounded-sm @xl:border @xl:border-filet @xl:bg-card">/);
  assert.doesNotMatch(commun, /@2xl:/, "les lignes restent denses dès 36 rem (@xl), pas 42 rem (@2xl), sous le panneau posé sur une tablette de 1180 px");
  assert.match(commun, /text-muted-foreground @4xl:hidden">\{secondaire\}<\/span>/, "sous le nom tant que la liste est étroite");
  assert.match(commun, /hidden w-48 shrink-0 truncate text-sm text-muted-foreground @4xl:block">\{secondaire\}<\/span>/);
  assert.doesNotMatch(commun, /\bmd:/, "selon la largeur réelle de la liste, jamais celle de l'écran");
  assert.match(commun, /\{apres && <div className=/, "le lien d'appel est hors du bouton de la ligne");
});

test("lignes denses : chaque ligne garde son filet bas, sauf la dernière (retouche 4, listes de la vague 4 comprises)", () => {
  const ul = commun.match(/<ul aria-label=\{libelle\} className="([^"]*)"/)?.[1] ?? "";
  assert.doesNotMatch(ul, /divide-/, "divide-y (spécificité nulle) était écrasé par la bordure de la ligne");
  const li = commun.match(/<li className=\{cn\(\s*"([^"]*)"/)?.[1] ?? "";
  const classes = li.split(/\s+/);
  for (const cls of ["border", "border-filet", "@xl:border-x-0", "@xl:border-t-0", "@xl:last:border-b-0"]) assert.ok(classes.includes(cls), cls);
  assert.ok(!classes.includes("@xl:border-0"), "@xl:border-0 effaçait le filet bas");
  assert.match(commun, /\{fin && <span className="flex shrink-0 flex-col items-end gap-1 text-right text-sm @xl:w-auto @xl:min-w-32 @xl:whitespace-nowrap">/, "« Bloqué jusqu'à 06:45 » sur une ligne, colonnes alignées");
});

test("un seul « + » sur l'écran au téléphone : pas d'icône Plus dans le bouton « Nouveau… » de l'en-tête (déjà un + dans le clavier ou ailleurs)", () => {
  assert.match(commun, /<Button onClick=\{action\.onClick\}>\{action\.libelle\}<\/Button>/, "le bouton garde son libellé, sans icône Plus");
  assert.doesNotMatch(commun, /\bPlus\b/, "plus d'import ni d'usage de l'icône Plus");
});

test("liste des clientes : plus de tableau ni d'icône par ligne ; toucher ouvre la fiche dans le panneau", () => {
  assert.doesNotMatch(liste, /<Table|Trash2|deleteClient/);
  assert.match(liste, /onOpen=\{\(\) => openPanel\("client", c\.id\)\}/);
  assert.match(liste, /actif=\{isOpen\(panel, "client", c\.id\)\}/);
  assert.match(liste, /apres=\{<LienAppel client=\{c\} \/>\}/);
  assert.match(liste, /tn\("cliente\.nb_visites", c\.visit_count \?\? 0\)/);
  assert.match(liste, /c\.last_visit \? t\("cliente\.derniere_visite"/);
});

test("« Nouvelle cliente » et la suppression cachées à la praticienne (report de la vague 1) ; la note reste à elle", () => {
  assert.match(liste, /const commands = clientCommands\(account\.role\);/);
  assert.match(liste, /action=\{commands\.create \? \{ libelle: t\("cliente\.ajouter"\)/);
  assert.match(fiche, /\{commands\.remove && \(\s*<SuppressionFiche/);
  assert.match(fiche, /<NoteCliente id=\{client\.id\} notes=\{client\.notes\} editable=\{commands\.editNotes\} \/>/);
  assert.match(fiche, /\{commands\.book && <Button className=\{ACTION\} onClick=\{\(\) => setBooking\(true\)\}>/);
});

test("fiche : nouveau rendez-vous pré-rempli avec la cliente, modification dans la fenêtre, historique ouvert dans le panneau", () => {
  assert.match(fiche, /<CreateAppointment defaultClientId=\{client\.id\} onClose=/);
  assert.match(fiche, /<CreateClient client=\{client\} onClose=/);
  assert.match(fiche, /onClick=\{\(\) => openPanel\("appointment", apt\.id\)\}/);
  assert.match(read("../create-client.tsx"), /if \(client\) await updateClient\(client\.id, data\);/);
});

test("relecture finale : en modification, les champs de note et de préférences sont cachés et ne sont pas envoyés (ils se modifient dans la fiche, pas dans une fenêtre au contenu périmé)", () => {
  const createClient = read("../create-client.tsx");
  assert.match(createClient, /\{!client && \(\s*<div className="space-y-1\.5">\s*<Label htmlFor="nc-notes-cliente">/, "le champ de note n'est montré qu'à la création");
  assert.match(createClient, /\{crm && !client && \(\s*<div className="space-y-1\.5">\s*<Label htmlFor="nc-preferences-cliente">/, "le champ des préférences n'est montré qu'à la création (et avec le mini CRM)");
  assert.match(createClient, /const data = clientPayload\(client\s*\? \{ name: name\.trim\(\), email, phone, birthday: birthdayValue\(day, month\), tags: finalTags, card: card\.trim\(\) \}\s*: \{ name: name\.trim\(\), email, phone, notes, preferences: preferences\.trim\(\), birthday: birthdayValue\(day, month\), tags: finalTags, card: card\.trim\(\) \}, crm\);/, "note et préférences envoyées seulement à la création ; champs du mini CRM retirés quand il est désactivé");
});

test("mini CRM : anniversaire par deux listes (SELECT partagé) avec « Effacer », étiquettes ajoutées à Entrée ou à la virgule, celle encore dans le champ gardée", () => {
  const createClient = read("../create-client.tsx");
  const saisie = read("./etiquettes.tsx");
  assert.equal(createClient.match(/<select\b[^>]*className=\{SELECT\}/g)?.length, 2, "jour et mois");
  assert.match(createClient, /setError\(t\("crm\.anniversaire_incomplet"\)\)/);
  assert.match(createClient, /const finalTags = parseTagInput\(`\$\{tagDraft\},`, tags\)\.tags;/);
  assert.match(saisie, /if \(e\.key === "Enter"\) \{ e\.preventDefault\(\); take\(`\$\{draft\},`\); \}/);
  assert.match(saisie, /if \(value\.includes\(","\)\) take\(value\);/);
  assert.match(saisie, /tagSuggestions\(draft, existing, tags\)/);
});

test("suppression refusée par le serveur (historique) : le message est dit dans la fiche, la fiche reste", () => {
  assert.match(corps, /setRefus\(\(err as Error\)\.message\);/);
  assert.match(corps, /\{refus && <p role="alert" className="text-sm text-encre-rouge">\{refus\}<\/p>\}/);
  assert.match(corps, /<BoutonDestructif libelle=\{t\("commun\.supprimer"\)\} question=\{question\} disabled=\{busy\} onConfirm=\{run\} \/>/);
});

test("note changée : « Enregistrer » n'apparaît qu'après un changement ; changée ailleurs, le champ la suit sans écraser une saisie en cours (fix round 1)", () => {
  assert.match(fiche, /\{text !== notes && <Button variant="outline" disabled=\{saving\} onClick=\{save\}>/);
  assert.match(fiche, /const shown = useRef\(notes\);/);
  assert.match(fiche, /useEffect\(\(\) => \{\s*if \(text === shown\.current\) setText\(notes\);\s*shown\.current = notes;\s*\}, \[notes\]\);/);
});

test("fiche : la date d'ouverture du dossier n'est pas un enfant direct de <dl> (HTML valable, fix round 1)", () => {
  assert.match(fiche, /<\/dl>\s*<p className="text-xs text-muted-foreground">\{t\("cliente\.depuis", \{ date: formatTimestampDate\(client\.created_at, lang\) \}\)\}<\/p>/);
});

test("historique connu de l'écran : pas de « Supprimer » proposé pour être refusé, l'explication à la place", () => {
  assert.match(corps, /if \(bloquee\) return <p className="border-t border-filet pt-4 text-sm text-muted-foreground">\{bloquee\}<\/p>;/);
  assert.match(fiche, /bloquee=\{appointments\.length > 0 \? t\("cliente\.suppression_impossible"\) : null\}/);
});

test("relecture finale : updateClient ne relit la fiche cliente que si elle est encore celle ouverte, avant et après le GET (une autre ouverte entre-temps ne l'écrase pas)", () => {
  const hook = read("../../hooks/use-app.ts");
  assert.match(hook, /const updateClient = useCallback\(async \(id: number, data: Partial<Client>\) => \{\s*await api\("PUT", `\/api\/clients\/\$\{id\}`, data\);[\s\S]*?if \(latest\.current\.selectedClient\?\.id === id\) \{\s*const res = await api<ClientDetail>\("GET", `\/api\/clients\/\$\{id\}`\);\s*if \(latest\.current\.selectedClient\?\.id === id\) applyClientDetail\(res\);\s*\}\s*\}, \[/);
  // Mini CRM : la synthèse arrive avec la cliente et ses rendez-vous, posée par la même fonction.
  assert.match(hook, /const applyClientDetail = useCallback\(\(res: ClientDetail\) => \{\s*setSelectedClient\(res\.client\);\s*setSelectedClientAppointments\(res\.appointments\);\s*setSelectedClientSummary\(res\.summary \?\? null\);\s*\}, \[\]\);/);
});

test("mini CRM : fiche dans l'ordre de la spec, préférences sur place pour la praticienne aussi, seuil d'absence des relances, tuiles en deux colonnes au téléphone", () => {
  const synthese = read("./synthese-cliente.tsx");
  const order = ["<PucesEtiquettes tags={crmTags(client.tags, crm)} />", "absenceText(line, lang)", "crm.anniversaire_aujourdhui", "commands.book &&", "<SyntheseCliente summary={summary} />",
    "colonne.telephone", "crm.anniversaire\")", "field=\"preferences\"", "<NoteCliente id={client.id} notes={client.notes}", "<WhatsappCliente", "cliente.historique", "<FacturesCliente", "<SuppressionFiche"];
  const positions = order.map((needle) => fiche.indexOf(needle));
  positions.forEach((p, i) => assert.ok(p > 0, `introuvable : ${order[i]}`));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "ordre de la fiche (spec § 1, Écran)");
  assert.match(fiche, /<NoteCliente id=\{client\.id\} notes=\{client\.preferences\} editable=\{commands\.editPreferences\} field="preferences"/);
  assert.match(fiche, /absenceLine\(summary, absenceDays\)/);
  assert.match(fiche, /line\.kind === "absent" && line\.over \? "border-l-2 border-primary/, "trait de cuir au seuil");
  assert.match(fiche, /isBirthdayToday\(client\.birthday, todayAt\(\)\)/);
  assert.match(synthese, /cn\("grid grid-cols-2 gap-2", columns\)/, "deux colonnes au téléphone");
  assert.match(synthese, /<ChiffreCle key=\{f\.id\} valeur=\{f\.value\} libelle=\{f\.label\} \/>/);
  assert.doesNotMatch(synthese, /formatPrice/, "les montants viennent de keyFigures, absents pour la praticienne");
});

test("mini CRM : changer de cliente vide d'abord la synthèse et les rendez-vous de la précédente, et la fiche ne montre la synthèse que si la cliente est posée", () => {
  const hook = read("../../hooks/use-app.ts");
  assert.match(hook, /const selectClient = useCallback\(async \(id: number \| null\) => \{[\s\S]*?if \(!activity\) return;\s*(?:\/\/[^\n]*\s*)?if \(latest\.current\.selectedClient\?\.id !== id\) \{\s*setSelectedClient\(null\);\s*setSelectedClientSummary\(null\);\s*setSelectedClientAppointments\(\[\]\);\s*\}\s*await clientRequests\.run\(/);
  assert.match(fiche, /summary && <SyntheseCliente summary=\{summary\} \/>/);
  assert.ok(fiche.indexOf("if (!client) return null;") < fiche.indexOf("<SyntheseCliente"), "la synthèse n'est rendue qu'après le garde sur la cliente");
});

test("mini CRM : liste filtrée par étiquette (puces sous la recherche, « Toutes », adresse qui fait foi), étiquettes sur chaque ligne", () => {
  assert.match(commun, /filtres\?: ComponentChildren;/);
  assert.match(commun, /\{filtres\}/);
  assert.match(liste, /<FiltreEtiquettes tags=\{clientTags\} current=\{clientsTag\} onChange=\{setClientsTag\} \/>/);
  assert.match(liste, /aria-pressed=\{current === ""\}/, "« Toutes » marquée quand aucune étiquette n'est choisie");
  assert.match(liste, /overflow-x-auto/, "défilement horizontal au téléphone");
  assert.match(liste, /const fromUrl = tagFromSearch\(window\.location\.search\);/, "l'adresse fait foi en arrivant sur la liste");
  assert.match(liste, /secondaire=\{crmTags\(c\.tags, crm\)\.length > 0 \? <PucesEtiquettes tags=\{crmTags\(c\.tags, crm\)\} max=\{2\} \/> : undefined\}/);
  assert.match(liste, /t\("crm\.aucune_etiquette_filtre", \{ etiquette: clientsTag \}\)/);
});

test("mini CRM : le filtre est resynchronisé depuis l'adresse (entrée par le menu, « Précédent »), sans second chargement", () => {
  assert.match(liste, /const fromUrl = tagFromSearch\(window\.location\.search\);/);
  assert.match(liste, /if \(fromUrl !== tagRef\.current\) setClientsTag\(fromUrl\);/, "écart seulement : l'étiquette déjà choisie ne relance pas la liste");
  assert.match(liste, /addEventListener\("popstate", sync\)/, "« Précédent » relit l'adresse");
  assert.match(liste, /removeEventListener\("popstate", sync\)/);
  assert.match(liste, /sync\(\);\s*\n/, "à l'entrée dans la vue, une adresse sans ?etiquette= remet le filtre à vide");
  assert.match(liste, /tagRef\.current = clientsTag;/, "la dernière étiquette est lue par l'écouteur sans le réinstaller");
});

test("fiche : la ligne d'absence suit le seuil des relances (décision 6), lu par useAbsenceDays", () => {
  const sources = ["./fiche-cliente.tsx", "./synthese-cliente.tsx"]
    .filter((p) => existsSync(new URL(p, import.meta.url)))
    .map(read)
    .join("\n");
  assert.match(sources, /const absenceDays = useAbsenceDays\(\);/);
  assert.doesNotMatch(sources, /DEFAULT_ABSENCE_DAYS/, "plus de seuil fixe dans la fiche");
});

test("fiche : le seuil n'est pas supposé pendant le chargement (null), repli sur 60 si la lecture échoue", () => {
  const hook = read("../../hooks/use-absence-days.ts");
  assert.match(hook, /useAbsenceDays\(\): number \| null/);
  assert.match(hook, /return error \? DEFAULT_ABSENCE_DAYS : null;/);
});

test("correction des points : une seule écriture par envoi, Entrée qui soumet, erreur effacée à la saisie (relecture finale, mineur 4)", () => {
  const fidelite = read("./fidelite-cliente.tsx");
  assert.match(fidelite, /const sending = useRef\(false\);/, "garde synchrone, l'état `busy` arrive trop tard pour un double appui");
  assert.match(fidelite, /if \(sending\.current\) return;\n\s+sending\.current = true;/);
  assert.match(fidelite, /finally \{\n\s+sending\.current = false;/);
  assert.match(fidelite, /<form id=\{formId\} className="space-y-4" onSubmit=\{\(e: Event\) => \{ e\.preventDefault\(\); void submit\(\); \}\}>/, "Entrée soumet le formulaire");
  assert.match(fidelite, /<Button type="submit" form=\{formId\} disabled=\{busy\}>/, "bouton d'envoi lié au formulaire, pied hors du formulaire");
  assert.equal((fidelite.match(/setError\(null\); set(Text|Note|Direction)\(/g) ?? []).length, 3, "l'erreur s'efface à la saisie et au changement de sens");
});
