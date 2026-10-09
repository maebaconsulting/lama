/**
 * Données d'essai partagées (jamais en production) : une vente gardée, une
 * vente reprise par un avoir total, et un acompte sur un autre rendez-vous,
 * pour les essais des documents (WhatsApp, impression directe).
 */
import type { Caller } from "../test-support.ts";

/** Une vente de 25 000 F à une cliente qui a un numéro, son avoir total, et un acompte sur un autre rendez-vous. */
export async function documents(g: Caller) {
  await g("PUT", "/api/settings/caisse.acomptes", { value: true });
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbarga", phone: "699 12 34 56" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Soin du visage", name_en: "Facial", duration: 60, price: 25000 })).body.service.id as number;
  const sale = async (requestId: string) => (await g("POST", "/api/sales", {
    request_id: requestId, client_id: client, lines: [{ kind: "service", ref_id: service, quantity: 1 }], payments: [{ method: "cash", amount: 25000 }],
  })).body.invoice as { id: number; number: string; lines: { id: number }[] };
  const kept = await sale("vente-gardee-0001");
  const credited = await sale("vente-reprise-0001");
  const note = (await g("POST", "/api/credit-notes", {
    request_id: "avoir-total-0001", invoice_id: credited.id, reason: "Erreur de saisie", lines: [{ line_id: credited.lines[0].id, quantity: 1 }], refunds: [{ method: "cash", amount: 25000 }],
  })).body.credit_note as { id: number; number: string };
  const apt = (await g("POST", "/api/appointments", { client_id: client, scheduled_date: "2026-10-05", start_time: "10:00", service_ids: [service] })).body.appointment.id as number;
  const deposit = (await g("POST", "/api/deposits", { request_id: "acompte-wa-0001", appointment_id: apt, amount: 10000, payments: [{ method: "cash", amount: 10000 }] })).body.deposit as { id: number; number: string };
  return { client, kept, credited, note, deposit };
}
