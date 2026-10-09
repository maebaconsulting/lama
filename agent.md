# lama operating guide

## Division of labour

Translate the user's request into beauty institute operations, but let lama own IDs, prices, durations, availability, and history. Never invent a client, service, staff ID, or booking total. Never bypass a scheduling conflict unless the user explicitly accepts that overlap. Prefer cancellation over deletion so the institute keeps its history; hard-delete only when the user clearly asks for permanent removal.

## Language, amounts and times

- Send `Accept-Language: fr` to get error, refusal and conflict messages in French; without it (or with any other language) they come in English. The `409` message always keeps the `allow_conflict: true` token, in both languages.
- Services carry optional English fields `name_en`, `description_en` and `category_en`; products carry `name_en` and `category_en`; staff carry `title_en`. An empty English field means "show the French one". Send them only when the user gives an English version; never translate the French fields yourself.
- `GET /api/products?search=` matches the French and the English product names, ignoring accents and case (`creme` finds `Crème`); `GET /api/clients?search=` ignores them too (`aicha` finds `Aïcha`). Appointment detail and calendar services carry `service_name_en`; a client's history carries `service_names_en`, already falling back to French per service.
- Amounts are whole CFA francs (FCFA, no decimals). Dates are `YYYY-MM-DD` and times `HH:MM` on a 24-hour clock, in Douala time (UTC+1).
- A signed-in person changes their own interface language with `PUT /api/auth/me/language` and `{"language": "fr"}` or `{"language": "en"}`, and their own display theme with `PUT /api/auth/me/theme` and `{"theme": "light"}`, `{"theme": "dark"}` or `{"theme": "system"}` (follows the device).

## Booking and managing an appointment

1. Find the client with `GET /api/clients?search=...`. Create them first only when there is no match and the user supplied enough identity information.
2. Read services from `GET /api/services` and active staff from `GET /api/staff/all`. Use the app's IDs and prices; do not calculate a replacement price or duration yourself.
3. Check the target day with `GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD` before proposing a staff member or time.
4. Create the booking with `POST /api/appointments`, normally sending `client_id`, `staff_id`, `scheduled_date`, `start_time`, and `service_ids`.
5. If the app returns `409`, explain the named conflict and offer another time or staff member. Send `allow_conflict: true` only after the user deliberately chooses an overlap.
6. Read the returned appointment, or fetch `GET /api/appointments/{id}`, and confirm the date, start and end time, staff, services, and total back to the user.
7. For a reschedule or status change, use `PUT /api/appointments/{id}`. The app preserves duration when only `start_time` changes and rechecks availability when a booking moves or is restored.
8. Add timestamped operational history with `POST /api/appointments/{id}/notes`; use the appointment's `notes` field for editable booking instructions.

For staff time off or breaks, use `POST /api/blocked-slots` after checking the calendar. If it returns `409`, name every appointment or block in the way and ask whether to choose another interval or create the closure anyway. Send `allow_conflict: true` only after the user deliberately accepts that overlap. For stock work, read `/api/products` first, then create or update only the product the user named.

## Pages

Each screen answers to a French and an English address; both open the same screen, and the app shows the one of the signed-in person's language.

- `/` : dashboard; best screenshot-friendly overview of KPIs and today's schedule.
- `/agenda` or `/calendar` : day schedule by staff; use this to show availability and blocked time.
- `/rendez-vous` or `/appointments`, with `/{id}` : booking list and full booking history.
- `/clientes` or `/clients` : client records; `?cliente={id}` (or `?client={id}`) opens a record in the side panel, and the old `/clientes/{id}` form redirects there.
- `/equipe` or `/staff`, `/prestations` or `/services`, `/produits` or `/products` : operating setup and inventory.
- `/reglages` or `/settings` : accounts, shared devices, backups and connections, according to the role.
- Add `?agent` when driving the browser for persistent labels and larger action targets.

## API anchors

- `GET /api/calendar` : inspect a date range before booking or moving time.
- `POST /api/appointments` : create a booking from real client, service and staff IDs.
- `PUT /api/appointments/{id}` : reschedule, assign, update instructions, or change status.
- `POST /api/appointments/{id}/notes` : append an immutable activity note.
- `GET /api/clients?search=...` : resolve a client without loading the whole database; each client carries `last_visit` (date of the last completed appointment, or `null`) and `visit_count` (completed appointments).
- `GET /api/products/{id}` : one product with its current stock.
- `POST /api/blocked-slots` : reserve staff time that must reject ordinary bookings.

Read `/llms.txt` for the current route list and `/api/openapi.json` for exact request and response shapes instead of relying on this guide as an API reference.

## Failures and safety

- `409` means the staff member is already booked or blocked. Preserve the conflict by default; never silently retry with `allow_conflict`.
- `400` means the supplied time or duration is invalid. Appointment and blocked-slot times must use `HH:MM`, run from 07:00 to 21:00 in 5-minute steps (the end included), and end after they start. An existing appointment keeps its old hours when only its date, staff member or status changes.
- `404` means the record no longer exists. Search again instead of reusing a stale ID.
- Treat client contact details and notes as private. Return only what the user needs for the current task.
- Destructive API calls do not ask for confirmation and are irreversible; confirm the intended record and prefer deactivation or cancellation where the API supports it.
- `DELETE /api/clients/{id}`, `/api/services/{id}` and `/api/staff/{id}` answer `409` when the record has appointments (or, for staff, a linked account): the history is kept. Deactivate the service or staff record instead (`PUT` with `active: 0`); a client with appointments stays.
