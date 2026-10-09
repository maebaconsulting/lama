# lama

Appointments and management for beauty institutes, built for Africa. The application runs on a small server inside the institute and is used from any device on the institute's Wi-Fi, in French or in English. French version: [LISEZMOI.md](LISEZMOI.md).

lama ("beauty" in Bassa) is a fork of [OpenSalon](https://github.com/clawnify/OpenSalon), under the MIT licence.

## Demo

Try lama online at [https://lama-demo.mowoapp.com](https://lama-demo.mowoapp.com). The sign-in screen shows three demo accounts (manager, receptionist, practitioner) with their passwords. The data is fictitious and is reset every night at 3 a.m., Douala time; no message and no backup ever leaves the demo.

## What it does

- Day calendar by staff member, bookings with several services, rescheduling, blocked time and a day sheet (CSV, ready for Excel).
- Clients, staff, services and products. Services, products and staff roles can carry an English version; when it is empty, the French text is shown.
- Accounts with roles (administrator, manager, receptionist, practitioner), shared devices with a PIN, access log.
- Encrypted nightly backups to a USB drive and to Google Drive.
- Amounts in CFA francs, dates and times in Douala time (UTC+1).

## Languages

- Each account has its own language, French or English, changed at any time with the FR / EN button at the bottom of the side menu or in Settings, My account. The whole screen switches without reloading.
- Before sign-in, the screens use the language of the last account signed in on the device, French otherwise.
- Screen addresses are translated; both forms open the same screen, and the original OpenSalon addresses still work:

| Screen | French | English |
|---|---|---|
| Dashboard | `/` | `/` |
| Calendar | `/agenda` | `/calendar` |
| Appointments | `/rendez-vous`, `/rendez-vous/{id}` | `/appointments`, `/appointments/{id}` |
| Clients | `/clientes`, `/clientes/{id}` | `/clients`, `/clients/{id}` |
| Staff | `/equipe` | `/staff` |
| Services | `/prestations` | `/services` |
| Products | `/produits` | `/products` |
| Settings | `/reglages` | `/settings` |

- The API answers in the language sent in `Accept-Language`, in English when none is sent. API routes (`/api/…`) are the same in both languages.

## Develop

```bash
pnpm install
pnpm dev     # interface on http://localhost:5173, API on port 8787, demonstration data
pnpm test
```

## Install at the institute

See [deploy/README.md](deploy/README.md) (English) or [deploy/LISEZMOI.md](deploy/LISEZMOI.md) (French). Once the institute's certificate is approved on a device, lama installs on its home screen (iPhone, iPad, Android) and opens full screen, like an app.

## For AI agents

See [agent.md](agent.md), then `/api/openapi.json` for exact request and response shapes.

## Licence

MIT, see [LICENSE](LICENSE). The copyright lines of Clawnify (OpenSalon) and of lama are both kept.
