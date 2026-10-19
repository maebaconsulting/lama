/**
 * Données d'essai partagées (jamais en production) : un petit salon avec des suppléments
 * (spec du 18/10/2026 § 3), pour les essais du rendez-vous, de la vente, de l'avoir et des comptes.
 */
import type { Caller } from "../test-support.ts";

/** Jour des rendez-vous d'essai, après l'horloge de départ des essais (28/09/2026). */
export const JOUR = "2026-10-05";

/** Supplément libre d'essai, tel que l'écran l'envoie. */
export const LIBRE = { kind: "libre", label: "Perles dorées", price: 3000, minutes: 15 };

/** Tresses (60 min, 15 000) accepte Mèches (30 min, 5 000, supplément seulement) et Perles (produit, 500) ; Soin du visage a sa propre liste. */
export async function salon(g: Caller) {
  const staff = (await g("POST", "/api/staff", { name: "Awa" })).body.staff.id as number;
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida", phone: "699 12 34 56" })).body.client.id as number;
  const autre = (await g("POST", "/api/clients", { name: "Brenda Essomba" })).body.client.id as number;
  const svc = async (name: string, extra: Record<string, unknown> = {}) =>
    (await g("POST", "/api/services", { name, duration: 60, price: 15000, ...extra })).body.service.id as number;
  const tresses = await svc("Tresses");
  const meches = await svc("Mèches", { duration: 30, price: 5000, supplement_seulement: 1 });
  const soin = await svc("Soin du visage", { duration: 45, price: 20000 });
  const masque = await svc("Masque", { duration: 15, price: 4000, supplement_seulement: 1 });
  const perles = (await g("POST", "/api/products", { name: "Perles", price: 500, stock: 50 })).body.product.id as number;
  await g("PUT", `/api/services/${tresses}/supplements`, { items: [{ kind: "service", ref_id: meches }, { kind: "product", ref_id: perles }] });
  await g("PUT", `/api/services/${soin}/supplements`, { items: [{ kind: "service", ref_id: masque }] });
  return { staff, client, autre, tresses, meches, soin, masque, perles };
}


type Salon = Awaited<ReturnType<typeof salon>>;

/** Rendez-vous de Tresses avec Mèches, 2 Perles et le supplément libre (24 000 en tout), et les lignes du ticket qu'envoie la caisse. */
export async function rdvAvecSupplements(g: Caller, s: Salon, staffId = s.staff, start = "10:00") {
  const apt = (await g("POST", "/api/appointments", {
    client_id: s.client, staff_id: staffId, scheduled_date: JOUR, start_time: start, service_ids: [s.tresses],
    supplements: [{ service_index: 0, kind: "service", ref_id: s.meches }, { service_index: 0, kind: "product", ref_id: s.perles, quantity: 2 }, { service_index: 0, ...LIBRE }],
  })).body.appointment.id as number;
  const lines = [
    { kind: "service", ref_id: s.tresses, quantity: 1, staff_id: staffId },
    { kind: "service", ref_id: s.meches, quantity: 1, staff_id: null, parent: 0 },
    { kind: "product", ref_id: s.perles, quantity: 2, staff_id: null, parent: 0 },
    { kind: "libre", label: "Perles dorées", unit_price: 3000, quantity: 1, parent: 0 },
  ];
  return { apt, lines };
}
