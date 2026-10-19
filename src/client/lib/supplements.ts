/**
 * Suppléments à l'écran (spec du 18/10/2026 § 3) : suppléments proposés sous une prestation,
 * prestations vendues seules, texte de la carte de l'agenda, brouillon des suppléments d'un
 * rendez-vous et corps envoyés au serveur, choix de « Recopier vers… » et de la liste d'une
 * prestation. Module pur, testé sous Node ; chaque fonction rend une nouvelle valeur.
 */
import type { Lang } from "../i18n/translate.ts";
import type { Appointment, AppointmentService, Product, Service, SupplementRef } from "../types.ts";
import { pickText } from "./bilingual.ts";
import { QUANTITE_MAX, type SupplementKind } from "../../shared/supplements.ts";

/** Supplément proposé sous une prestation : article du catalogue, prix et minutes de sa fiche. */
export interface SupplementChoice {
  kind: "service" | "product";
  ref_id: number;
  label: string;
  price: number;
  minutes: number;
}

/** Suppléments proposés sous une prestation : sa liste, dans l'ordre réglé, sans article désactivé ni retiré du catalogue. */
export function choicesFor(serviceId: number, catalog: { services: Service[]; products: Product[] }, lang: Lang): SupplementChoice[] {
  const service = catalog.services.find((s) => s.id === serviceId);
  return (service?.supplements ?? []).flatMap((ref): SupplementChoice[] => {
    if (ref.kind === "service") {
      const s = catalog.services.find((x) => x.id === ref.ref_id && x.active);
      return s ? [{ kind: "service", ref_id: s.id, label: pickText(lang, s.name, s.name_en), price: s.price, minutes: s.duration }] : [];
    }
    const p = catalog.products.find((x) => x.id === ref.ref_id);
    return p ? [{ kind: "product", ref_id: p.id, label: pickText(lang, p.name, p.name_en), price: p.price, minutes: 0 }] : [];
  });
}

/** Prestations proposées seules (tuiles de la caisse, prise de rendez-vous) : actives, jamais « supplément seulement ». */
export function sellableAlone(services: Service[]): Service[] {
  return services.filter((s) => s.active && !s.supplement_seulement);
}

/** Libellé d'un supplément de rendez-vous dans la langue de l'écran. */
export function supplementLabel(s: { label_fr: string; label_en: string }, lang: Lang): string {
  return pickText(lang, s.label_fr, s.label_en);
}

/** Texte de la carte de l'agenda : chaque prestation suivie de ses suppléments (« Tresses + Mèches, Soin ») ; la carte l'abrège si la place manque. */
export function cardText(apt: Appointment, lang: Lang): string {
  return (apt.appointment_services ?? [])
    .map((svc) => [pickText(lang, svc.service_name, svc.service_name_en), ...(svc.supplements ?? []).map((s) => supplementLabel(s, lang))].filter(Boolean).join(" + "))
    .filter(Boolean)
    .join(", ");
}

/** Supplément en cours de saisie sous une prestation d'un rendez-vous ; `label` est celui qu'on affiche (le libellé saisi pour un libre). */
export interface DraftSupplement {
  kind: SupplementKind;
  ref_id: number | null;
  quantity: number;
  label: string;
  price: number;
  minutes: number;
}

/** Brouillon tiré des suppléments enregistrés d'une prestation du rendez-vous. */
export function draftOf(svc: AppointmentService, lang: Lang): DraftSupplement[] {
  return (svc.supplements ?? []).map((s) => ({
    kind: s.kind, ref_id: s.ref_id, quantity: s.quantity, label: s.kind === "libre" ? s.label_fr : supplementLabel(s, lang), price: s.price ?? 0, minutes: s.minutes,
  }));
}

export function isChosen(list: DraftSupplement[], choice: SupplementChoice): boolean {
  return list.some((d) => d.kind === choice.kind && d.ref_id === choice.ref_id);
}

/** Cocher ou décocher un supplément proposé ; coché, il arrive avec une quantité de 1. */
export function toggleChoice(list: DraftSupplement[], choice: SupplementChoice): DraftSupplement[] {
  if (isChosen(list, choice)) return list.filter((d) => !(d.kind === choice.kind && d.ref_id === choice.ref_id));
  return [...list, { kind: choice.kind, ref_id: choice.ref_id, quantity: 1, label: choice.label, price: choice.price, minutes: choice.minutes }];
}

/** Quantité d'un produit en supplément, de 1 à 99 ; une prestation en supplément garde 1. */
export function setDraftQuantity(list: DraftSupplement[], index: number, quantity: number): DraftSupplement[] {
  return list.map((d, i) => (i === index && d.kind === "product" ? { ...d, quantity: Math.min(Math.max(Math.round(quantity), 1), QUANTITE_MAX) } : d));
}

/**
 * Quantité lue dans le champ d'un produit en supplément. Pendant la frappe (`done` faux), seul un
 * entier de 1 à 99 est pris, sinon `null` (champ vidé pour retaper) ; en quittant le champ, un
 * nombre est borné de 1 à 99 et une saisie illisible rend la quantité d'avant.
 */
export function quantityFromText(text: string, current: number, done: boolean): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return done ? current : null;
  const n = Number(t);
  if (done) return Math.min(Math.max(n, 1), QUANTITE_MAX);
  return n >= 1 && n <= QUANTITE_MAX ? n : null;
}

/** « + Supplément libre » : libellé (espaces de bord retirées), prix et minutes saisis, déjà contrôlés par `libreProblem`. */
export function addLibre(list: DraftSupplement[], libre: { label: string; price: number; minutes: number }): DraftSupplement[] {
  return [...list, { kind: "libre", ref_id: null, quantity: 1, label: libre.label.trim(), price: libre.price, minutes: libre.minutes }];
}

export function removeDraft(list: DraftSupplement[], index: number): DraftSupplement[] {
  return list.filter((_, i) => i !== index);
}

/** Minutes ajoutées et montant (prix × quantité) d'un brouillon. */
export function draftTotals(list: DraftSupplement[]): { minutes: number; price: number } {
  return list.reduce((t, d) => ({ minutes: t.minutes + d.minutes, price: t.price + d.price * d.quantity }), { minutes: 0, price: 0 });
}

/** Supplément tel que l'attend le serveur : jamais de prix pour un article du catalogue, il le relit. */
export function supplementPayload(d: DraftSupplement): Record<string, unknown> {
  if (d.kind === "libre") return { kind: "libre", label: d.label.trim(), price: d.price, minutes: d.minutes };
  if (d.kind === "product") return { kind: "product", ref_id: d.ref_id, quantity: d.quantity };
  return { kind: "service", ref_id: d.ref_id };
}

/** Prestations qui sont déjà le supplément d'une autre. */
const dejaSupplements = (services: Service[]) =>
  new Set(services.flatMap((s) => (s.supplements ?? []).filter((r) => r.kind === "service").map((r) => r.ref_id)));

/**
 * « Recopier vers… » : prestations actives, sauf la source, celles déjà supplément d'une
 * autre et les « supplément seulement » (elles n'ont pas de liste) ; cochées d'avance celles du même univers (spec § 3.1).
 */
export function copyTargets(services: Service[], from: Service): { candidates: Service[]; preselected: number[] } {
  const supplements = dejaSupplements(services);
  const candidates = services.filter((s) => s.active && s.id !== from.id && !supplements.has(s.id) && !s.supplement_seulement);
  return { candidates, preselected: candidates.filter((s) => s.category === from.category).map((s) => s.id) };
}

/**
 * Articles qu'on peut ajouter à la liste d'une prestation : prestations actives, sauf
 * elle-même, celles qui ont leur propre liste et celles déjà choisies ; produits pas encore choisis.
 */
export function pickable(services: Service[], products: Product[], serviceId: number, current: SupplementRef[]): { services: Service[]; products: Product[] } {
  const has = (kind: SupplementRef["kind"], id: number) => current.some((r) => r.kind === kind && r.ref_id === id);
  return {
    services: services.filter((s) => s.active && s.id !== serviceId && !(s.supplements ?? []).length && !has("service", s.id)),
    products: products.filter((p) => !has("product", p.id)),
  };
}

/** Échange l'article d'indice `index` avec son voisin (`by` : -1 monte, 1 descend) ; hors des bornes, la liste est rendue telle quelle. */
export function moveSupplement(items: SupplementRef[], index: number, by: -1 | 1): SupplementRef[] {
  const target = index + by;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Retire l'article d'indice `index` ; `focus` est l'indice (dans la liste rendue) de la ligne qui reçoit le focus : la suivante, sinon la précédente, sinon aucune. */
export function removeSupplement(items: SupplementRef[], index: number): { items: SupplementRef[]; focus: number | null } {
  const next = items.filter((_, i) => i !== index);
  return { items: next, focus: next.length === 0 ? null : Math.min(index, next.length - 1) };
}
