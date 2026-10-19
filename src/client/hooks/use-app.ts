import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import { api } from "../api";
import { todayAt } from "../lib/calendrier";
import { loadsActivity } from "../lib/roles";
import { onRefresh } from "../lib/refresh-bus";
import { reloadOpenRecord } from "../lib/open-record";
import { createLatest } from "../lib/panneau";
import { createFirstPassSkip } from "../lib/demarrage";
import { getCalendar } from "./use-journee";
import type { Role } from "../lib/auth-types";
import type { PanelKind, PanelRef } from "../lib/routes";
import { listTagFilter, tagFromSearch, withTagParam } from "../lib/crm";
import { emitRefresh } from "../lib/refresh-bus";
import { useCrm } from "../auth-context";
import type {
  Appointment, Client, ClientSummary, Staff, Service, Product, BlockedSlot, Stats, PaginatedState,
  ClientLookup, StaffLookup, TagCount, SupplementRef,
} from "../types";
import type { AppContextValue } from "../context";

/** Réponse de `GET /api/clients/:id` : la cliente, ses rendez-vous et la synthèse de sa fiche (mini CRM § 1). */
type ClientDetail = { client: Client; appointments: Appointment[]; summary?: ClientSummary | null };

export function useAppState(
  isAgent: boolean,
  navigate: (to: string) => void,
  role: Role,
  openPanel: (kind: PanelKind, id: number | string) => void,
  closePanel: () => void,
  panel: PanelRef | null = null,
): AppContextValue {
  // L'administrateur n'a aucun accès à l'activité : rien n'est chargé pour lui (spec § 2).
  const activity = loadsActivity(role);
  const [stats, setStats] = useState<Stats>({ appointments: 0, clients: 0, staff: 0, services: 0, products: 0, today_appointments: 0, upcoming_appointments: 0, completed_appointments: 0, low_stock_products: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Appointments
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsPag, setAppointmentsPag] = useState<PaginatedState>({ page: 1, limit: 50, total: 0 });
  const [appointmentsSearch, setAppointmentsSearch] = useState("");
  const [appointmentsStatusFilter, setAppointmentsStatusFilter] = useState("");
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);

  // Calendar
  // Jour de l'institut (Douala), quel que soit le fuseau de l'appareil.
  const [calendarDate, setCalendarDate] = useState(todayAt);
  const [agendaStaffId, setAgendaStaffId] = useState<number | null>(null);
  const [calendarAppointments, setCalendarAppointments] = useState<Appointment[]>([]);
  const [calendarBlocked, setCalendarBlocked] = useState<BlockedSlot[]>([]);

  // Clients
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsPag, setClientsPag] = useState<PaginatedState>({ page: 1, limit: 50, total: 0 });
  const [clientsSearch, setClientsSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedClientAppointments, setSelectedClientAppointments] = useState<Appointment[]>([]);
  const [selectedClientSummary, setSelectedClientSummary] = useState<ClientSummary | null>(null);
  // Étiquette du filtre, lue dans l'adresse au démarrage (`?etiquette=`, décision 10).
  const [clientsTag, setClientsTagState] = useState(() => tagFromSearch(window.location.search));
  const [clientTags, setClientTags] = useState<TagCount[]>([]);
  // Interrupteur général du mini CRM : désactivé, le filtre par étiquette est ignoré (l'adresse le garde).
  const crm = useCrm();
  const tagQuery = listTagFilter(clientsTag, crm);

  /** Fiche cliente reçue du serveur : cliente, rendez-vous et synthèse posés ensemble. */
  const applyClientDetail = useCallback((res: ClientDetail) => {
    setSelectedClient(res.client);
    setSelectedClientAppointments(res.appointments);
    setSelectedClientSummary(res.summary ?? null);
  }, []);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Staff, Services
  const [staffMembers, setStaffMembers] = useState<Staff[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  // Products
  const [products, setProducts] = useState<Product[]>([]);
  const [productsPag, setProductsPag] = useState<PaginatedState>({ page: 1, limit: 50, total: 0 });
  const [productsSearch, setProductsSearch] = useState("");

  // Lookups
  const [clientLookup, setClientLookup] = useState<ClientLookup[]>([]);
  const [staffLookup, setStaffLookup] = useState<StaffLookup[]>([]);

  // ── Fetch helpers ──

  const fetchStats = useCallback(async () => {
    const data = await api<Stats>("GET", "/api/stats");
    setStats(data);
  }, []);

  const fetchAppointments = useCallback(async (pag: PaginatedState, search: string, status: string) => {
    const params = new URLSearchParams({ page: String(pag.page), limit: String(pag.limit) });
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    const data = await api<{ appointments: Appointment[]; total: number }>("GET", `/api/appointments?${params}`);
    setAppointments(data.appointments);
    setAppointmentsPag((prev) => ({ ...prev, total: data.total }));
  }, []);

  /**
   * Jour de l'agenda. `atStartup` : la requête passe par le partage de
   * l'accueil (`getCalendar`), qui demande le même jour au même moment ; une
   * seule part au serveur (V1-73). Ensuite (jour changé, signal, retouche),
   * toujours une requête fraîche.
   */
  const fetchCalendar = useCallback(async (date: string, atStartup = false) => {
    const url = `/api/calendar?start=${date}&end=${date}`;
    const data = atStartup ? await getCalendar(url, true) : await api<{ appointments: Appointment[]; blocked_slots: BlockedSlot[] }>("GET", url);
    setCalendarAppointments(data.appointments);
    setCalendarBlocked(data.blocked_slots);
  }, []);

  const fetchClients = useCallback(async (pag: PaginatedState, search: string, tag: string) => {
    const params = new URLSearchParams({ page: String(pag.page), limit: String(pag.limit) });
    if (search) params.set("search", search);
    if (tag) params.set("tag", tag);
    const data = await api<{ clients: Client[]; total: number }>("GET", `/api/clients?${params}`);
    setClients(data.clients);
    setClientsPag((prev) => ({ ...prev, total: data.total }));
  }, []);

  const fetchClientTags = useCallback(async () => {
    const data = await api<{ tags: TagCount[] }>("GET", "/api/clients/tags");
    setClientTags(data.tags);
  }, []);

  const fetchStaff = useCallback(async () => {
    const data = await api<{ staff: Staff[] }>("GET", "/api/staff");
    setStaffMembers(data.staff);
  }, []);

  const fetchServices = useCallback(async () => {
    const data = await api<{ services: Service[] }>("GET", "/api/services");
    setServices(data.services);
  }, []);

  const fetchProducts = useCallback(async (pag: PaginatedState, search: string) => {
    const params = new URLSearchParams({ page: String(pag.page), limit: String(pag.limit) });
    if (search) params.set("search", search);
    const data = await api<{ products: Product[]; total: number }>("GET", `/api/products?${params}`);
    setProducts(data.products);
    setProductsPag((prev) => ({ ...prev, total: data.total }));
  }, []);

  const fetchLookups = useCallback(async () => {
    const [c, s] = await Promise.all([
      api<{ clients: ClientLookup[] }>("GET", "/api/clients/all"),
      api<{ staff: StaffLookup[] }>("GET", "/api/staff/all"),
    ]);
    setClientLookup(c.clients);
    setStaffLookup(s.staff);
  }, []);

  // Premier passage des effets dépendants ignoré (V1-73) : le chargement initial vient de tout demander.
  const skipFirst = useState(() => createFirstPassSkip())[0];

  // ── Initial load ──

  useEffect(() => {
    if (!activity) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      try {
        await Promise.all([
          fetchStats(),
          fetchAppointments(appointmentsPag, "", ""),
          fetchCalendar(calendarDate, true),
          fetchClients(clientsPag, "", tagQuery),
          fetchClientTags(),
          fetchStaff(),
          fetchServices(),
          fetchProducts(productsPag, ""),
          fetchLookups(),
        ]);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activity || skipFirst("appointments")) return;
    fetchAppointments(appointmentsPag, appointmentsSearch, appointmentsStatusFilter).catch((err) => setError((err as Error).message));
  }, [appointmentsPag.page, appointmentsSearch, appointmentsStatusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activity || skipFirst("calendar")) return;
    fetchCalendar(calendarDate).catch((err) => setError((err as Error).message));
  }, [calendarDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activity || skipFirst("clients")) return;
    fetchClients(clientsPag, clientsSearch, tagQuery).catch((err) => setError((err as Error).message));
  }, [clientsPag.page, clientsSearch, tagQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activity || skipFirst("products")) return;
    fetchProducts(productsPag, productsSearch).catch((err) => setError((err as Error).message));
  }, [productsPag.page, productsSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Interrupteur du mini CRM basculé : la fiche ouverte est relue (synthèse rendue ou retirée par le serveur).
  const crmBefore = useRef(crm);
  useEffect(() => {
    if (crmBefore.current === crm) return;
    crmBefore.current = crm;
    if (activity) emitRefresh(["selectedClient"]);
  }, [crm]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Temps réel : recharger ce que les signaux concernent (spec § 6) ──

  const latest = useRef({ appointmentsPag, appointmentsSearch, appointmentsStatusFilter, calendarDate, clientsPag, clientsSearch, clientsTag, tagQuery, productsPag, productsSearch, selectedAppointment, selectedClient, selectedProduct });
  latest.current = { appointmentsPag, appointmentsSearch, appointmentsStatusFilter, calendarDate, clientsPag, clientsSearch, clientsTag, tagQuery, productsPag, productsSearch, selectedAppointment, selectedClient, selectedProduct };

  useEffect(() => {
    if (!activity) return;
    return onRefresh((keys) => {
      const l = latest.current;
      const want = new Set(keys);
      const jobs: Promise<unknown>[] = [];
      if (want.has("stats")) jobs.push(fetchStats());
      if (want.has("appointments")) jobs.push(fetchAppointments(l.appointmentsPag, l.appointmentsSearch, l.appointmentsStatusFilter));
      if (want.has("calendar")) jobs.push(fetchCalendar(l.calendarDate));
      if (want.has("clients")) jobs.push(fetchClients(l.clientsPag, l.clientsSearch, l.tagQuery), fetchClientTags());
      if (want.has("staff")) jobs.push(fetchStaff());
      if (want.has("services")) jobs.push(fetchServices());
      if (want.has("products")) jobs.push(fetchProducts(l.productsPag, l.productsSearch));
      if (want.has("lookups")) jobs.push(fetchLookups());
      // Fiches ouvertes : réponse appliquée seulement si la même fiche est encore
      // ouverte, fermée seulement sur 404 ou 403 (voir reloadOpenRecord).
      if (want.has("selectedAppointment") && l.selectedAppointment) {
        const id = l.selectedAppointment.id;
        jobs.push(reloadOpenRecord({
          id,
          load: () => api<{ appointment: Appointment }>("GET", `/api/appointments/${id}`),
          currentId: () => latest.current.selectedAppointment?.id,
          apply: (r) => setSelectedAppointment(r.appointment),
          // Supprimé ou retiré ailleurs : la fiche se ferme, panneau compris.
          close: () => { setSelectedAppointment(null); closePanel(); },
        }));
      }
      if (want.has("selectedClient") && l.selectedClient) {
        const id = l.selectedClient.id;
        jobs.push(reloadOpenRecord({
          id,
          load: () => api<ClientDetail>("GET", `/api/clients/${id}`),
          currentId: () => latest.current.selectedClient?.id,
          apply: applyClientDetail,
          // Supprimée ailleurs : la fiche se ferme, panneau compris.
          close: () => { setSelectedClient(null); setSelectedClientAppointments([]); setSelectedClientSummary(null); closePanel(); },
        }));
      }
      if (want.has("selectedProduct") && l.selectedProduct) {
        const id = l.selectedProduct.id;
        jobs.push(reloadOpenRecord({
          id,
          load: () => api<{ product: Product }>("GET", `/api/products/${id}`),
          currentId: () => latest.current.selectedProduct?.id,
          apply: (r) => setSelectedProduct(r.product),
          // Supprimé ailleurs : la fiche se ferme, panneau compris.
          close: () => { setSelectedProduct(null); closePanel(); },
        }));
      }
      // Rechargement en arrière-plan : pas de bannière d'erreur, le prochain signal ou geste réessaiera.
      void Promise.allSettled(jobs);
    });
  }, [activity, closePanel, fetchStats, fetchAppointments, fetchCalendar, fetchClients, fetchClientTags, applyClientDetail, fetchStaff, fetchServices, fetchProducts, fetchLookups]);

  // ── Appointments CRUD ──

  const setAppointmentsPage = useCallback((page: number) => setAppointmentsPag((p) => ({ ...p, page })), []);

  const addAppointment = useCallback(async (data: {
    client_id: number; staff_id?: number | null; scheduled_date: string;
    start_time?: string; notes?: string; is_recurring?: number; recurrence_interval?: string; service_ids?: number[];
    supplements?: Record<string, unknown>[];
    allow_conflict?: boolean;
  }) => {
    await api("POST", "/api/appointments", data);
    await fetchAppointments(appointmentsPag, appointmentsSearch, appointmentsStatusFilter);
    await Promise.all([
      fetchStats(),
      fetchCalendar(calendarDate),
      ...(selectedClient?.id === data.client_id
        ? [api<ClientDetail>("GET", `/api/clients/${data.client_id}`).then(applyClientDetail)]
        : []),
    ]);
  }, [appointmentsPag, appointmentsSearch, appointmentsStatusFilter, selectedClient, calendarDate, fetchAppointments, fetchStats, fetchCalendar, applyClientDetail]);

  const updateAppointment = useCallback(async (id: number, data: Partial<Appointment> & { allow_conflict?: boolean; notify_transfer?: boolean }) => {
    await api("PUT", `/api/appointments/${id}`, data);
    await fetchAppointments(appointmentsPag, appointmentsSearch, appointmentsStatusFilter);
    if (selectedAppointment && selectedAppointment.id === id) {
      const res = await api<{ appointment: Appointment }>("GET", `/api/appointments/${id}`);
      setSelectedAppointment(res.appointment);
    }
    await Promise.all([fetchStats(), fetchCalendar(calendarDate)]);
  }, [appointmentsPag, appointmentsSearch, appointmentsStatusFilter, selectedAppointment, calendarDate, fetchAppointments, fetchStats, fetchCalendar]);

  // Suppléments d'un rendez-vous (spec du 18/10/2026 § 3.3) : liste complète, puis mêmes relectures qu'une modification.
  const saveAppointmentSupplements = useCallback(async (id: number, supplements: Record<string, unknown>[], allowConflict = false) => {
    await api("PUT", `/api/appointments/${id}/supplements`, { supplements, ...(allowConflict ? { allow_conflict: true } : {}) });
    await fetchAppointments(appointmentsPag, appointmentsSearch, appointmentsStatusFilter);
    if (selectedAppointment && selectedAppointment.id === id) {
      const res = await api<{ appointment: Appointment }>("GET", `/api/appointments/${id}`);
      setSelectedAppointment(res.appointment);
    }
    await Promise.all([fetchStats(), fetchCalendar(calendarDate)]);
  }, [appointmentsPag, appointmentsSearch, appointmentsStatusFilter, selectedAppointment, calendarDate, fetchAppointments, fetchStats, fetchCalendar]);

  const deleteAppointment = useCallback(async (id: number) => {
    await api("DELETE", `/api/appointments/${id}`);
    if (selectedAppointment && selectedAppointment.id === id) { setSelectedAppointment(null); closePanel(); }
    await fetchAppointments(appointmentsPag, appointmentsSearch, appointmentsStatusFilter);
    await Promise.all([fetchStats(), fetchCalendar(calendarDate)]);
  }, [appointmentsPag, appointmentsSearch, appointmentsStatusFilter, selectedAppointment, calendarDate, closePanel, fetchAppointments, fetchStats, fetchCalendar]);

  // Seule la dernière ouverture compte : ouvrir un rendez-vous puis un autre avant
  // la réponse du premier, la réponse (ou l'échec) tardive du premier est ignorée.
  const appointmentRequests = useRef(createLatest()).current;
  const selectAppointment = useCallback(async (id: number | null) => {
    if (id === null) { appointmentRequests.cancel(); setSelectedAppointment(null); return; }
    if (!activity) return;
    // Une autre fiche encore chargée n'est plus celle du panneau : elle n'est plus
    // suivie en direct (sa suppression ailleurs ne doit pas fermer ce panneau-ci).
    setSelectedAppointment((current) => (current?.id === id ? current : null));
    await appointmentRequests.run(
      async () => await api<{ appointment: Appointment }>("GET", `/api/appointments/${id}`),
      (res) => setSelectedAppointment(res.appointment),
    );
  }, [activity]);

  const addAppointmentNote = useCallback(async (aptId: number, content: string) => {
    await api("POST", `/api/appointments/${aptId}/notes`, { content });
    const res = await api<{ appointment: Appointment }>("GET", `/api/appointments/${aptId}`);
    setSelectedAppointment(res.appointment);
  }, []);

  const deleteAppointmentNote = useCallback(async (noteId: number) => {
    await api("DELETE", `/api/notes/${noteId}`);
    if (selectedAppointment) {
      const res = await api<{ appointment: Appointment }>("GET", `/api/appointments/${selectedAppointment.id}`);
      setSelectedAppointment(res.appointment);
    }
  }, [selectedAppointment]);

  // ── Calendar / Blocked Slots ──

  const addBlockedSlot = useCallback(async (data: { staff_id: number; blocked_date: string; start_time: string; end_time: string; reason?: string; allow_conflict?: boolean }) => {
    await api("POST", "/api/blocked-slots", data);
    await fetchCalendar(calendarDate);
  }, [calendarDate, fetchCalendar]);

  const deleteBlockedSlot = useCallback(async (id: number) => {
    await api("DELETE", `/api/blocked-slots/${id}`);
    await fetchCalendar(calendarDate);
  }, [calendarDate, fetchCalendar]);

  // ── Clients CRUD ──

  const setClientsPage = useCallback((page: number) => setClientsPag((p) => ({ ...p, page })), []);

  /** Choisit l'étiquette du filtre : première page, adresse remplacée sans nouvelle entrée d'historique. */
  const setClientsTag = useCallback((tag: string) => {
    setClientsTagState(tag);
    setClientsPag((p) => ({ ...p, page: 1 }));
    const here = window.location.pathname + window.location.search + window.location.hash;
    const next = withTagParam(here, tag);
    if (next !== here) window.history.replaceState(window.history.state, "", next);
  }, []);

  const addClient = useCallback(async (data: Partial<Client>) => {
    const { client } = await api<{ client: Client }>("POST", "/api/clients", data);
    await Promise.all([fetchClients(clientsPag, clientsSearch, tagQuery), fetchClientTags()]);
    await Promise.all([fetchStats(), fetchLookups()]);
    return client;
  }, [clientsPag, clientsSearch, tagQuery, fetchClients, fetchClientTags, fetchStats, fetchLookups]);

  const updateClient = useCallback(async (id: number, data: Partial<Client>) => {
    await api("PUT", `/api/clients/${id}`, data);
    await Promise.all([fetchClients(clientsPag, clientsSearch, tagQuery), fetchClientTags()]);
    await fetchLookups();
    // Relu seulement si c'est encore la fiche ouverte : une autre cliente ouverte
    // pendant l'enregistrement ne doit pas être écrasée par cette réponse tardive.
    if (latest.current.selectedClient?.id === id) {
      const res = await api<ClientDetail>("GET", `/api/clients/${id}`);
      if (latest.current.selectedClient?.id === id) applyClientDetail(res);
    }
  }, [clientsPag, clientsSearch, tagQuery, fetchClients, fetchClientTags, fetchLookups, applyClientDetail]);

  /** Supprime une cliente sans historique (le serveur refuse sinon, 409 : l'erreur remonte à la fiche) ; son panneau se ferme. */
  const deleteClient = useCallback(async (id: number) => {
    await api("DELETE", `/api/clients/${id}`);
    if (selectedClient && selectedClient.id === id) {
      setSelectedClient(null);
      setSelectedClientAppointments([]);
      setSelectedClientSummary(null);
      closePanel();
    }
    await Promise.all([fetchClients(clientsPag, clientsSearch, tagQuery), fetchClientTags()]);
    await Promise.all([fetchStats(), fetchLookups()]);
  }, [clientsPag, clientsSearch, tagQuery, selectedClient, closePanel, fetchClients, fetchClientTags, fetchStats, fetchLookups]);

  const clientRequests = useRef(createLatest()).current;
  /** Fiche cliente du panneau : seule la dernière demande compte (deux clientes ouvertes coup sur coup). */
  const selectClient = useCallback(async (id: number | null) => {
    if (id === null) { clientRequests.cancel(); setSelectedClient(null); setSelectedClientAppointments([]); setSelectedClientSummary(null); return; }
    if (!activity) return;
    // Autre cliente que celle affichée : on vide tout avant la requête (pas de synthèse ni d'historique de la précédente).
    if (latest.current.selectedClient?.id !== id) {
      setSelectedClient(null);
      setSelectedClientSummary(null);
      setSelectedClientAppointments([]);
    }
    await clientRequests.run(
      async () => await api<ClientDetail>("GET", `/api/clients/${id}`),
      applyClientDetail,
    );
  }, [activity]);

  // ── Staff CRUD ──

  const addStaff = useCallback(async (data: Partial<Staff>) => {
    await api("POST", "/api/staff", data);
    await fetchStaff();
    await Promise.all([fetchStats(), fetchLookups()]);
  }, [fetchStaff, fetchStats, fetchLookups]);

  const updateStaff = useCallback(async (id: number, data: Partial<Staff>) => {
    await api("PUT", `/api/staff/${id}`, data);
    await fetchStaff();
    await fetchLookups();
  }, [fetchStaff, fetchLookups]);

  const deleteStaff = useCallback(async (id: number) => {
    await api("DELETE", `/api/staff/${id}`);
    // Fermé avant le rechargement de la liste : la fiche ne montre pas un instant
    // « Cette fiche n'existe plus. » pendant que la liste rattrape la suppression.
    closePanel();
    await fetchStaff();
    await Promise.all([fetchStats(), fetchLookups()]);
  }, [closePanel, fetchStaff, fetchStats, fetchLookups]);

  // ── Services CRUD ──

  const addService = useCallback(async (data: Partial<Service>) => {
    await api("POST", "/api/services", data);
    await fetchServices();
    await fetchStats();
  }, [fetchServices, fetchStats]);

  const updateService = useCallback(async (id: number, data: Partial<Service>) => {
    await api("PUT", `/api/services/${id}`, data);
    await fetchServices();
  }, [fetchServices]);

  const deleteService = useCallback(async (id: number) => {
    await api("DELETE", `/api/services/${id}`);
    // Fermé avant le rechargement de la liste : la fiche ne montre pas un instant
    // « Cette fiche n'existe plus. » pendant que la liste rattrape la suppression.
    closePanel();
    await fetchServices();
    await fetchStats();
  }, [closePanel, fetchServices, fetchStats]);

  // Suppléments possibles d'une prestation et « Recopier vers… » (spec du 18/10/2026 § 3.1) : le catalogue relu ensuite.
  const saveServiceSupplements = useCallback(async (id: number, items: SupplementRef[]) => {
    await api("PUT", `/api/services/${id}/supplements`, { items });
    await fetchServices();
  }, [fetchServices]);

  const copyServiceSupplements = useCallback(async (id: number, targets: number[]) => {
    await api("POST", `/api/services/${id}/supplements/copie`, { targets });
    await fetchServices();
  }, [fetchServices]);

  // ── Products CRUD ──

  const setProductsPage = useCallback((page: number) => setProductsPag((p) => ({ ...p, page })), []);

  const addProduct = useCallback(async (data: Partial<Product>) => {
    await api("POST", "/api/products", data);
    await fetchProducts(productsPag, productsSearch);
    await fetchStats();
  }, [productsPag, productsSearch, fetchProducts, fetchStats]);

  const updateProduct = useCallback(async (id: number, data: Partial<Product>) => {
    await api("PUT", `/api/products/${id}`, data);
    // La fiche ouverte montre tout de suite la valeur enregistrée (stock ajusté par − et +).
    if (latest.current.selectedProduct?.id === id) {
      const res = await api<{ product: Product }>("GET", `/api/products/${id}`);
      if (latest.current.selectedProduct?.id === id) setSelectedProduct(res.product);
    }
    await Promise.all([fetchProducts(productsPag, productsSearch), fetchStats()]);
  }, [productsPag, productsSearch, fetchProducts, fetchStats]);

  const refreshProduct = useCallback(async (id: number) => {
    if (latest.current.selectedProduct?.id === id) {
      const res = await api<{ product: Product }>("GET", `/api/products/${id}`);
      if (latest.current.selectedProduct?.id === id) setSelectedProduct(res.product);
    }
    await fetchProducts(productsPag, productsSearch);
  }, [productsPag, productsSearch, fetchProducts]);

  const productRequests = useRef(createLatest()).current;
  /** Produit du panneau, lu par son identifiant : seule la dernière demande compte. */
  const selectProduct = useCallback(async (id: number | null) => {
    if (id === null) { productRequests.cancel(); setSelectedProduct(null); return; }
    if (!activity) return;
    setSelectedProduct((current) => (current?.id === id ? current : null));
    await productRequests.run(
      async () => await api<{ product: Product }>("GET", `/api/products/${id}`),
      (res) => setSelectedProduct(res.product),
    );
  }, [activity]);

  const deleteProduct = useCallback(async (id: number) => {
    await api("DELETE", `/api/products/${id}`);
    await fetchProducts(productsPag, productsSearch);
    await fetchStats();
  }, [productsPag, productsSearch, fetchProducts, fetchStats]);

  return {
    navigate, openPanel, closePanel, panel, isAgent, stats, agendaStaffId, setAgendaStaffId,
    appointments, appointmentsPag, setAppointmentsPage, appointmentsSearch, setAppointmentsSearch,
    appointmentsStatusFilter, setAppointmentsStatusFilter,
    addAppointment, updateAppointment, saveAppointmentSupplements, deleteAppointment,
    selectedAppointment, selectAppointment, addAppointmentNote, deleteAppointmentNote,
    calendarAppointments, calendarBlocked, calendarDate, setCalendarDate,
    addBlockedSlot, deleteBlockedSlot,
    clients, clientsPag, setClientsPage, clientsSearch, setClientsSearch,
    addClient, updateClient, deleteClient,
    selectedClient, selectedClientAppointments, selectClient, selectedClientSummary,
    clientsTag, setClientsTag, clientTags,
    staffMembers, addStaff, updateStaff, deleteStaff,
    services, reloadServices: fetchServices, addService, updateService, deleteService, saveServiceSupplements, copyServiceSupplements,
    products, productsPag, setProductsPage, productsSearch, setProductsSearch,
    addProduct, updateProduct, deleteProduct, refreshProduct, selectedProduct, selectProduct,
    clientLookup, staffLookup,
    loading, error, setError,
  };
}
