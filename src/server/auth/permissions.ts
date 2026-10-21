import type { Role } from "./accounts.ts";

const ANY: Role[] = ["admin", "manager", "reception", "practitioner"];
const BUSINESS: Role[] = ["manager", "reception", "practitioner"];
const FRONT: Role[] = ["manager", "reception"];
const MANAGER: Role[] = ["manager"];
const ADMIN: Role[] = ["admin"];
const LEADS: Role[] = ["admin", "manager"];

type Rule = { methods: string[] | "*"; path: RegExp; roles: Role[] };

/** Première règle qui correspond (méthode et chemin) ; refus par défaut. Ordre important. */
// Les sous-routes réservées (fidélité, produit par WhatsApp) acceptent tout segment d'identifiant : un identifiant mal formé
// (`0x1`) tombe sur la règle réservée, pas sur la règle générale de la ressource ; la route répond 404.
const RULES: Rule[] = [
  { methods: "*", path: /^\/api\/auth\//, roles: ANY },
  { methods: ["GET"], path: /^\/api\/events$/, roles: ANY },
  { methods: ["GET"], path: /^\/api\/stats$/, roles: BUSINESS },
  { methods: ["GET"], path: /^\/api\/(appointments|calendar)(\/|$)/, roles: BUSINESS },
  { methods: ["POST"], path: /^\/api\/appointments\/\d+\/notes$/, roles: BUSINESS },
  { methods: ["POST", "PUT", "DELETE"], path: /^\/api\/appointments(\/\d+)?$/, roles: FRONT },
  // Suppléments (spec du 18/10/2026 § 3) : ceux d'un rendez-vous comme sa modification (gérante et réception) ;
  // la liste des suppléments possibles d'une prestation et sa copie, comme le catalogue (gérante).
  { methods: ["PUT"], path: /^\/api\/appointments\/\d+\/supplements$/, roles: FRONT },
  { methods: ["PUT"], path: /^\/api\/services\/\d+\/supplements$/, roles: MANAGER },
  { methods: ["POST"], path: /^\/api\/services\/\d+\/supplements\/copie$/, roles: MANAGER },
  { methods: ["DELETE"], path: /^\/api\/notes\/\d+$/, roles: FRONT },
  { methods: ["POST", "DELETE"], path: /^\/api\/blocked-slots(\/\d+)?$/, roles: FRONT },
  // Transfert des rendez-vous d'une praticienne absente (spec du 04/10/2026, décision 13) : gérante et réception.
  { methods: ["GET"], path: /^\/api\/transfers\/proposal$/, roles: FRONT },
  { methods: ["POST"], path: /^\/api\/transfers$/, roles: FRONT },
  // Réservation en ligne (spec du 16/10/2026 § 4.4 à 4.6) : demandes à la réception et à la gérante ; l'agenda aussi à la
  // praticienne (sans nom) ; état et essai de la liaison à la gérante et à l'administrateur ; QR code à la gérante.
  { methods: ["GET"], path: /^\/api\/demandes-en-ligne\/agenda$/, roles: BUSINESS },
  { methods: ["GET", "POST"], path: /^\/api\/demandes-en-ligne(\/|$)/, roles: FRONT },
  { methods: ["GET", "POST"], path: /^\/api\/en-ligne\/(etat|tester)$/, roles: LEADS },
  { methods: ["GET"], path: /^\/api\/en-ligne\/qr$/, roles: MANAGER },
  // Fidélité (mini CRM § 2) : solde et écritures pour la réception et la gérante ; correction par la gérante seule.
  { methods: ["GET"], path: /^\/api\/clients\/[^/]+\/loyalty$/, roles: FRONT },
  { methods: ["POST"], path: /^\/api\/clients\/[^/]+\/loyalty$/, roles: MANAGER },
  { methods: ["GET"], path: /^\/api\/clients(\/|$)/, roles: BUSINESS },
  { methods: ["GET"], path: /^\/api\/institut\/logos\/impression$/, roles: MANAGER },
  { methods: ["PUT", "DELETE"], path: /^\/api\/institut\/logos\/[^/]+$/, roles: MANAGER },
  { methods: ["PUT"], path: /^\/api\/clients\/\d+$/, roles: BUSINESS },
  { methods: ["POST", "DELETE"], path: /^\/api\/clients(\/\d+)?$/, roles: FRONT },
  // Photo d'un produit (spec du 04/10/2026) : lue par tout compte connecté, déposée et retirée par la gérante.
  { methods: ["GET"], path: /^\/api\/products\/\d+\/image$/, roles: ANY },
  { methods: ["PUT", "DELETE"], path: /^\/api\/products\/\d+\/image$/, roles: MANAGER },
  // Produit recommandé par WhatsApp : texte prérempli et envoi, réception et gérante (jamais l'administrateur, qui ne voit pas les textes).
  { methods: ["GET", "POST"], path: /^\/api\/products\/[^/]+\/whatsapp$/, roles: FRONT },
  // Horaires de l'institut (réservation en ligne, § 4.1) : lus par les rôles métier pour griser l'agenda.
  { methods: ["GET"], path: /^\/api\/horaires$/, roles: BUSINESS },
  { methods: ["GET"], path: /^\/api\/(staff|services|products)(\/|$)/, roles: BUSINESS },
  { methods: ["PUT"], path: /^\/api\/products\/\d+$/, roles: FRONT },
  { methods: ["POST", "PUT", "DELETE"], path: /^\/api\/(staff|services|products)(\/\d+)?$/, roles: MANAGER },
  { methods: "*", path: /^\/api\/accounts(\/|$)/, roles: LEADS },
  { methods: "*", path: /^\/api\/devices(\/|$)/, roles: LEADS },
  // Import de données (spec du 18/10/2026 § 2.1) : modèles, aperçu et import à la gérante et à l'administrateur.
  { methods: ["GET"], path: /^\/api\/import\/[^/]+\/modele$/, roles: LEADS },
  { methods: ["POST"], path: /^\/api\/import\/[^/]+(\/apercu)?$/, roles: LEADS },
  { methods: "*", path: /^\/api\/settings(\/|$)/, roles: LEADS },
  { methods: "*", path: /^\/api\/devise$/, roles: LEADS },
  { methods: "*", path: /^\/api\/outbox(\/|$)/, roles: ["admin", "manager", "reception"] },
  { methods: ["GET"], path: /^\/api\/backups\/status$/, roles: LEADS },
  { methods: "*", path: /^\/api\/backups(\/|$)/, roles: ADMIN },
  { methods: ["GET"], path: /^\/api\/audit$/, roles: LEADS },
  // Caisse (sous-projet 5 § 4.5) : vente et lecture des factures pour la gérante et la réception.
  // La praticienne aussi (encaissement par la praticienne, vague 3) : la route refuse tant que la gérante
  // ne l'a pas activé, et ne lui laisse que ses propres rendez-vous, sans remise.
  { methods: ["GET"], path: /^\/api\/sales\/settings$/, roles: BUSINESS },
  // Reprise d'une vente dont la réponse s'est perdue (report de la vague 2) : la facture émise pour un `request_id`.
  { methods: ["GET"], path: /^\/api\/sales\/[A-Za-z0-9-]{1,64}$/, roles: BUSINESS },
  { methods: ["POST"], path: /^\/api\/sales$/, roles: BUSINESS },
  // Ticket de la facture : la praticienne, celle de ses propres rendez-vous seulement (vérifié par la route).
  { methods: ["GET"], path: /^\/api\/invoices\/\d+\/pdf$/, roles: BUSINESS },
  { methods: ["GET"], path: /^\/api\/invoices(\/\d+(\/pdf)?)?$/, roles: FRONT },
  // Avoirs (§ 6.1) : la route refuse aussi la réception tant que la gérante ne l'a pas autorisée.
  { methods: ["POST"], path: /^\/api\/credit-notes$/, roles: FRONT },
  // Clôture de caisse (§ 6.3) : caisse du jour, clôture et son ticket.
  { methods: ["GET"], path: /^\/api\/cash\/(day|closings\/\d+\/pdf)$/, roles: FRONT },
  { methods: ["POST"], path: /^\/api\/cash\/closings$/, roles: FRONT },
  // Acomptes (§ 6.2) : la route refuse tant que la gérante ne les a pas activés ; « Rembourser » et « Garder » à la gérante.
  { methods: ["GET"], path: /^\/api\/deposits(\/\d+(\/pdf)?)?$/, roles: FRONT },
  { methods: ["POST"], path: /^\/api\/deposits(\/\d+\/settle)?$/, roles: FRONT },
  // WhatsApp (sous-projet 7 § 3 et § 4) : le texte des messages n'est jamais rendu à l'administrateur.
  { methods: ["GET"], path: /^\/api\/whatsapp\/status$/, roles: ["admin", "manager", "reception"] },
  { methods: ["POST"], path: /^\/api\/whatsapp\/session\/(start|logout)$/, roles: LEADS },
  { methods: ["GET"], path: /^\/api\/whatsapp\/qr$/, roles: LEADS },
  { methods: ["GET"], path: /^\/api\/whatsapp\/texts$/, roles: MANAGER },
  { methods: ["GET"], path: /^\/api\/whatsapp\/manual$/, roles: FRONT },
  { methods: ["POST"], path: /^\/api\/whatsapp\/manual\/\d+(\/open)?$/, roles: FRONT },
  { methods: ["POST"], path: /^\/api\/clients\/\d+\/whatsapp$/, roles: FRONT },
  { methods: ["POST"], path: /^\/api\/whatsapp\/documents$/, roles: FRONT },
  // SMS (spec du 04/10/2026, § 3) : état pour l'administrateur et la gérante, SMS d'essai pour l'administrateur.
  { methods: ["GET"], path: /^\/api\/sms\/status$/, roles: LEADS },
  { methods: ["POST"], path: /^\/api\/sms\/test$/, roles: ADMIN },
  // Impression directe (spec du 03/10/2026) : la praticienne, ses propres factures seulement (vérifié par la route).
  { methods: ["POST"], path: /^\/api\/print\/documents$/, roles: BUSINESS },
  { methods: ["POST"], path: /^\/api\/print\/drawer$/, roles: FRONT },
  { methods: ["POST"], path: /^\/api\/print\/test$/, roles: MANAGER },
  // Campagnes du mini CRM (décision 27) : aperçu, envoi et liste à la gérante seule.
  { methods: "*", path: /^\/api\/campaigns(\/|$)/, roles: MANAGER },
  // Seuil d'absence de la fiche (décision 6) : lu par les trois rôles métier, jamais modifié ici.
  { methods: ["GET"], path: /^\/api\/relances\/seuil$/, roles: BUSINESS },
  // Heure du serveur et caisse bloquée si l'heure recule (distribution D-11, D-13) : bandeau de l'administrateur et de la gérante.
  { methods: ["GET"], path: /^\/api\/heure$/, roles: LEADS },
  // Mise à jour par le réseau (spec du 21/10/2026, M-15) : versions lues par l'administrateur et la gérante ;
  // vérification, demande et mode à l'administrateur seul (mot de passe retapé pour la demande et le mode).
  { methods: ["GET"], path: /^\/api\/mise-a-jour$/, roles: LEADS },
  { methods: ["POST"], path: /^\/api\/mise-a-jour(\/verifier)?$/, roles: ADMIN },
  { methods: ["PUT"], path: /^\/api\/mise-a-jour\/mode$/, roles: ADMIN },
  // Correction de l'heure du serveur (distribution D-12) : administrateur seul, mot de passe retapé.
  { methods: ["POST"], path: /^\/api\/heure$/, roles: ADMIN },
  // Remise à zéro de la base de formation (distribution D-19) : administrateur de la formation, mot de passe retapé.
  { methods: ["POST"], path: /^\/api\/formation\/remise-a-zero$/, roles: ADMIN },
  // Description de l'API et liste des routes (décision 14 de la passe V 1.0) : tout compte connecté.
  { methods: ["GET"], path: /^\/api\/(openapi\.json|llms\.txt)$/, roles: ANY },
];

export function can(role: Role, method: string, path: string): boolean {
  const rule = RULES.find((r) => (r.methods === "*" || r.methods.includes(method)) && r.path.test(path));
  return rule ? rule.roles.includes(role) : false;
}

const FIELD_LIMITS: Partial<Record<Role, Partial<Record<"clients" | "products", string[]>>>> = {
  // Mini CRM (décision 4) : la praticienne apprend les préférences en soin, elle les écrit comme la note.
  practitioner: { clients: ["notes", "preferences"] },
  reception: { products: ["stock"] },
};

/** Ne garde que les champs qu'un rôle a le droit de modifier sur une ressource. */
export function restrictFields(role: Role, resource: "clients" | "products", body: Record<string, unknown>): Record<string, unknown> {
  const allowed = FIELD_LIMITS[role]?.[resource];
  if (!allowed) return body;
  return Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
}

// Rôles qui ne voient pas le chiffre d'affaires (§ 3.4) : aucun montant de
// rendez-vous ne leur est renvoyé, sinon la somme des rendez-vous terminés le redonnerait.
const REVENUE_HIDDEN: Role[] = ["practitioner"];

/**
 * Produit vu par la praticienne (V1-04, décision 3) : sans prix d'achat
 * (`cost`) ; le prix de vente reste, elle conseille la cliente.
 */
export function redactProduct<T extends Record<string, unknown>>(role: Role, product: T): T | Omit<T, "cost"> {
  if (role !== "practitioner") return product;
  const { cost: _cost, ...rest } = product;
  return rest;
}

/**
 * Fiche de l'équipe vue par la praticienne (V1-04, décision 3) : sans le
 * courriel ni le téléphone de ses collègues ; sa propre fiche les garde.
 */
export function redactStaff<T extends Record<string, unknown>>(account: { role: Role; staff_id: number | null }, staff: T): T | Omit<T, "email" | "phone"> {
  if (account.role !== "practitioner" || staff.id === account.staff_id) return staff;
  const { email: _email, phone: _phone, ...rest } = staff;
  return rest;
}

/**
 * Retire d'un rendez-vous (et de ses prestations) les montants qu'un rôle ne
 * doit pas voir ; la praticienne garde l'état « payé », sans la facture (sous-projet 5 § 4.5).
 */
export function redactAppointment(role: Role, appointment: Record<string, unknown>): Record<string, unknown> {
  if (!REVENUE_HIDDEN.includes(role)) return appointment;
  const { total_price: _total, invoice_id: _invoice, invoice_number: _number, invoice_total: _invoiceTotal, ...rest } = appointment;
  if (Array.isArray(rest.appointment_services)) {
    rest.appointment_services = rest.appointment_services.map((svc: Record<string, unknown>) => {
      const { price: _price, ...kept } = svc;
      // Suppléments (spec du 18/10/2026 § 3.3) : libellés et minutes gardés ; le prix d'un article du catalogue
      // retiré, celui d'un supplément libre gardé (l'encaissement par la praticienne en a besoin, il n'est nulle part ailleurs).
      if (Array.isArray(kept.supplements)) {
        kept.supplements = kept.supplements.map((s: Record<string, unknown>) => {
          if (s.kind === "libre") return s;
          const { price: _p, ...sans } = s;
          return sans;
        });
      }
      return kept;
    });
  }
  return rest;
}
