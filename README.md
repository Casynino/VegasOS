# Vegas Luxury Hotel — Hotel Management Platform

One Next.js app containing the **public website + online booking requests** and the **staff hotel management system**,
sharing a single PostgreSQL database and a single set of server-side business services.

## Stack
Next.js 16 (App Router) · TypeScript · PostgreSQL · Prisma 7 (`@prisma/adapter-pg`) · Tailwind 4 · shadcn/ui (Base UI) · Zod · argon2id sessions · Vitest.
Target hosting: Vercel + managed Postgres (Neon/Supabase), Vercel Cron for the 04:00 daily report.

## Local setup
```bash
cp .env.example .env            # set DATABASE_URL, SESSION_SECRET, CRON_SECRET
npm install
npx prisma migrate dev          # creates schema + integrity constraints
SEED_OWNER_EMAIL=you@example.com SEED_OWNER_PASSWORD='Temp-password-123' npm run db:seed
npm run dev                     # http://localhost:3000  ·  staff: /staff
```
`SEED_DEV_STAFF=1` additionally creates dev-only manager/receptionist accounts (`*@vegas.test`). Never use in production.

## Core rules (single source of truth)
| Rule | Where |
|---|---|
| Hotel business day 04:00 → 04:00 (Africa/Dar_es_Salaam) | `src/lib/time/business-date.ts` (HotelBusinessDateService) |
| Nights, check-in/out windows, day-use, late arrival (≥16:00), 11:00 checkout | `src/lib/time/stay.ts` (StayCalculationService) |
| Settings (rates discount, times, thresholds…) | `hotel_settings` row via `src/server/settings.ts` |
| Permissions (enforced server-side) | `src/lib/permissions.ts` + `src/server/auth.ts` |
| Audit trail | `src/server/audit.ts` → `audit_logs` |
| No double booking | Postgres exclusion constraint `reservation_rooms_no_overlap` (see init migration) |

Money is stored as whole TZS integers. Financial records are never hard-deleted (void/reverse/cancel instead).

## Scripts
`npm run dev` · `npm test` · `npm run typecheck` · `npm run lint` · `npm run db:migrate` · `npm run db:seed`

## Staff login & roles
One login at `/staff/login`; `/staff` sends each user to their dashboard by permission (`src/lib/staff-home.ts`):
`dashboard.admin` → `/admin/dashboard`, `dashboard.manager` → `/manager/dashboard`, `dashboard.front_desk` → `/reception/dashboard`,
drivers → `/staff/driver`. All four areas share one shell (`src/components/staff/staff-shell.tsx`); every page and action checks permissions server-side.

## Website bookings are *requests*
The public form (dates → room → details & arrival → review) creates a `BookingRequest` (`VLH-REQ-XXXXX`), never a reservation, and never
holds a room. Price and availability are computed server-side on submit (rate-limited, honeypot). The customer sees "Request received".
Staff confirm from the request page; `createReservation` re-checks availability/price and atomically links the request (`CONVERTED`),
so two staff can't convert the same request. `holdExpiresAt` is reserved for a future temporary-hold feature. No customer accounts.

## Modules (staff system `/staff`)
| Area | Route | Notes |
|---|---|---|
| Admin dashboard | `/admin/dashboard` | Command centre + booking-request funnel (totals, conversion, by source, staff handling) |
| Manager dashboard | `/manager/dashboard` | Command centre + today's booking requests |
| Reception dashboard | `/reception/dashboard` | The operational centre: today's counts, quick actions, arrival cards with one-click **Assign room & check in** (ready rooms only; dirty/cleaning needs `reservations.checkin_override` + reason), departures with Check out, current guests, room issues |
| Find guest | `/staff/search` (search box in every staff header) | Name words in any order, phone in any format, reference, room number; shows previous-guest history |
| Booking requests | `/staff/booking-requests` | Website/WhatsApp requests: status tabs, contact log, assign, reject/cancel with reason, fix customer match, **Confirm & create reservation** |
| Reservations / walk-in / day-use | `/staff/reservations` | One reservation engine shared with the website |
| Rooms & housekeeping | `/staff/rooms` | Dirty → Cleaning → Ready; maintenance blocks; types & rates |
| Shifts & handover | `/staff/shifts` | Scheduled vs actual, rotation generator, swaps, take-over, notes |
| Payments / Expenses | `/staff/payments`, `/staff/expenses` | Append-only; approval above threshold; receipts |
| Invoices / Corporate | `/staff/invoices`, `/staff/corporate` | Booking invoices mirror the folio |
| Restaurant & bar / Meeting room | `/staff/sales`, `/staff/meeting-room` | Separate revenue streams |
| Reports / Daily boss report | `/staff/reports`, `/staff/reports/daily` | CSV export; WhatsApp delivery log & retry |

## Deploying to Vercel + managed Postgres
1. **Database**: create a Neon (or Supabase) Postgres database in a region near Dar es Salaam (e.g. `eu-central`/`me-central`).
   Use the **pooled** connection string for `DATABASE_URL`. The `btree_gist` extension is created by the first migration.
2. **Vercel project** → Environment variables:
   - `DATABASE_URL` – pooled Postgres URL
   - `SESSION_SECRET` – random 32+ chars (`openssl rand -base64 32`)
   - `CRON_SECRET` – random string; Vercel Cron sends it as `Authorization: Bearer …`
   - `CALLMEBOT_API_KEY` – WhatsApp key for the Boss's number (see below); optional per-recipient keys e.g. `CALLMEBOT_KEY_BOSS`
   - `NEXT_PUBLIC_SITE_URL` – `https://www.vegasluxuryhotel.co.tz`
3. **Build**: `npm run build` runs `prisma generate`, `prisma migrate deploy` and `next build`.
4. **First owner account** (once, from your machine against the production DB):
   `DATABASE_URL=… SEED_OWNER_EMAIL=… SEED_OWNER_PASSWORD='…' npm run db:seed` — loads configuration (rooms, types, roles, lists) only.
   Never set `SEED_DEV_STAFF` in production.
5. **Cron** (`vercel.json`): `/api/cron/daily-report` at 01:05 UTC (04:05 Dar es Salaam, just after the business day closes) and a
   retry at 04:35 UTC. It generates the previous hotel day's report, sends it, retries failed deliveries, marks overdue invoices,
   and cleans expired sessions. Safe to call repeatedly.
6. **Domain**: point `vegasluxuryhotel.co.tz` to Vercel; HTTPS + HSTS are enabled automatically in production.

### Daily WhatsApp report (CallMeBot)
1. From the Boss's phone, send **"I allow callmebot to send me messages"** to CallMeBot's WhatsApp number (see callmebot.com → WhatsApp API).
2. Put the API key you receive in `CALLMEBOT_API_KEY` (or a named variable such as `CALLMEBOT_KEY_BOSS`).
3. In **Staff → Hotel settings → Report recipients** add `Boss, +2557XXXXXXXX` (or `Boss, +2557…, CALLMEBOT_KEY_BOSS`).
4. Use **Daily boss reports → Send / retry** to test. Failed sends stay visible with the error and can be retried; the report is always stored.
CallMeBot is WhatsApp-based; a real SMS gateway can be added as another provider in `src/server/services/messaging.ts`.

### Backups & recovery
- Enable the provider's point-in-time recovery (Neon: history retention ≥ 7 days; Supabase: PITR add-on) and take a daily logical backup
  (`pg_dump --format=custom`) to separate storage. Test a restore into a scratch database quarterly.
- Financial records are append-only (void/reverse/cancel), and every important action is in `audit_logs`, so history can be reconstructed.

## Front-desk practice data (local only)
`npm run test-data:load` adds a realistic day at the desk (arrivals incl. a dirty room and a missing ID, a paid and an
unpaid departure, an in-house guest to extend, a future booking, a website and a WhatsApp request) through the real
engine. Everything is marked "(test)" / phone `+255 700 900…` / `[TEST SCENARIO]`. `npm run test-data:clear` removes
only that data. Both refuse to run against a non-local database.

## Testing
`npm test` runs unit tests and integration tests against a separate `vegas_hotel_test` database
(`TEST_DATABASE_URL`, default `postgresql://<you>@localhost:5432/vegas_hotel_test`) covering the business-day rules, pricing/discounts,
double-booking races, check-in/out, payments, shifts, expenses, invoices, meeting-room overlaps, reporting and the daily report.

## Guest operations, transport & website CMS
| Area | Route | Notes |
|---|---|---|
| Check-in desk & wizard | `/staff/check-in` → `/staff/reservations/[id]/check-in` | Find booking → confirm details (only missing fields highlighted) → stay summary → welcome checklist → one-click check-in |
| Check-out | `/staff/reservations/[id]/check-out` | Full folio; payment or authorised override required; early departure reason + configurable policy |
| Stay workspace | `/staff/reservations/[id]` | Extend stay (availability + alternatives), late checkout, room change with history/upgrade charge, folio charges, transport, requests |
| Welcome card | `/staff/reservations/[id]/welcome` | Printable; content from settings & active services |
| Guest requests | `/staff/requests` | New → assigned → in progress → done; maintenance requests also create a handover note |
| Transport | `/staff/transport`, `/staff/driver` | Website airport pickups arrive as requests; drivers (Driver role) see only their own trips, no finances |
| Website CMS | `/staff/website` | Edit text & photos per section, media library (room galleries, categories, featured, illustrative flag), services |

Services, texts and images shown on the public website come from the database; `src/components/public/content.ts` holds the verified defaults.
