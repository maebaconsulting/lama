import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("l'accueil n'affiche un chiffre d'affaires que si les montants sont fournis (retirés pour la praticienne)", () => {
  const accueil = read("./components/accueil/aujourdhui.tsx");
  assert.match(accueil, /\{figures\.plannedRevenue !== null && <ChiffreCle/);
  assert.match(accueil, /\{figures\.revenue !== null && <ChiffreCle/);
  assert.doesNotMatch(read("./components/accueil/ma-journee.tsx"), /formatPrice|total_price/);
});

test("rail déployé : libellés entiers sur deux lignes au besoin, jamais coupés par des points de suspension (tâche 11)", () => {
  // Vu à 1180 px en français : « Masquer les libellés du … », « Thème : Comme l'app… ».
  const rail = read("./components/cadre/rail.tsx");
  assert.doesNotMatch(rail, /\{expanded && <span className="[^"]*\btruncate\b[^"]*">\{label\}<\/span>\}/);
  assert.equal(rail.match(/\{expanded && <span className="min-w-0 flex-1 text-left leading-tight">\{label\}<\/span>\}/g)?.length, 2);
  assert.match(rail, /const ITEM = "relative flex min-h-11 /, "hauteur minimale, pas fixe : deux lignes tiennent");
});

test("le rail et les onglets suivent le rôle, proposent de se déconnecter ou de verrouiller, FR / EN et le thème du compte (sous-projet 4 § 3.3)", () => {
  const rail = read("./components/cadre/rail.tsx");
  const phone = read("./components/cadre/telephone.tsx");
  assert.match(rail, /railViews\(account\.role\)/);
  assert.match(phone, /phoneTabs\(account\.role\)/);
  assert.match(phone, /moreViews\(account\.role\)/);
  for (const text of [rail, phone]) {
    assert.match(text, /t\("menu\.deconnexion"\)/);
    assert.match(text, /t\("menu\.verrouiller"\)/);
    assert.match(text, /onChange=\{saveOwnLang\}/);
    assert.match(text, /pathFor\("reglages", lang, "mon-compte"\)/);
  }
  assert.match(rail, /<MenuTheme /);
  // Décision C2 : libellé du thème traduit d'un bloc (« Thème : Clair », « Theme: Light »), pas composé dans le code.
  assert.match(rail, /t\("theme\.actuel", \{ nom: t\(THEME_KEYS\[pref\]\) \}\)/);
  assert.doesNotMatch(rail, /\$\{t\("theme\.choix"\)\}/);
  assert.match(phone, /<ChoixTheme surface="couverture"/);
  assert.match(read("./components/cadre/navigation.tsx"), /api\("PUT", "\/api\/auth\/me\/language"/);
});

test("rail : 64 px replié, libellés au survol, au focus clavier et à l'appui long ; déploiement retenu par l'appareil", () => {
  const rail = read("./components/cadre/rail.tsx");
  // 64 px (240 px déployé) pour les icônes, plus l'encoche de l'iPhone en paysage (relecture 1).
  assert.match(rail, /expanded \? "w-\[calc\(15rem\+env\(safe-area-inset-left\)\)\]" : "w-\[calc\(4rem\+env\(safe-area-inset-left\)\)\]"/);
  assert.match(rail, /onMouseEnter:/);
  assert.match(rail, /matches\(":focus-visible"\)/);
  assert.match(rail, /e\.pointerType !== "touch"/);
  assert.match(rail, /setTimeout\(\(\) => show\(label, el\), LONG_PRESS_MS\)/);
  assert.match(rail, /useState\(\(\) => readRailExpanded\(\)\)/);
  assert.match(rail, /writeRailExpanded\(next\)/);
  assert.match(rail, /aria-label=\{expanded \? undefined : extraLabel \? `\$\{label\}, \$\{extraLabel\}` : label\}/, "nom accessible du bouton replié");
});

test("iPhone en paysage (852 à 956 px, rail affiché) : encoche hors des 64 px, comptée une seule fois, rail entier atteignable (relecture 1 de la tâche 8)", () => {
  const rail = read("./components/cadre/rail.tsx");
  const aside = rail.match(/<aside className=\{cn\(\s*"([^"]*)"/)?.[1] ?? "";
  // L'encoche s'ajoute à la largeur au lieu d'être prise sur les icônes.
  assert.match(aside, /pl-\[env\(safe-area-inset-left\)\]/);
  assert.doesNotMatch(rail, /"w-16"|"w-60"/);
  // Le libellé du rail replié se pose juste à droite du rail, encoche comprise.
  assert.match(rail, /left-\[calc\(4rem\+env\(safe-area-inset-left\)\+0\.5rem\)\]/);
  // Tout le rail défile quand la hauteur manque (393 px) : logo, rubriques et pied.
  assert.match(aside, /\boverflow-y-auto\b/);
  assert.match(aside, /\boverflow-x-hidden\b/);
  const nav = rail.match(/<nav aria-label=\{t\("menu\.navigation"\)\} className="([^"]*)"/)?.[1] ?? "";
  assert.ok(nav, "navigation du rail introuvable");
  assert.doesNotMatch(nav, /overflow-y-auto|min-h-0/, "la liste ne se réduit pas à zéro : c'est le rail qui défile");
  assert.match(rail, /<div className="flex shrink-0 flex-col gap-1 border-t/, "pied jamais écrasé");
  // La page ne recompte pas l'encoche de gauche quand le rail est là ; la droite reste protégée.
  const app = read("./app.tsx");
  assert.match(app, /plusShown\s*\?\s*"pb-\[calc\(8rem\+env\(safe-area-inset-bottom\)\)\] md:pb-0 md:pl-0"\s*:\s*"pb-\[calc\(3\.5rem\+env\(safe-area-inset-bottom\)\)\] md:pb-0 md:pl-0"/);
  // Seule exception (tâche 11) : panneau ouvert, c'est lui qui touche le bord droit et porte la zone sûre.
  assert.doesNotMatch(app.replace('panneau && "panneau-ouvert xl:pr-0"', ""), /md:pr-0|xl:pr-0/);
});

test("le cadre vient du rail, de l'en-tête et des onglets ; l'ancien menu latéral a disparu", () => {
  const app = read("./app.tsx");
  assert.match(app, /<Rail currentView=\{view\} folded=\{railFolded\(panneau !== null, large\)\} \/><EnTeteTelephone \/>/);
  assert.match(app, /<OngletsTelephone currentView=\{view\} \/>/);
  assert.doesNotMatch(app, /Sidebar/);
});

test("la page /charte reste claire jusqu'aux bords en thème sombre, marges du cadre comprises (vérification C1)", () => {
  const app = read("./app.tsx");
  // La zone principale porte elle-même le thème clair sur /charte : ses marges
  // (zones sûres, place des onglets) et le bas d'une page courte restent blancs.
  const main = app.slice(app.indexOf("<main "), app.indexOf(">", app.indexOf(")}", app.indexOf("<main "))) + 1);
  assert.match(main, /data-theme=\{view === "charte" \? "light" : undefined\}/);
  assert.match(read("./components/charte.tsx"), /<div data-theme="light" className="bg-background/);
});

test("le libellé du rôle n'est jamais masqué par le bouton FR / EN (ADMINISTRATEUR, RÉCEPTIONNISTE, vérification finale)", () => {
  const sidebar = read("./components/cadre/telephone.tsx");
  // Les libellés de rôle font jusqu'à 129 px et le bouton FR / EN 94 px : la
  // ligne du compte, dans « Plus », passe à la ligne au lieu de rogner.
  const row = sidebar.match(/<div className="([^"]*)">\s*<div className="([^"]*)">\s*<p className="truncate[^"]*">\{account\.display_name\}<\/p>\s*<p className="([^"]*)">\{t\(ROLE_KEYS\[account\.role\]\)\}<\/p>/);
  assert.ok(row, "ligne du compte introuvable");
  assert.match(row[1], /\bflex-wrap\b/);
  assert.match(row[2], /\bmax-w-full\b/);
  assert.match(row[3], /\bwhitespace-nowrap\b/);
});

test("l'administrateur ne déclenche aucun chargement d'activité", () => {
  const hook = read("./hooks/use-app.ts");
  assert.match(hook, /loadsActivity\(role\)/);
  // Compte les gardes `if (!activity) …` : les quatre effets (rendez-vous, agenda,
  // clientes, produits) s'écrivent `if (!activity) return;` et le chargement initial
  // s'écrit `if (!activity) { setLoading(false); return; }` (au moins 5 gardes).
  const guards = hook.match(/if \(!activity\)/g) ?? [];
  assert.ok(guards.length >= 5, `gardes trouvées : ${guards.length}`);
});

test("un écran interdit renvoie vers l'accueil du rôle", () => {
  const app = read("./app.tsx");
  assert.match(app, /mayOpen\(/);
  assert.match(app, /homePath\(/);
  assert.match(app, /<Reglages /);
});

test("une adresse d'activité ouverte par l'administrateur ne déclenche aucune requête d'activité, même avant la redirection (M1, relecture de sécurité)", () => {
  const app = read("./app.tsx");
  // L'effet qui ouvre une fiche (rendez-vous ou cliente) depuis l'adresse doit
  // s'arrêter avant tout appel quand le rôle ne charge pas l'activité ou n'a pas
  // le droit d'ouvrir cet écran : il s'exécute dans le même cycle que la redirection.
  // Vague 4 : la fiche cliente est dans le panneau ; un seul effet ouvre l'élément de l'adresse
  // (rendez-vous ou cliente, `loadPanelItem`) et referme les autres, garde en tête.
  const debut = app.indexOf("useEffect(", app.indexOf("useAppState("));
  const effet = app.slice(debut, app.indexOf("}, [view, panelKey, role]"));
  const garde = effet.indexOf("if (!loadsActivity(role) || !mayOpen(role, view, id)) return;");
  for (const appel of ["loadPanelItem(", "selectAppointment(null)", "selectClient(null)"]) {
    assert.ok(effet.includes(appel), `effet d'ouverture introuvable : ${appel}`);
    assert.ok(garde > 0 && garde < effet.indexOf(appel), `${appel} : garde absente ou placée après l'appel`);
  }
  assert.doesNotMatch(app, /\}, \[view, id, role\]\)/, "plus d'effet de fiche cliente en page");
  // Et, en profondeur, les deux sélections elles-mêmes ne partent jamais pour lui.
  const hook = read("./hooks/use-app.ts");
  for (const nom of ["selectAppointment", "selectClient"]) {
    const corps = hook.slice(hook.indexOf(`const ${nom} = useCallback(`), hook.indexOf("}, [activity]);", hook.indexOf(`const ${nom} = useCallback(`)));
    assert.match(corps, /if \(!activity\) return;/, `${nom} : garde absente`);
    assert.ok(corps.indexOf("if (!activity) return;") < corps.indexOf("await api"), `${nom} : garde après l'appel`);
  }
});

test("panneau de détail : la fiche d'un rendez-vous s'y ouvre depuis la liste, l'agenda, l'accueil et la fiche cliente (sous-projet 4 § 3.3)", () => {
  for (const file of ["appointment-list", "agenda/grille", "accueil/aujourdhui", "accueil/ma-journee", "fiches/fiche-cliente"]) {
    const text = read(`./components/${file}.tsx`);
    assert.match(text, /openPanel\("appointment", apt\.id\)/, file);
    assert.doesNotMatch(text, /navigate\(`\/appointments\/\$\{apt\.id\}`\)/, `${file} : plus de fiche en page`);
  }
  const app = read("./app.tsx");
  // Vague 4 : un panneau par sorte d'élément (`panneauDe`), le même pour le rendez-vous et les fiches.
  assert.match(app, /<Panneau titre=\{titre\} onClose=\{closePanel\}>/);
  assert.match(app, /panneauDe\(t\("panneau\.rendez_vous"\), panelView\(itemId, appState\.selectedAppointment\?\.id, panelFailure\)/);
  // Tâche 10 : une fiche par rendez-vous ; enregistrement, envoi et menus ouverts ne passent jamais au suivant.
  assert.match(app, /\(\) => <AppointmentDetail key=\{itemId\} \/>/);
  assert.match(app, /<EtatErreur message=\{shown\.message\} onRetry=\{retry\} \/>/, "erreur dans le panneau, avec « Réessayer »");
  assert.match(app, /: <EtatChargement \/>/);
  assert.doesNotMatch(app, /view === "appointments" && id && appState\.selectedAppointment/, "plus de fiche en pleine page");
});

test("panneau : à droite sur 768 px et plus (un tiers, 360 px au moins), plein écran avec « Retour » sur téléphone, Échap le ferme", () => {
  const panneau = read("./components/cadre/panneau.tsx");
  // Tâche 11 : la zone sûre de droite s'ajoute à la largeur (comme pour le rail), le contenu garde ses 360 px au moins.
  assert.match(panneau, /fixed inset-0 z-40 [^"]*md:w-\[calc\(max\(22\.5rem,33vw\)\+env\(safe-area-inset-right\)\)\]/);
  // Revue impeccable (B1) : de 768 à 1279 px, le panneau se pose par-dessus l'agenda (filet cuir,
  // aucune ombre) au lieu de l'écraser ; en colonne à partir de 1280 px.
  assert.match(panneau, /md:left-auto md:right-0[^"]*md:border-l md:border-foreground[^"]*xl:static xl:z-auto xl:shrink-0 xl:border-filet/);
  assert.doesNotMatch(panneau, /md:static|shadow/);
  assert.match(panneau, /className="px-3 md:hidden" onClick=\{onClose\}/);
  assert.match(panneau, /t\("commun\.retour"\)/);
  assert.match(panneau, /aria-label=\{t\("commun\.fermer"\)\} onClick=\{onClose\}/);
  assert.match(panneau, /document\.addEventListener\("keydown", onKey\)/, "Échap écoutée sur tout le document (vague 2)");
  assert.match(panneau, /escapeDecision\(e, document\.querySelector\(OVERLAYS\) !== null, hasUnsavedText\(drafts\)\)/);
  assert.match(panneau, /pt-\[calc\(0\.5rem\+env\(safe-area-inset-top\)\)\]/);
  assert.match(panneau, /md:pr-\[env\(safe-area-inset-right\)\]/, "iPhone en paysage : le panneau touche le bord droit, zone sûre comprise (tâche 11)");
  assert.match(panneau, /@container/);
  assert.match(read("./components/appointment-detail.tsx"), /@md:grid-cols-2/, "mise en page selon la largeur du panneau");
});

test("panneau ouvert : la page lui laisse la zone sûre de droite au lieu de la garder vide (tâche 11)", () => {
  // Vu à 852 x 393 (iPhone en paysage) : 47 px perdus entre la liste et le panneau.
  const app = read("./app.tsx");
  assert.match(app, /const panneau = renderPanel\(\);/);
  assert.match(app, /panneau && "panneau-ouvert xl:pr-0"/);
  // Panneau posé par-dessus de 768 à 1279 px : bandeaux et barre de l'agenda s'arrêtent à son bord.
  const css = read("./styles.css");
  assert.match(css, /@media \(min-width: 48rem\) and \(max-width: 79\.999rem\) \{\s*\.panneau-ouvert \.hors-panneau \{\s*padding-right: calc\(max\(22\.5rem, 33vw\) \+ env\(safe-area-inset-right\)\);/);
  assert.equal(read("./components/bandeaux.tsx").match(/className="hors-panneau /g)?.length, 7, "serveur injoignable, formation, nouvelle version, heure, hors ligne, sauvegardes, WhatsApp");
  assert.equal(read("./components/installer-lama.tsx").match(/className="hors-panneau /g)?.length, 1, "installation sur l'écran d'accueil");
  assert.match(read("./components/calendar-view.tsx"), /<div className="hors-panneau flex shrink-0 flex-wrap items-center gap-2">/);
  assert.match(app, /<\/main>\s*\{panneau\}/);
});

test("supprimer ou perdre le rendez-vous ouvert ferme le panneau", () => {
  const hook = read("./hooks/use-app.ts");
  assert.match(hook, /close: \(\) => \{ setSelectedAppointment\(null\); closePanel\(\); \}/);
  assert.match(hook, /if \(selectedAppointment && selectedAppointment\.id === id\) \{ setSelectedAppointment\(null\); closePanel\(\); \}/);
});

test("bouton « + » : rond, 56 px, téléphone seulement, au-dessus des onglets, zones sûres, nom accessible (sous-projet 4 § 3.3)", () => {
  const plus = read("./components/cadre/bouton-plus.tsx");
  const button = plus.match(/<button\s+type="button"\s+aria-label=\{label\}\s+onClick=\{run\}\s+className="([^"]*)"/)?.[1] ?? "";
  for (const cls of ["rounded-full", "h-14", "w-14", "md:hidden", "bg-primary", "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]", "right-[max(1rem,env(safe-area-inset-right))]"]) {
    assert.ok(button.split(/\s+/).includes(cls), cls);
  }
  assert.match(plus, /defaultPrimaryAction\(account\.role\)/);
  assert.match(plus, /if \(action === null \|\| \(action === "note-prochain-rdv" && !next\)\) return null;/, "absent sans action principale");
  assert.match(plus, /openPanel\("appointment", next\.id\)/, "praticienne : fiche du prochain rendez-vous, champ de note compris");
  assert.match(plus, /<CreateAppointment defaultDate=\{agendaDay\} onClose=/, "réception et gérante : nouveau rendez-vous");
  assert.match(read("./app.tsx"), /\{!embedded && plusShown && <BoutonPlus agendaDay=/);
});

test("pas de « + » flottant dans les Réglages ni sur l'écran « Vente » : il ne recouvre plus les champs de Mon compte ni le bas du ticket, sa place n'est plus réservée (retouche 3, sous-projet 5)", () => {
  const app = read("./app.tsx");
  assert.match(app, /const plusShown = hasPrimaryAction && view !== "reglages" && view !== "vente" && view !== "caisse";/);
  assert.match(app, /!embedded && \(plusShown\s*\?/, "marge basse de la page seulement quand le « + » est là");
  assert.match(app, /<ErrorBanner withPlus=\{plusShown\} \/>/, "le bandeau d'erreur descend à la place des seuls onglets");
  const banner = read("./components/error-banner.tsx");
  assert.match(banner, /export function ErrorBanner\(\{ withPlus \}: \{ withPlus: boolean \}\)/);
  assert.match(banner, /const hasPrimaryAction = withPlus && defaultPrimaryAction\(account\.role\) !== null;/);
});

test("marge du « + » réservée seulement pour les rôles qui ont une action principale, même sans prochain rendez-vous (relecture 1 de la tâche 10)", () => {
  const app = read("./app.tsx");
  assert.match(app, /const hasPrimaryAction = defaultPrimaryAction\(role\) !== null;/, "dépend du rôle, jamais du prochain rendez-vous en direct : pas de saut de mise en page pour la praticienne");
  const banner = read("./components/error-banner.tsx");
  assert.match(banner, /defaultPrimaryAction\(account\.role\) !== null/);
  assert.match(banner, /bottom-\[calc\(4\.5rem\+env\(safe-area-inset-bottom\)\)\]/, "administrateur : place des seuls onglets");
  assert.match(banner, /bottom-\[calc\(8\.5rem\+env\(safe-area-inset-bottom\)\)\]/, "rôle avec un « + » : place des onglets et du bouton");
});

test("panneau : le focus est rendu à l'élément déclencheur à la fermeture", () => {
  const panneau = read("./components/cadre/panneau.tsx");
  assert.match(panneau, /useState\(\(\) => document\.activeElement\)/, "déclencheur mémorisé avant que le titre prenne le focus");
  assert.match(panneau, /return \(\) => \{[^}]*focusAfterClose\(opener, document\.body, document\.querySelector\("main"\)\)/);
});

test("fiche d'un rendez-vous : commandes refusées par le serveur masquées pour la praticienne", () => {
  // Vague 2 : le détail des gardes est dans components/appointment-detail-header.test.ts.
  const fiche = read("./components/appointment-detail.tsx");
  assert.match(fiche, /const commands = appointmentCommands\(account\.role\);/);
  assert.match(fiche, /handleAddNote/, "l'ajout de note reste à tous");
});

test("vague 2 : panneau plein écran sur téléphone, la page, l'en-tête, les onglets et le « + » dessous deviennent inertes", () => {
  const app = read("./app.tsx");
  assert.match(app, /const covered = inertBehindPanel\(panneau !== null, wide\);/);
  assert.match(app, /<main inert=\{covered\}/);
  assert.equal((app.match(/<div className="contents" inert=\{covered\}>/g) ?? []).length, 2, "navigation et onglets");
});

test("vague 2 : la fermeture du panneau ne retire pas le focus d'un élément de l'écran (rail)", () => {
  const panneau = read("./components/cadre/panneau.tsx");
  assert.match(panneau, /if \(!shouldRestoreFocus\(active, document\.body, Boolean\(panel && active && panel\.contains\(active\)\)\)\) return;/);
});

test("vague 2 : une note en cours de saisie est un brouillon que le panneau protège d'Échap", () => {
  assert.match(read("./components/cadre/panneau.tsx"), /const DRAFTS = "input\[data-brouillon\], textarea\[data-brouillon\]";/);
});

test("vague 2 : le « + » de la praticienne ne charge rien à partir de 768 px, où il est masqué", () => {
  assert.match(read("./components/cadre/bouton-plus.tsx"), /useProchainRendezVous\(plusWatchesStaff\(action, account\.staff_id, wide\)\)/);
});

// Relecture finale (point 2) : le « + » du téléphone crée le rendez-vous le jour affiché par
// l'agenda ; ailleurs, aujourd'hui (défaut de CreateAppointment).
test("bouton « + » : nouveau rendez-vous le jour affiché par l'agenda", () => {
  const app = read("./app.tsx");
  assert.match(app, /<BoutonPlus agendaDay=\{view === "calendar" \? appState\.calendarDate : undefined\} \/>/);
  const plus = read("./components/cadre/bouton-plus.tsx");
  assert.match(plus, /export function BoutonPlus\(\{ agendaDay \}: \{ agendaDay\?: string \}\)/);
  assert.match(plus, /<CreateAppointment defaultDate=\{agendaDay\} onClose=/);
});

// Revue impeccable (F) : l'alerte de sauvegarde dit à chaque rôle quoi faire ; seul
// l'administrateur ouvre la rubrique Sauvegardes, les autres savent à qui le dire.
test("alerte de sauvegarde : lien pour l'administrateur, « Prévenez l'administrateur » pour les autres rôles", () => {
  const bandeaux = read("./components/bandeaux.tsx");
  assert.match(bandeaux, /\{role === "admin" && \(\s*<>\{" "\}<a className="-my-2 inline-flex min-h-11 shrink-0 items-center underline @md:my-0" href=\{sauvegardes\}/);
  assert.match(bandeaux, /\{role !== "admin" && \(\s*\/\/[^\n]*\n\s*<>\{" "\}\{t\("bandeau\.prevenir_admin"\)\}<\/>\s*\)\}/);
});

// Retouche 1 (critique de la vague 1) : au téléphone, l'alerte tient sur une ligne au moment d'encaisser.
test("alerte de sauvegarde au téléphone : une ligne, forme courte coupée proprement ; texte entier à partir de 28 rem", () => {
  const bandeaux = read("./components/bandeaux.tsx");
  assert.match(bandeaux, /<div role="alert" className="hors-panneau @container /);
  assert.match(bandeaux, /<span className="min-w-0 flex-1 truncate @md:whitespace-normal">/);
  assert.match(bandeaux, /<span className="@md:hidden">\{t\("bandeau\.sauvegarde_court"\)\}<\/span>/);
  assert.match(bandeaux, /<span className="hidden @md:inline">\{t\("bandeau\.sauvegarde"\)\}<\/span>/);
});

test("rail replié pendant qu'un panneau est posé par-dessus, sans toucher au choix de l'appareil", () => {
  const rail = read("./components/cadre/rail.tsx");
  assert.match(rail, /const expanded = stored && !folded;/);
  assert.match(rail, /\{!folded && <RailButton/, "pas de bouton « Déployer » sans effet");
  assert.doesNotMatch(rail.slice(rail.indexOf("const expanded = stored")), /writeRailExpanded\(false\)/);
});
