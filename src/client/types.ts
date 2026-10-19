import type { Semaine } from "../shared/horaires";
export type View = "dashboard" | "calendar" | "appointments" | "clients" | "staff" | "services" | "products" | "charte" | "reglages" | "vente" | "caisse" | "demandes";

export type AppointmentStatus = "booked" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show";

/** Article d'une liste de suppléments possibles (spec du 18/10/2026 § 3.1). */
export interface SupplementRef {
  kind: "service" | "product";
  ref_id: number;
}

/** Supplément posé sous une prestation d'un rendez-vous (§ 3.3) : libellés, prix et minutes figés ; sans prix d'un article du catalogue pour la praticienne (celui d'un libre lui reste). */
export interface AppointmentSupplement {
  id: number;
  appointment_service_id: number;
  kind: "service" | "product" | "libre";
  ref_id: number | null;
  label_fr: string;
  label_en: string;
  quantity: number;
  price?: number;
  minutes: number;
  position: number;
}

export interface Appointment {
  id: number;
  identifier: string;
  client_id: number;
  staff_id: number | null;
  status: AppointmentStatus;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  total_price: number;
  notes: string;
  is_recurring: number;
  recurrence_interval: string;
  client_name?: string;
  client_phone?: string;
  staff_name?: string | null;
  staff_color?: string | null;
  service_names?: string | null;
  service_names_en?: string | null;
  latest_note?: string | null;
  /** 1 tant qu'une facture active (non entièrement reprise par un avoir) cite le rendez-vous (sous-projet 5 § 3.4). */
  paid?: number;
  /** 1 dès qu'une facture a existé pour le rendez-vous, même reprise entièrement : il ne se supprime plus (correctif final, point 1). La praticienne le garde (ce n'est pas un montant). */
  invoiced?: number;
  /** 1 si un acompte `held` existe pour ce rendez-vous, 0 sinon (correctif final, point 1) : aucun montant, la praticienne le garde pour savoir qu'elle ne doit pas encaisser. */
  deposit_held?: number;
  /** Facture qui le cite ; absente pour la praticienne, qui ne voit que `paid` et `invoiced`. */
  invoice_id?: number | null;
  invoice_number?: string | null;
  invoice_total?: number | null;
  appointment_services?: AppointmentService[];
  appointment_notes?: AppointmentNote[];
  created_at: string;
  updated_at: string;
  /** 1 si le rendez-vous vient d'une demande en ligne (réservation en ligne, étape 3). */
  en_ligne?: number;
}

export interface AppointmentService {
  id: number;
  appointment_id: number;
  service_id: number;
  service_name?: string;
  service_name_en?: string | null;
  price: number;
  duration: number;
  supplements?: AppointmentSupplement[];
}

export interface AppointmentNote {
  id: number;
  appointment_id: number;
  content: string;
  created_at: string;
}

export interface Client {
  id: number;
  name: string;
  email: string;
  phone: string;
  notes: string;
  /** Canal de ses messages (spec du 04/10/2026, § 1) : WhatsApp (SMS en secours), SMS seulement, aucun. */
  channel: "whatsapp" | "sms" | "none";
  /** Langue de ses messages ; vide : langue de l'institut. */
  language: "" | "fr" | "en";
  /** Anniversaire sans année, `MM-JJ` ; vide s'il est inconnu (mini CRM, décision 1). */
  birthday: string;
  /** Préférences pour chaque visite (décision 2). */
  preferences: string;
  /** Étiquettes libres, dans l'ordre de saisie (décision 3). */
  tags: string[];
  /** Numéro de carte (mini CRM § 5) ; null s'il n'y en a pas. */
  card?: string | null;
  appointment_count?: number;
  /** Date (aaaa-mm-jj) du dernier rendez-vous terminé ; null si elle n'est jamais venue. */
  last_visit?: string | null;
  /** Nombre de rendez-vous terminés. */
  visit_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Staff {
  id: number;
  name: string;
  /** Absents pour la praticienne qui lit la fiche d'une collègue (V1-04). */
  email?: string;
  phone?: string;
  title: string;
  title_en: string;
  color: string;
  active: number;
  appointment_count?: number;
  created_at: string;
  horaires: Semaine | null;
  en_ligne: number;
  service_ids: number[];
}

export interface Service {
  id: number;
  name: string;
  description: string;
  duration: number;
  price: number;
  color: string;
  category: string;
  name_en: string;
  description_en: string;
  category_en: string;
  active: number;
  /** Nombre de rendez-vous où figure cette prestation ; sert à ne pas proposer « Supprimer » quand elle est utilisée. */
  appointment_count?: number;
  en_ligne: number;
  /** 1 : ne se vend pas seule, seulement en supplément d'une prestation qui l'accepte. */
  supplement_seulement?: number;
  /** Suppléments possibles, dans l'ordre réglé par la gérante. */
  supplements?: SupplementRef[];
  created_at: string;
}

export interface BlockedSlot {
  id: number;
  staff_id: number;
  staff_name?: string;
  blocked_date: string;
  start_time: string;
  end_time: string;
  reason: string;
  created_at: string;
}

export interface Product {
  id: number;
  name: string;
  brand: string;
  category: string;
  sku: string;
  price: number;
  /** Prix d'achat ; absent pour la praticienne (V1-04). */
  cost?: number;
  stock: number;
  low_stock_alert: number;
  name_en: string;
  category_en: string;
  /** Version de la photo (adresse `/api/products/{id}/image?v=…`) ; null sans photo. */
  image_version?: number | null;
  created_at: string;
  updated_at: string;
}

export interface Stats {
  appointments: number;
  clients: number;
  staff: number;
  services: number;
  products: number;
  today_appointments: number;
  upcoming_appointments: number;
  completed_appointments: number;
  /** Absent pour la praticienne (spec § 3.4 : retiré des réponses). */
  revenue?: number;
  low_stock_products: number;
}

export interface PaginatedState {
  page: number;
  limit: number;
  total: number;
}

export interface ClientLookup {
  id: number;
  name: string;
  card?: string | null;
}

export interface StaffLookup {
  id: number;
  name: string;
  color: string;
  horaires: Semaine | null;
  service_ids: number[];
}

/** Synthèse de la fiche d'une cliente (mini CRM § 1), calculée par le serveur ; montants absents pour la praticienne. */
export interface ClientSummary {
  visits: number;
  last_visit: string | null;
  days_since: number | null;
  next_appointment: { id: number; date: string; time: string } | null;
  usual_services: { name: string; name_en: string; count: number }[];
  favorite_staff: { id: number; name: string; color: string; count: number } | null;
  products: { label_fr: string; label_en: string; quantity: number; last: number }[];
  total_spent?: number;
  average_basket?: number;
  invoice_count?: number;
  loyalty: { balance: number; next_tier: { points: number; montant: number; missing: number } | null } | null;
}

/** Étiquette existante et nombre de clientes qui la portent. */
export interface TagCount {
  tag: string;
  count: number;
}

/** État d'une demande en ligne (spec du 16/10/2026 § 4.4). */
export type EtatDemande = "a_confirmer" | "en_conflit" | "a_rappeler" | "confirmee" | "autre_horaire" | "refusee" | "traitee";

/** Demande en ligne telle que la rend `GET /api/demandes-en-ligne`. */
export interface DemandeEnLigne {
  id: number;
  type: "creneau" | "rappel";
  etat: EtatDemande;
  service_id: number | null;
  prestation_ref: string;
  prestation_nom: string;
  prestation_nom_en: string;
  staff_demande_id: number | null;
  staff_demande_nom: string | null;
  sans_preference: number;
  staff_id: number | null;
  staff_nom: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  cliente_nom: string;
  cliente_telephone: string;
  cliente_langue: "fr" | "en";
  note: string;
  souhait: { jours: string[]; moments: string[]; precision: string } | null;
  fiche: "connue" | "nouvelle" | "a_verifier";
  client_id: number | null;
  client_nom: string | null;
  tentatives: number;
  appointment_id: number | null;
  autre_date: string | null;
  autre_heure: string | null;
  autre_staff_id: number | null;
  autre_staff_nom: string | null;
  motif: string;
  recue_le: number;
  decidee_le: number | null;
  decidee_par_nom: string | null;
  /** Décision prise mais pas encore transmise au relais. */
  decision_attente: boolean;
}

/** Demande à confirmer dans l'agenda ; la praticienne n'en reçoit que la praticienne et l'horaire. */
export interface DemandeAgenda {
  id?: number;
  staff_id: number;
  start_time: string;
  end_time: string;
  cliente_nom?: string;
  prestation_nom?: string;
  prestation_nom_en?: string;
  sans_preference?: number;
}
