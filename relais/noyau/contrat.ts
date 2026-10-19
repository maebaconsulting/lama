import { z } from "@hono/zod-openapi";
import { FORME_NOM, FORME_PRENOM } from "./prenom.ts";
import { ajouterJours, dateValide, enMinutes, fuseauValide } from "./temps.ts";
import { CONTRASTE_ACCENT, CONTRASTE_TEXTE, contraste, COULEUR, POLICES, texteSur } from "./theme.ts";

/**
 * Contrat d'interface v1 entre lama et une application de réservation (spec du 16/10/2026 § 2,
 * docs/reservation-en-ligne/contrat-v1.md). Ces schémas font foi : ils valident les appels reçus et
 * produisent la description OpenAPI publiée. Les champs inconnus sont ignorés (règle d'évolution).
 */

export const Heure = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "heure hh:mm attendue");
export const DateJour = z.string().refine(dateValide, "date AAAA-MM-JJ attendue");
export const Id = z.string().min(1).max(64);
export const Langue = z.enum(["fr", "en"]);
export const Texte = z.object({ fr: z.string().max(2000), en: z.string().max(2000) });
export type Texte = z.infer<typeof Texte>;

/** Image `data:` de 200 ko au plus, une fois décodée. */
const TAILLE_IMAGE = 200 * 1024;
export const Image = z.string()
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "image data:image/...;base64 attendue")
  .refine((v) => Math.floor(((v.length - v.indexOf(",") - 1) * 3) / 4) <= TAILLE_IMAGE, "image de 200 ko au plus");

export const Telephone = z.string().regex(/^\+[1-9]\d{6,14}$/, "téléphone au format international E.164 attendu");

export const Devise = z.object({
  code: z.string().regex(/^[A-Z]{3}$/),
  decimales: z.number().int().min(0).max(3),
  symbole: z.string().min(1).max(8),
  position: z.enum(["avant", "apres"]),
});

export const Prestation = z.object({
  id: Id, nom: Texte, categorie: Texte, description: Texte,
  duree: z.number().int().min(5).max(720),
  prix: z.number().int().min(1),
});

export const Praticienne = z.object({
  id: Id,
  prenom: z.string().min(1).max(60),
  photo: Image.nullable().default(null),
  prestations: z.array(Id).max(500),
});

/** Plage libre `["09:00", "12:30"]`, fin exclusive. */
export const Plage = z.tuple([Heure, Heure]).refine(([a, b]) => enMinutes(a) < enMinutes(b), "début avant la fin attendu");

/** Thème de la page du salon (facultatif, ajout du 18/10/2026) : sans lui, la charte de lama. */
export const Theme = z.object({
  fond: z.string().regex(COULEUR, "couleur #RRGGBB attendue"),
  accent: z.string().regex(COULEUR, "couleur #RRGGBB attendue"),
  police: z.enum(POLICES),
}).superRefine((t, ctx) => {
  if (contraste(texteSur(t.fond), t.fond) < CONTRASTE_TEXTE) ctx.addIssue({ code: "custom", message: "contraste du texte sur le fond inférieur à 4,5:1", path: ["fond"] });
  if (contraste(t.accent, t.fond) < CONTRASTE_ACCENT) ctx.addIssue({ code: "custom", message: "contraste de l'accent sur le fond inférieur à 3:1", path: ["accent"] });
}).openapi("Theme");

const PlagesDuJour = z.array(Plage).max(2);
/** Horaires d'ouverture (facultatifs, ajout du 18/10/2026) : zéro à deux plages par jour, fin exclusive. */
export const Horaires = z.object({
  lun: PlagesDuJour, mar: PlagesDuJour, mer: PlagesDuJour, jeu: PlagesDuJour, ven: PlagesDuJour, sam: PlagesDuJour, dim: PlagesDuJour,
}).openapi("Horaires");

export const Offre = z.object({
  version: z.number().int().min(0),
  institut: z.object({
    nom: z.string().min(1).max(120),
    fuseau: z.string().refine(fuseauValide, "fuseau IANA attendu"),
    telephone: z.string().max(30),
    logo: Image.nullable().default(null),
    devise: Devise,
    langues: z.array(Langue).min(1),
    texte_donnees: Texte,
    theme: Theme.optional(),
    horaires: Horaires.optional(),
  }),
  prestations: z.array(Prestation).max(500),
  praticiennes: z.array(Praticienne).max(100),
}).superRefine((o, ctx) => {
  const ids = new Set(o.prestations.map((p) => p.id));
  if (ids.size !== o.prestations.length) ctx.addIssue({ code: "custom", message: "identifiant de prestation en double", path: ["prestations"] });
  if (new Set(o.praticiennes.map((p) => p.id)).size !== o.praticiennes.length) ctx.addIssue({ code: "custom", message: "identifiant de praticienne en double", path: ["praticiennes"] });
  o.praticiennes.forEach((p, i) => {
    if (p.prestations.some((s) => !ids.has(s))) ctx.addIssue({ code: "custom", message: "prestation inconnue", path: ["praticiennes", i, "prestations"] });
  });
}).openapi("Offre");
export type Offre = z.infer<typeof Offre>;

/** Horizon des plages : `au` au plus 92 jours après `du` (borne la taille du document et le calcul des jours). */
export const HORIZON_MAX_JOURS = 92;

export const Disponibilites = z.object({
  version: z.number().int().min(0),
  genere_le: z.number().int().min(0),
  du: DateJour,
  au: DateJour,
  pas: z.number().int().min(5).max(60),
  delai_minimal: z.number().int().min(0).max(10080),
  plages: z.record(Id, z.record(DateJour, z.array(Plage).max(10))),
}).superRefine((d, ctx) => {
  if (d.du > d.au) ctx.addIssue({ code: "custom", message: "du après au", path: ["du"] });
  if (dateValide(d.du) && dateValide(d.au) && d.au > ajouterJours(d.du, HORIZON_MAX_JOURS)) {
    ctx.addIssue({ code: "custom", message: `au plus ${HORIZON_MAX_JOURS} jours de du à au`, path: ["au"] });
  }
  for (const [p, jours] of Object.entries(d.plages)) {
    for (const date of Object.keys(jours)) {
      if (date < d.du || date > d.au) ctx.addIssue({ code: "custom", message: "date hors de du..au", path: ["plages", p, date] });
    }
  }
}).openapi("Disponibilites");
export type Disponibilites = z.infer<typeof Disponibilites>;

export const JourSemaine = z.enum(["lun", "mar", "mer", "jeu", "ven", "sam", "dim"]);
export const Moment = z.enum(["matin", "apres_midi", "soir"]);
export const Souhait = z.object({
  jours: z.array(JourSemaine).max(7),
  moments: z.array(Moment).max(3),
  precision: z.string().max(500),
});
export type Souhait = z.infer<typeof Souhait>;

export const Cliente = z.object({
  /** Une seule ligne de lettres, 8 mots au plus (ajout du 18/10/2026) : le nom est repris dans les messages et la fiche. */
  nom: z.string().trim().min(1).max(120).regex(FORME_NOM),
  /** Prénom saisi à part (facultatif, ajout du 18/10/2026) ; `nom` reste le nom complet, prénom compris. */
  prenom: z.string().trim().min(1).max(60).regex(FORME_PRENOM).optional(),
  telephone: Telephone,
  langue: Langue,
});
export type Cliente = z.infer<typeof Cliente>;

/** Demande telle qu'une cliente la dépose (page du relais) ou que la route d'essai la reçoit. */
export const DemandeEntranteBase = z.object({
  type: z.enum(["creneau", "rappel"]),
  prestation: Id,
  praticienne: Id.nullable(),
  date: DateJour.nullable(),
  heure: Heure.nullable(),
  souhait: Souhait.nullable(),
  cliente: Cliente,
  note: z.string().max(1000).default(""),
});

/** Un créneau porte une date et une heure ; une demande de rappel porte un souhait. */
export function coherenceDemande(d: { type: "creneau" | "rappel"; date: string | null; heure: string | null; souhait: unknown }, ctx: z.RefinementCtx): void {
  if (d.type === "creneau" && (d.date === null || d.heure === null)) ctx.addIssue({ code: "custom", message: "date et heure attendues", path: ["date"] });
  if (d.type === "rappel" && d.souhait === null) ctx.addIssue({ code: "custom", message: "souhait attendu", path: ["souhait"] });
}

export const DemandeEntrante = DemandeEntranteBase.superRefine(coherenceDemande).openapi("DemandeEntrante");
export type DemandeEntrante = z.infer<typeof DemandeEntrante>;

/** Demande telle que lama la relève (`GET /demandes`). */
export const Demande = z.object({
  id: Id,
  curseur: z.string(),
  type: z.enum(["creneau", "rappel"]),
  recue_le: z.number().int(),
  prestation: Id,
  praticienne: Id.nullable(),
  date: DateJour.nullable(),
  heure: Heure.nullable(),
  souhait: Souhait.nullable(),
  cliente: Cliente,
  note: z.string(),
  acompte: z.null(),
}).openapi("Demande");
export type Demande = z.infer<typeof Demande>;

export const NomDecision = z.enum(["acceptee", "autre_horaire", "refusee", "traitee"]);
export type NomDecision = z.infer<typeof NomDecision>;

/** Issue d'une demande de rappel close (facultative, ajout du 18/10/2026) : avec `sans_suite`, la page de suivi dit « close ». */
export const IssueRappel = z.enum(["rdv_pris", "injoignable", "sans_suite"]);
export type IssueRappel = z.infer<typeof IssueRappel>;

export const Decision = z.object({
  decision: NomDecision,
  horaire: z.object({ date: DateJour, heure: Heure, praticienne: z.string().max(60) }).nullable().default(null),
  message: Texte.nullable().default(null),
  issue: IssueRappel.optional(),
}).superRefine((d, ctx) => {
  if (d.decision === "autre_horaire" && !d.horaire) ctx.addIssue({ code: "custom", message: "horaire attendu", path: ["horaire"] });
}).openapi("Decision");
export type Decision = z.infer<typeof Decision>;

export const Etat = z.object({
  contrat: z.literal("v1"),
  application: z.object({ nom: z.string(), version: z.string() }),
  version_offre: z.number().int().nullable(),
  version_disponibilites: z.number().int().nullable(),
  demandes_en_attente: z.number().int(),
  mode_essai: z.boolean(),
}).openapi("Etat");
export type Etat = z.infer<typeof Etat>;

export const Erreur = z.object({ erreur: z.object({ code: z.string(), message: z.string() }) }).openapi("Erreur");
