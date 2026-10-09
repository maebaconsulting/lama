export type View = "dashboard" | "calendar" | "appointments" | "clients" | "staff" | "services" | "products" | "charte" | "reglages" | "vente" | "caisse";

export type AppointmentStatus = "booked" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show";

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
}

export interface AppointmentService {
  id: number;
  appointment_id: number;
  service_id: number;
  service_name?: string;
  service_name_en?: string | null;
  price: number;
  duration: number;
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
