import type { Appointment, BlockedSlot } from "../types";
import { translate, type Key, type Lang } from "../i18n/translate.ts";
import { pickText } from "./bilingual.ts";
import { formatShortDate } from "./format.ts";
import { statusLabel } from "./statuses.ts";

const HEADER_KEYS: Key[] = [
  "feuille.date", "feuille.debut", "feuille.fin", "feuille.type", "feuille.reference", "feuille.membre",
  "feuille.cliente", "feuille.telephone", "feuille.prestations", "feuille.statut", "feuille.details",
];

/** Excel en français attend le point-virgule, en anglais la virgule (spec § 4.2). */
export const SEPARATORS: Record<Lang, string> = { fr: ";", en: "," };

/** Keep exported cells inert when the CSV is opened in spreadsheet software. */
function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Feuille du jour dans la langue de l'écran : en-têtes, types, statuts et noms de prestations traduits. */
export function buildDaySheetCsv(
  date: string,
  appointments: Appointment[],
  blocked: BlockedSlot[],
  lang: Lang,
): string {
  const t = (key: Key) => translate(lang, key);
  const day = formatShortDate(date, lang);
  const unassigned = t("commun.non_attribue");
  const rows = [
    ...appointments.map((appointment) => ({
      start: appointment.start_time,
      staff: appointment.staff_name ?? unassigned,
      order: 0,
      values: [
        day,
        appointment.start_time,
        appointment.end_time,
        t("feuille.type.rdv"),
        appointment.identifier,
        appointment.staff_name ?? unassigned,
        appointment.client_name ?? "",
        appointment.client_phone ?? "",
        appointment.appointment_services?.map((service) => pickText(lang, service.service_name, service.service_name_en)).filter(Boolean).join("; ") ?? "",
        statusLabel(lang, appointment.status),
        appointment.notes,
      ],
    })),
    ...blocked.map((block) => ({
      start: block.start_time,
      staff: block.staff_name ?? "",
      order: 1,
      values: [day, block.start_time, block.end_time, t("feuille.type.bloque"), "", block.staff_name ?? "", "", "", "", "", block.reason],
    })),
  ].sort((a, b) => a.start.localeCompare(b.start)
    || a.staff.localeCompare(b.staff)
    || a.order - b.order);

  return [HEADER_KEYS.map(t), ...rows.map((row) => row.values)]
    .map((row) => row.map(csvCell).join(SEPARATORS[lang]))
    .join("\r\n") + "\r\n";
}

export function downloadDaySheet(
  date: string,
  appointments: Appointment[],
  blocked: BlockedSlot[],
  lang: Lang,
): void {
  const csv = buildDaySheetCsv(date, appointments, blocked, lang);
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = translate(lang, "feuille.fichier", { date });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
