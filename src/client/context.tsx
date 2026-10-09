import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { PanelKind, PanelRef } from "./lib/routes";
import type {
  Appointment, Client, ClientSummary, Staff, Service, Product, BlockedSlot, Stats, PaginatedState,
  ClientLookup, StaffLookup, TagCount,
} from "./types";

export interface AppContextValue {
  /** Élément ouvert dans le panneau de détail, d'après l'adresse (sa ligne est marquée dans la liste). */
  panel: PanelRef | null;
  /** Membre de l'équipe à montrer quand l'agenda s'ouvre (« Voir son agenda », vague 4) ; null ensuite. */
  agendaStaffId: number | null;
  setAgendaStaffId: (id: number | null) => void;
  navigate: (to: string) => void;
  /** Ouvre un élément dans le panneau de détail, sans quitter l'écran (sous-projet 4 § 3.3). */
  openPanel: (kind: PanelKind, id: number | string) => void;
  closePanel: () => void;
  isAgent: boolean;
  stats: Stats;

  // Appointments
  appointments: Appointment[];
  appointmentsPag: PaginatedState;
  setAppointmentsPage: (page: number) => void;
  appointmentsSearch: string;
  setAppointmentsSearch: (s: string) => void;
  appointmentsStatusFilter: string;
  setAppointmentsStatusFilter: (s: string) => void;
  addAppointment: (data: {
    client_id: number;
    staff_id?: number | null;
    scheduled_date: string;
    start_time?: string;
    notes?: string;
    is_recurring?: number;
    recurrence_interval?: string;
    service_ids?: number[];
    allow_conflict?: boolean;
  }) => Promise<void>;
  updateAppointment: (id: number, data: Partial<Appointment> & { allow_conflict?: boolean; notify_transfer?: boolean }) => Promise<void>;
  deleteAppointment: (id: number) => Promise<void>;

  // Appointment detail
  selectedAppointment: Appointment | null;
  selectAppointment: (id: number | null) => Promise<void>;
  addAppointmentNote: (aptId: number, content: string) => Promise<void>;
  deleteAppointmentNote: (noteId: number) => Promise<void>;

  // Calendar
  calendarAppointments: Appointment[];
  calendarBlocked: BlockedSlot[];
  calendarDate: string;
  setCalendarDate: (date: string) => void;
  addBlockedSlot: (data: { staff_id: number; blocked_date: string; start_time: string; end_time: string; reason?: string; allow_conflict?: boolean }) => Promise<void>;
  deleteBlockedSlot: (id: number) => Promise<void>;

  // Clients
  clients: Client[];
  clientsPag: PaginatedState;
  setClientsPage: (page: number) => void;
  clientsSearch: string;
  setClientsSearch: (s: string) => void;
  addClient: (data: Partial<Client>) => Promise<Client>;
  updateClient: (id: number, data: Partial<Client>) => Promise<void>;
  deleteClient: (id: number) => Promise<void>;
  selectedClient: Client | null;
  selectedClientAppointments: Appointment[];
  selectClient: (id: number | null) => Promise<void>;
  /** Synthèse de la fiche ouverte (mini CRM § 1) : chiffres, habitudes, ligne d'état. */
  selectedClientSummary: ClientSummary | null;
  /** Étiquette du filtre de la liste (`?etiquette=` dans l'adresse) ; vide : toutes. */
  clientsTag: string;
  setClientsTag: (tag: string) => void;
  /** Étiquettes existantes avec leur nombre de clientes, les plus portées d'abord. */
  clientTags: TagCount[];
  /** Produit ouvert dans le panneau (vague 4), lu par son identifiant (il peut être hors de la page chargée). */
  selectedProduct: Product | null;
  selectProduct: (id: number | null) => Promise<void>;

  // Staff
  staffMembers: Staff[];
  addStaff: (data: Partial<Staff>) => Promise<void>;
  updateStaff: (id: number, data: Partial<Staff>) => Promise<void>;
  deleteStaff: (id: number) => Promise<void>;

  // Services
  services: Service[];
  /** Relit le catalogue des prestations (mineur 2 de la relecture finale : refus 409 « total », prix changé). */
  reloadServices: () => Promise<void>;
  addService: (data: Partial<Service>) => Promise<void>;
  updateService: (id: number, data: Partial<Service>) => Promise<void>;
  deleteService: (id: number) => Promise<void>;

  // Products
  products: Product[];
  productsPag: PaginatedState;
  setProductsPage: (page: number) => void;
  productsSearch: string;
  setProductsSearch: (s: string) => void;
  addProduct: (data: Partial<Product>) => Promise<void>;
  updateProduct: (id: number, data: Partial<Product>) => Promise<void>;
  deleteProduct: (id: number) => Promise<void>;
  /** Relit la fiche ouverte et la liste après un changement de photo (images des produits). */
  refreshProduct: (id: number) => Promise<void>;

  // Lookups
  clientLookup: ClientLookup[];
  staffLookup: StaffLookup[];

  loading: boolean;
  error: string | null;
  setError: (msg: string | null) => void;
}

export const AppContext = createContext<AppContextValue>(null!);

export function useApp() {
  return useContext(AppContext);
}
