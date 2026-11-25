# Kinboard — Technical Specification

| Item | Value |
|---|---|
| Version | 0.1 (draft) |
| Date | 2026-11-25 |
| Implements | `01-functional-requirements.md` |
| Principle | **100 % OSI-approved open source** for the product's software. Proprietary platform services only where they cannot be avoided (APNs/FCM push, app stores, Google/Microsoft calendar APIs), and each sits behind an adapter. |

---

## 1. Architecture overview

```
┌──────────────────────────┐      ┌──────────────────────────┐
│  HOME DISPLAY (Kiosk)    │      │  MOBILE APP (iOS/Android)│
│  Raspberry Pi 5 / ARM SBC│      │  Capacitor shell         │
│  Linux + Cage + Chromium │      │  ┌────────────────────┐  │
│  ┌────────────────────┐  │      │  │ Kinboard Web UI    │  │
│  │ Kinboard Web UI    │◄─┼──┐┌──┼─►│ (mobile layout)    │  │
│  │ (display layout)   │  │  ││  │  └────────────────────┘  │
│  └────────────────────┘  │  ││  │  Native: push, camera,   │
│  Service Worker + IDB    │  ││  │  QR scan, widgets        │
│  kinboard-agent (OTA,    │  ││  └──────────────────────────┘
│  screen schedule)        │  ││
└──────────────────────────┘  ││  HTTPS (REST) + WSS (realtime)
                              ▼▼
                ┌─────────────────────────────┐
                │ Caddy (TLS, reverse proxy)  │
                └──────────────┬──────────────┘
                ┌──────────────▼──────────────┐      ┌───────────────────────┐
                │ kinboard-api (Node/Fastify) │◄────►│ kinboard-worker       │
                │ REST · WebSocket · Auth     │      │ calendar sync, push,  │
                └──────────────┬──────────────┘      │ reminders, images     │
                               │                     └──────────┬────────────┘
                     ┌─────────▼─────────┐                      │
                     │ PostgreSQL 17     │◄─────────────────────┘
                     │ data + pg-boss    │      ┌───────────────────────────┐
                     │ queue + NOTIFY    │      │ Optional: Ollama / llama. │
                     └───────────────────┘      │ cpp ("Ask Kinboard")      │
                     Object storage: local FS   └───────────────────────────┘
                     or any S3-compatible store
```

**Key decision:** one **TypeScript + React** UI codebase serves both the display (kiosk browser) and the mobile app (Capacitor),
with **two responsive layout shells** (`/display`, `/app`). Domain logic, schemas and the API client live in shared packages.

## 2. Technology stack

### 2.1 Selection criteria
1. OSI-approved licence (MIT, Apache-2.0, BSD, MPL, LGPL/GPL for OS-level parts, PostgreSQL licence).
2. Mature: widely used, multi-year track record, active maintainers, no single-vendor rug-pull risk.
3. Runs on low-power ARM hardware.
4. A small team can maintain it: one language (TypeScript) end to end.

### 2.2 Stack table

| Layer | Choice | Licence | Why |
|---|---|---|---|
| Language | **TypeScript 5** | Apache-2.0 | One language across UI, server and shared domain |
| UI framework | **React 19** | MIT | Largest ecosystem, runs in kiosk Chromium and Capacitor |
| Build | **Vite 6** | MIT | Fast builds, PWA plugin |
| Styling | **Tailwind CSS 4** + CSS variables (design tokens) | MIT | Consistent tokens for display and mobile, theming |
| Accessible primitives | **Radix UI Primitives** | MIT | Dialogs, popovers, a11y |
| Routing | **TanStack Router** (or React Router 7) | MIT | Type-safe routes |
| Server state | **TanStack Query 5** + IndexedDB persister | MIT | Caching, offline, optimistic updates |
| Client state | **Zustand** | MIT | Small, simple |
| Validation | **Zod** | MIT | Shared schemas between client and server |
| Dates and recurrence | **date-fns 4** + **@date-fns/tz**, **rrule** | MIT / BSD-3 | RFC 5545 recurrence |
| iCalendar | **ical.js** | MPL-2.0 | Parse and generate ICS/VEVENT |
| CalDAV | **tsdav** | MIT | iCloud, Nextcloud, generic CalDAV |
| Google / MS sync | **googleapis**, **@microsoft/microsoft-graph-client** | Apache-2.0 / MIT | Official SDKs (the APIs themselves are proprietary, so they sit behind an adapter) |
| i18n | **i18next** + react-i18next (ICU) | MIT | de/en |
| Offline / PWA | **Workbox** (vite-plugin-pwa) | MIT | Service worker, asset caching |
| Mobile shell | **Capacitor 7** | MIT | Wraps the same web UI. Native plugins for push, camera, haptics, share |
| QR scan | **zxing-wasm** (in WebView) | MIT/Apache | No proprietary ML Kit dependency |
| API server | **Node.js 22 LTS** + **Fastify 5** | MIT | Fast, schema-first, mature plugins |
| WebSocket | **@fastify/websocket** (ws) | MIT | Realtime fan-out |
| ORM / migrations | **Drizzle ORM** + drizzle-kit | Apache-2.0 | SQL-first, typed, light |
| Database | **PostgreSQL 17** | PostgreSQL | Proven. LISTEN/NOTIFY gives fan-out without Redis |
| Job queue | **pg-boss** | MIT | Postgres-backed jobs, so no extra infrastructure |
| Auth | **better-auth** (e-mail/password, magic link, passkeys, OAuth) + **argon2** | MIT | Self-hosted, no SaaS |
| Tokens | **jose** (JWT/JWE) | MIT | Device tokens, encryption |
| Images | **sharp** (libvips) | Apache-2.0 | Thumbnails and photo-frame renditions |
| Object storage | Local filesystem driver, plus an **S3 API** driver (works with Garage, SeaweedFS, any S3) | — | Self-host friendly |
| Push | **APNs / FCM** via `@parse/node-apn` + HTTP v1, plus **UnifiedPush / ntfy** | MIT / Apache-2.0 | ntfy for de-Googled Android and self-hosters |
| Reverse proxy | **Caddy 2** | Apache-2.0 | Automatic TLS |
| Containers | **Docker / Podman** + Compose | Apache-2.0 | One-command self-hosting |
| Display OS | **Raspberry Pi OS Lite (Debian 12)**, later **Yocto** image | GPL/various | Stable base for the kiosk |
| Kiosk compositor | **Cage** (Wayland kiosk) + **Chromium** | MIT / BSD | A single full-screen app that is hard to escape |
| OTA updates | **RAUC** (A/B partitions) + hawkBit (optional) | LGPL-2.1 / EPL-2.0 | Atomic updates with rollback |
| Display agent | `kinboard-agent` (Node, systemd) | own | Screen schedule (wlr-randr / DPMS), health, OTA trigger |
| Weather | **Open-Meteo** API (or self-hosted) | AGPL server / CC-BY data | No API key needed |
| Local AI (opt.) | **Ollama** / **llama.cpp**, **whisper.cpp** | MIT | Local NLU, speech-to-text |
| Testing | **Vitest**, **Testing Library**, **Playwright** | MIT / Apache-2.0 | Unit, component, E2E (including the kiosk viewport) |
| Lint / format | **Biome** | MIT/Apache | One fast tool |
| Monorepo | **pnpm workspaces** + **Turborepo** | MIT | Cached builds |
| Observability | **OpenTelemetry**, **Prometheus**, **GlitchTip** (Sentry-compatible) | Apache-2.0 / MIT | Self-hostable |
| CI | **Forgejo Actions** or GitHub Actions | MIT / — | |

### 2.3 Alternatives considered (ADR summary)

| Decision | Chosen | Alternative | Reason for choice |
|---|---|---|---|
| Cross-platform UI | React web + Capacitor | **Flutter** (+ flutter-pi on the display) | Flutter is strong, but the web stack gives one codebase for display, mobile **and** a browser fallback, plus a larger hiring pool and easier theming. Revisit if Pi rendering performance proves insufficient. |
| Cross-platform UI | React web + Capacitor | React Native + Expo | RN cannot run on the display kiosk without a separate web build. Capacitor reuses 100 % of the UI. |
| Backend | Custom Fastify | PocketBase / Supabase | PocketBase is pre-1.0. Supabase is heavy to self-host. Sync logic for calendars needs custom workers anyway. |
| Realtime fan-out | Postgres LISTEN/NOTIFY | Redis / Valkey | One less service. Valkey (BSD) can be added if we need more than about 10k concurrent sockets. |
| Display runtime | Chromium in Cage | WPE WebKit (cog) | Chromium has better DevTools and wider CSS support. WPE is a fallback for very weak SoCs. |

## 3. Reference hardware (display)

| Component | Spec |
|---|---|
| SBC | Raspberry Pi 5, 4 GB (alternative: RK3566/RK3588 boards) |
| Panel | 15.6" IPS 1920×1080, capacitive 10-point touch (USB HID), HDMI |
| Storage | 32 GB industrial microSD or NVMe (A/B rootfs + data partition) |
| Audio | Small speaker via a USB DAC or I²S amp (reminder sounds) |
| Power | USB-C PD 5V/5A, typical 6–9 W |
| Sensors (opt.) | Ambient light sensor for auto-brightness, PIR for wake-on-presence |

## 4. Domain model

```
Household 1─* Member 1─* ExternalCalendar 1─* ExternalEvent (server cache)
Household 1─* Display
Household 1─* Event *─* Member   (EventAssignee)
Household 1─* Task  *─* Member   (TaskAssignee) ; Task *─1 Routine (opt.)
Household 1─* Routine
Household 1─* Reward ; Member 1─* PointsLedgerEntry ; RewardRedemption
Household 1─* List 1─* ListItem ; List *─* Member (ListVisibility, for hidden lists)
Household 1─* Recipe ; MealPlanEntry *─1 Recipe
Household 1─* Album 1─* Photo
User (login) 1─1 Member (opt.)
```

### 4.1 Core tables (PostgreSQL, abridged)

| Table | Key columns |
|---|---|
| `household` | id (uuid v7), name, tz, locale, week_start, pin_hash, created_at |
| `member` | id, household_id, user_id?, name, role (`adult`/`child`), color, avatar_url, emoji, sort, points_balance (derived cache) |
| `display` | id, household_id, name, device_pubkey, last_seen_at, settings jsonb, revoked_at |
| `event` | id, household_id, title, starts_at, ends_at, all_day, tz, rrule?, exdates[], location, notes, source (`local`/`external`), external_ref?, rev |
| `event_assignee` | event_id, member_id |
| `external_calendar` | id, member_id, provider (`ics`/`caldav`/`google`/`msgraph`), display_name, color_override, credentials_enc (AES-GCM), sync_token, etag, last_sync_at, status |
| `task` | id, household_id, routine_id?, title, icon, points, due_at?, rrule?, requires_approval, rev |
| `task_assignee` | task_id, member_id |
| `task_completion` | id, task_id, member_id, occurrence_date, completed_at, approved_by?, status |
| `routine` | id, household_id, name, icon, window_start, window_end, days_mask |
| `reward` | id, household_id, title, icon, cost |
| `points_ledger` | id, member_id, delta, reason (`task`/`redeem`/`adjust`), ref_id, actor_member_id, created_at |
| `reward_redemption` | id, reward_id, member_id, status (`requested`/`approved`/`rejected`), decided_by |
| `list` | id, household_id, name, icon, kind, hidden (bool), rev |
| `list_visibility` | list_id, member_id |
| `list_item` | id, list_id, text, qty, category, checked, sort_key (fractional index), rev |
| `change_log` | household_id, rev (bigserial), entity, entity_id, op, payload jsonb, at (powers the sync protocol) |

All mutable rows carry `rev` (a household-scoped monotonic counter) and `updated_at`. Rows are soft-deleted with a `deleted_at` tombstone for sync.

## 5. API

### 5.1 Conventions
- Base `/api/v1`, JSON, Zod schemas shared from `packages/shared` and exposed as OpenAPI 3.1 via `@fastify/swagger`.
- Auth: `Authorization: Bearer <access JWT>` (users, 15 min) or `Device <token>` (displays, long-lived, revocable, scoped to the household).
- Idempotency: every mutation accepts an `Idempotency-Key` header (offline outbox replay).
- Errors: RFC 9457 `application/problem+json`.

### 5.2 Endpoints (MVP)

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/*` | better-auth routes (sign-up, sign-in, magic link) |
| POST | `/devices/pairing` | Display requests a pairing code → `{code, qrPayload, expiresAt}` |
| POST | `/devices/pairing/:code/claim` | App (adult) claims the code → binds the display to the household |
| GET | `/devices/pairing/:code` | Display polls for the device token |
| GET/POST/PATCH | `/households/:id`, `/members` | Household and member management |
| GET | `/events?from&to&members` | Expanded occurrences (local + external) within a range |
| POST/PATCH/DELETE | `/events/:id` | CRUD (scope: `this`/`following`/`all` for recurring events) |
| GET/POST/PATCH/DELETE | `/tasks`, `/routines` | Tasks and routines |
| POST | `/tasks/:id/complete` | `{memberId, occurrenceDate}` → credits points |
| POST | `/tasks/:id/uncomplete` | Undo (within 24 h) |
| GET/POST/PATCH/DELETE | `/rewards`, `/rewards/:id/redeem`, `/redemptions/:id/decide` | Rewards |
| GET/POST/PATCH/DELETE | `/lists`, `/lists/:id/items` | Lists |
| POST | `/external-calendars` | Link a provider (ICS URL, CalDAV creds, or OAuth code) |
| POST | `/pin/verify` | Verify the adult PIN on a display → short-lived elevated token (5 min) |
| GET | `/sync?since=<rev>` | Changes since a revision (delta sync) |
| WS | `/realtime` | Server → client `{type:"rev", rev}` and entity patches. Client → server heartbeat |

### 5.3 Sync protocol
1. The client holds `lastRev`. On (re)connect it calls `GET /sync?since=lastRev` and applies the changes in order.
2. The server writes each mutation and a `change_log` row in **one transaction**, then sends `NOTIFY household_<id>`. Each API node holding sockets for that household pushes the patch.
3. Offline clients queue mutations in an IndexedDB **outbox** with idempotency keys and replay them in order when back online. Conflicts are **last-writer-wins per field**. For list item ordering, fractional indexes make concurrent inserts merge cleanly.
4. External events never travel through `change_log`. Clients fetch them through `/events` for the visible window, and the display caches only ±14 days (FR-CAL-10).

## 6. Calendar sync engine (worker)

| Provider | Read | Write | Change detection |
|---|---|---|---|
| ICS/webcal | ✓ | ✗ | Poll every 15 min with `ETag`/`If-Modified-Since` |
| CalDAV (iCloud, Nextcloud, Fastmail…) | ✓ | ✓ | `sync-collection` (RFC 6578), fallback to ctag poll every 2–5 min |
| Google Calendar | ✓ | ✓ | `events.watch` push channels + `syncToken` incremental |
| Microsoft Graph | ✓ | ✓ | `/delta` + change-notification subscriptions |

- Each calendar is a pg-boss job with exponential backoff. Auth failures set `status=needs_reauth`, which shows a warning badge in the app.
- Credentials are encrypted with a per-installation master key (env/KMS) using AES-256-GCM.
- Recurrence is expanded server-side with `rrule` for the requested window, and time zones come from IANA tzdb.

## 7. Display device software

| Concern | Implementation |
|---|---|
| Boot | systemd → `cage -- chromium --kiosk --app=https://<server>/display --ozone-platform=wayland --noerrdialogs --disable-pinch --overscroll-history-navigation=0` |
| Local agent | `kinboard-agent` exposes `http://127.0.0.1:7777`: screen on/off (DPMS), brightness, volume, network status, OTA trigger, factory reset |
| Identity | On first boot the agent generates an Ed25519 key pair (kept on the data partition). Pairing binds the public key to the household, and the token is signed with it |
| Offline | Service worker caches the app shell. IndexedDB holds the last-synced household snapshot |
| Screen schedule | Agent cron plus touch wake. Idle → photo frame (FR-PHO-02) |
| OTA | RAUC bundles signed in CI, A/B slots with health-check confirmation after reboot and automatic rollback |
| Security | Read-only rootfs, no SSH by default, firewall with no inbound ports, unattended security updates via OTA |
| Dev mode | The same UI runs in any desktop browser at `/display` with a 1920×1080 viewport |

## 8. UI and UX specification

### 8.1 Design tokens
- **Member palette** (WCAG-checked on white and dark): `#E8596F` coral, `#4F8EF7` blue, `#3DBE8B` green, `#F5A524` amber, `#9B6BF2` violet, `#14B8C4` teal, `#F2709C` pink, `#7C8A9C` slate.
- Typography: **Inter** (OFL) for UI, **Fraunces** (OFL) for display numerals and the clock. Base size 18 px on the display, 16 px on mobile.
- Radius 16/24 px, soft shadows, light and dark themes, motion ≤ 250 ms (respects `prefers-reduced-motion`).

### 8.2 Display layout (1920×1080 landscape)
```
┌────────┬───────────────────────────────────────────────────────────┐
│ NAV    │ Header: clock · date · weather · member filter avatars    │
│ Home   ├───────────────────────────────────────────────────────────┤
│ Cal    │ Main view                                                 │
│ Tasks  │  Home:  [Today agenda] [Routines per member] [Meal/List]  │
│ Lists  │  Cal:   Day | Week | Month | Family-Day                   │
│ Meals  │  Tasks: one column per member, progress rings             │
│ Reward │  Lists: list rail + items, big quick-add                  │
│ ⚙ PIN  │  Rewards: balances + reward cards                         │
└────────┴───────────────────────────────────────────────────────────┘
          Floating "+" quick-add button (bottom-right)
```

### 8.3 Mobile layout
A bottom tab bar (Today, Calendar, Tasks, Lists, More), a floating "+" button, pull to refresh, and a "Display pairing" entry under More.

### 8.4 Child mode
Members with the `child` role act on the display without a PIN only for **complete task**, **check list item** (on non-hidden lists) and **request reward**. Every other mutation opens the PIN dialog.

## 9. Security and privacy

- Threat model (STRIDE) per release. Main risks: device theft (mitigation: revocation and remote wipe), OAuth token leakage (mitigation: encryption at rest and minimal scopes such as `calendar.events` only), child data exposure (mitigation: no analytics and hidden lists filtered server-side for display tokens).
- Hidden lists are **filtered server-side** for display tokens. The client never receives them.
- Rate limiting with `@fastify/rate-limit`, CSP headers, and SameSite cookies for web sessions.
- GDPR: a record of processing activities, DPA template for hosted service, export and delete endpoints, data retention (completions > 13 months are aggregated).

## 10. Repository and development environment

```
kinboard/
├── apps/
│   ├── web/            # React UI: /display and /app layouts (Vite)
│   ├── mobile/         # Capacitor project wrapping apps/web build
│   ├── api/            # Fastify REST + WebSocket server
│   └── agent/          # (planned) display device agent
├── packages/
│   └── shared/         # Zod schemas, domain types, pure domain logic
├── infra/
│   ├── docker-compose.yml   # postgres, api, web, caddy
│   ├── Caddyfile
│   └── kiosk/               # systemd units, cage/chromium launcher
├── docs/               # this documentation
└── package.json / pnpm-workspace.yaml / turbo.json / biome.json
```

- `pnpm dev` starts the API (port 8787) and web (port 5173). Open `/display` (kiosk layout) and `/app` (mobile layout) side by side to see realtime sync.
- The MVP API uses an **in-memory repository** behind a `Repository` interface, so the UI can be developed before the database layer. The Drizzle/PostgreSQL implementation replaces it in milestone M2.
- The web app has a **demo mode** (`VITE_DEMO=1`) with seeded local data and no server, used for design reviews and static previews.

## 11. Testing strategy

| Level | Tooling | Scope |
|---|---|---|
| Unit | Vitest | Shared domain logic: recurrence expansion, points ledger, permission checks |
| API | Vitest + Fastify `inject` | Routes, auth, idempotency |
| Component | Testing Library | Task check-off, PIN dialog, list editing |
| E2E | Playwright (1920×1080 and 390×844 viewports) | The key flows in FRD §7, plus realtime across two browser contexts |
| Device | Soak test on a Pi 5 for 72 h | Memory leaks, screen schedule, offline/online transitions |

## 12. Milestones

| M | Content | Exit criteria |
|---|---|---|
| M1 | UI MVP (this repo): display and mobile layouts, in-memory API, realtime | Flows 3–5 of FRD §7 work in the browser |
| M2 | PostgreSQL + Drizzle, auth, pairing, sync protocol, offline outbox | Two devices stay consistent through 1 h of offline time |
| M3 | ICS + CalDAV sync, reminders, Capacitor builds, push | Beta with 10 families |
| M4 | Google/MS OAuth, meals, photo frame, kiosk image + RAUC OTA | v1.0 |
| M5 | Local assistant module, Home Assistant integration | v1.x |
