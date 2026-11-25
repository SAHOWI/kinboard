# Kinboard — Handover to Claude Code

| Item | Value |
|---|---|
| Date | 2026-11-25 |
| Status | **Milestone M1 (UI MVP) complete**. Next up: **M2 (persistence, auth, pairing, sync)** |
| Owner | Holger (Neurova) |
| Codename | Kinboard (a working title, not final branding) |
| Read first | `CLAUDE.md` (standing rules), then this file, then `docs/02-technical-specification.md` |

---

## 1. What this project is

Kinboard is an open-source family organiser inspired by the Dæly wall planner. It has three parts:

1. **Home Display**: a 15.6" 1920×1080 touchscreen kiosk (Raspberry Pi 5 + Chromium in Cage).
2. **Mobile App**: the same React UI wrapped with Capacitor for iOS and Android.
3. **Server**: Fastify + PostgreSQL, self-hostable with Docker Compose.

The core features are a shared colour-coded family calendar with external calendar sync, chores and routines for kids,
points and rewards, shared and private lists, a meal plan, and a standby photo frame. **Hard constraint:** every software component
must be robust and OSI-licensed open source. Proprietary services (APNs/FCM, Google/Microsoft calendar APIs) are allowed only behind adapters.

| Document | Purpose |
|---|---|
| `docs/00-product-analysis.md` | Feature teardown of Dæly, competitors, opportunities |
| `docs/01-functional-requirements.md` | Requirements with IDs (`FR-CAL-05`, …) and MoSCoW priority; release plan in §8 |
| `docs/02-technical-specification.md` | Architecture, stack and licences, data model, API, sync protocol, device, UX tokens, milestones (§12) |
| `docs/screenshots/` | Current UI state (display + app) |

**Rule:** reference FR IDs in commits and PRs, for example `feat(tasks): parent approval (FR-TSK-05)`.

## 2. Current state (what exists and works)

Verified on 2026-11-25: `pnpm test` (61 tests) ✅ · `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm build` and `pnpm build:demo` ✅ ·
display and app in two browsers against the live API sync in real time ✅ · hidden lists reach only members in `visibleTo` and never the display ✅.

| Area | Status |
|---|---|
| `packages/shared` | Zod schemas, the command reducer with permissions, recurrence (rrule), selectors, seed data, delta-sync model (`diffSnapshots`, `applyChanges`, `projectChanges`), 17 tests |
| `apps/api` | Fastify: `GET /api/v1/snapshot`, `POST /api/v1/commands` (idempotent, RFC 9457 errors), `POST /api/v1/pin/verify`, `PUT /api/v1/pin`, `GET /api/v1/sync?since=`, `WS /api/v1/realtime`, **Drizzle repository** on PostgreSQL (`DATABASE_URL`) or embedded PGlite in dev (`apps/api/.pglite/`, delete it to reset the demo data); `KINBOARD_STORE=memory` keeps the in-memory one. The server builds the `Actor` from a **temporary dev token** (see gap #1). 31 tests |
| `apps/web` | React 19 + Vite 6 + Tailwind 4 + Zustand. Routes: `#/` studio (side by side), `#/display`, `#/app`. Demo backend (no server) with BroadcastChannel tab sync. Falls back to demo mode automatically if the API is unreachable | Sync engine with IndexedDB cache and offline outbox, 13 tests
| `apps/mobile` | Capacitor 7 config only. **Native projects not generated; never built** |
| `infra/` | docker-compose (the API now uses its Postgres through `DATABASE_URL`), Caddyfile, Pi kiosk systemd unit. **Not tested end to end** (the local Podman VM is broken). A production start has no household yet: until M2 step 8 set `KINBOARD_SEED_DEMO=1` to seed the demo |
| Not started | Auth, pairing, PostgreSQL, calendar sync, push, i18n, OTA, display agent, photo upload, recipes |

Live demo (static single-file build): `https://claude.ai/artifact/F3XVcHg6VQ8tUxA4crTwjE` (private to Holger).

## 3. Getting started

```bash
# Node 22+, pnpm 10 (corepack enable)
pnpm install
pnpm dev            # API :8787 + web :5173 → open /#/display and /#/app in two windows
pnpm dev:demo       # web only, in-browser backend
pnpm test && pnpm typecheck && pnpm lint      # must all pass before every commit
```

Git was initialised on 2026-11-25 (`main`, import commit `chore: import M1 MVP`). `.gitattributes` keeps LF endings for Biome, and the generated `apps/web/dist-demo` is ignored.

## 4. Architecture you must preserve

```
UI action ──► CommandInput + Actor ──► store.dispatch() ──► SyncEngine (apps/web/src/data/sync.ts)
                       │ 1. queue in the outbox (IndexedDB), view = base + outbox via applyCommand()
                       │ 2. POST /commands one at a time, in order (idempotent by command.id)
                       ▼
  API: identify → build Actor → repo.apply(): applyCommand() → diffSnapshots() → rows + change_log
                       ▼
  WS {type:"changes", rev, changes} per viewer (projectChanges) ──► every client: applyChanges() on base
  (rev gap or reconnect → GET /sync?since=base.rev; {reset:true} → GET /snapshot)
```

**Invariants (do not break):**
1. **All state changes go through a `Command`** in `packages/shared/src/types.ts`, and **one pure reducer** in `reducer.ts`. There are no ad-hoc mutations in the API or UI.
2. **Permissions live in the reducer** (`isAllowed`). UI checks are convenience only. Children may only run `task.complete/uncomplete`, `item.add/check` (on non-hidden lists) and `reward.request`.
3. **Hidden lists reach only members in `visibleTo`, never a display.** This is enforced server-side: `projectForMember` on `/snapshot`, per-viewer WS fan-out (`rev` instead of the command) in `app.ts`, and the reducer treats a hidden list the actor can't see as `not_found`.
4. **Shells never use viewport units or `position: fixed`.** The studio view renders both shells scaled inside boxes. Modals are `absolute` inside the shell.
5. **The reducer is deterministic.** Ids and timestamps come in on the command, not from `Date.now()` inside the reducer.
6. **New dependencies must be OSI-licensed and mature.** Record the licence in spec §2.2 when you add one.

## 5. Known gaps and technical debt (prioritised)

| # | Severity | Issue | Where | Fix (milestone) |
|---|---|---|---|---|
| 1 | 🔴 Security | **The actor is trusted from the client.** Anyone can send `elevated: true` | `app.ts`, `auth.ts` | ✅ **Fixed 2026-11-25.** The server builds the Actor and ignores the client's. Identity comes from unsigned dev tokens (`Bearer dev:display`, `dev:app:<memberId>`, `?token=` on the WebSocket), which anyone can forge, so they are refused when `NODE_ENV=production` unless `KINBOARD_DEV_AUTH=1`. Display elevation needs a server-issued PIN token. **Remaining:** replace dev tokens with better-auth sessions and device tokens (M2 steps 3 and 5) |
| 2 | 🔴 Security | The PIN was checked client-side (`"1234"` hard-coded) | `auth.ts` | ✅ **Fixed 2026-11-26.** Stored only as an Argon2id hash (19 MiB, t=2) in `household.pin_hash`, peppered with a key derived from `KINBOARD_MASTER_KEY` (a 4-digit PIN would otherwise be brute-forced from a leaked hash in minutes; changing the key resets the PIN). Lockout persisted in `pin_attempt`: 5 failures per device → 60 s, 20 per household per hour → 15 min. Adults change it in the app (`PUT /api/v1/pin`). `KINBOARD_PIN` (dev default `1234`) only sets the initial PIN. Elevation tokens stay in memory (5 min) |
| 3 | 🔴 Privacy | App clients receive **all** hidden lists, not only those where they are in `visibleTo` | `reducer.ts`, `app.ts` | ✅ **Fixed 2026-11-25.** `projectForMember(state, memberId)` on snapshot and realtime. Commands on a hidden list the actor can't see fail with `not_found` |
| 4 | 🟠 Data | In-memory repository, so data was lost on restart. Single hard-coded household `hh_1` | `db/` | ✅ **Fixed 2026-11-25** (except the household): Drizzle schema + migrations in `apps/api/drizzle`, `DrizzleRepository` writes each command in one transaction (row lock, reducer, diffed entity rows, `change_log`, receipt). LISTEN/NOTIFY deferred to multi-node / delta sync. `hh_1` stays until M2 step 8 |
| 5 | 🟠 Sync | No `GET /sync?since=rev`. Reconnect did a full snapshot. No offline outbox | `sync.ts` | ✅ **Fixed 2026-11-26.** Clients apply per-viewer change batches (WS) and catch up through `/sync`; `{reset:true}` → snapshot. Outbox and last confirmed state in IndexedDB, so the app starts offline from cache (NFR-05). `item.toggle` replaced by idempotent `item.check` (FR-LST-05). Queued commands older than 7 days are dropped. **Limits:** two tabs with the same identity share one cache key and can overwrite each other's outbox; adult actions queued on a display fail if the PIN token expired |
| 6 | 🟠 Sync | The idempotency `Set` grew forever | `db/repository.ts` | ✅ **Fixed 2026-11-25** for Postgres: `command_receipt` table, pruned after 7 days at start and every 6 h. The in-memory repository still grows (tests only) |
| 7 | 🟡 Leak | `item.remove` on a hidden list sent its item id to displays | `app.ts` broadcast | ✅ **Fixed 2026-11-25.** The touched list is resolved before the command is applied (`hiddenListOf`) |
| 8 | 🟡 Time | Recurrence uses the "floating time" trick with browser-local time. Household timezone is ignored | `selectors.ts` | Expand in `household.timezone` using `@date-fns/tz` |
| 9 | 🟡 UX | Display time grid is fixed at 07:00–22:00. Home routine card has empty space when there are few tasks | `CalendarView.tsx`, `HomeView.tsx` | Auto-range. Show upcoming chores |
| 10 | 🟡 Mocks | Weather, connected calendars, pairing QR (fake pattern), and the "signed in as" switch in the app are mock-ups | various | Replace in M2/M3 |
| 11 | 🟢 Size | The single-file demo build inlines every font subset (~840 KB) | `styles/index.css` | Import latin subsets only |
| 12 | 🟢 Infra | Dockerfile and compose are untested. Caddy expects a prebuilt `apps/web/dist` | `infra/` | Multi-stage web image, CI smoke test |
| 13 | 🟢 Tests | No component or E2E tests for the web app | `apps/web` | Testing Library + Playwright (two contexts for realtime) |
| 14 | 🔴 Security | `task.complete` and `reward.request` could be crafted to farm points: unassigned members, invented or past dates, a child acting for a sibling, unknown members | `reducer.ts` | ✅ **Fixed 2026-11-25.** The task must be assigned and due that day, and without the PIN the date must be within ±1 day of `cmd.at`. A signed-in child acts only for themself. Tests in `domain.test.ts` and `app.test.ts` |
| 15 | 🟠 Data | `*.add` commands accepted duplicate entity ids | `reducer.ts` | ✅ **Fixed 2026-11-25.** They are rejected with `invalid` |
| 16 | ⚪ Won't fix | The date window trusts the client's `cmd.at` | `reducer.ts` | **Closed 2026-11-26.** Offline check-offs replayed later need the time they were made; a server-stamped `at` would reject yesterday's ticks. Revisit with signed device clocks if abuse appears |
| 17 | 🟠 Sync | An own echo could be applied twice after a resync; clients never compared `rev` | `store.ts` | ✅ **Fixed 2026-11-26** by the sync engine: clients never replay commands from the server, batches are applied only at `base.rev + 1` |
| 18 | 🟡 Security | CORS allows every origin (`origin: true`) while there is no auth | `app.ts` | Restrict to configured origins (M2 auth) |
| 19 | 🟡 Infra | No `.dockerignore` (`COPY . .` copies `node_modules`). Compose requires `KINBOARD_MASTER_KEY`, which nothing reads. The API runs via `tsx` in production | `infra/`, `apps/api/Dockerfile` | Fix together with #12 |
| — | Open decision | **Licence.** AGPL-3.0 is set for now; Apache-2.0 is the alternative | `package.json` | Ask Holger before release |

## 6. Next milestone: M2 work plan

Do these in order. Each step should be a separate PR (or commit) with tests.

1. **Repo hygiene.** git init, a CI workflow (install → lint → typecheck → test → build), and Turborepo for cached builds (optional).
2. ~~**Postgres + Drizzle.**~~ Done 2026-11-25. Deviations from spec §4.1: text ids instead of UUID v7, event times kept as floating text (gap #8), no tombstones or per-row `rev` yet (step 7), no LISTEN/NOTIFY yet. Run `DATABASE_URL_TEST=postgres://… pnpm test` to run the repository suite against a real Postgres too.
3. **Auth.** better-auth (e-mail/password + magic link), sessions, `users ↔ members` link. **The server builds the `Actor`.** Remove `actor` from the client payload (fixes gap #1).
4. ~~**Adult PIN.**~~ Done 2026-11-26 (see gap #2).
5. **Device pairing.** Device-code flow (spec §5.2): the display shows a QR code and short code, the app claims it, and the display receives a revocable device token. Remote revoke (FR-HH-05, FR-HH-07).
6. ~~**Per-member projection** for hidden lists (gap #3), applied to both snapshot and realtime.~~ Done 2026-11-25.
7. ~~**Delta sync and offline outbox.**~~ Done 2026-11-26 (see gap #5). TanStack Query was not adopted: the Zustand store plus a ~60-line IndexedDB wrapper covers persistence (spec §2.2).
8. **Household creation and member management** (FR-HH-01…04).

**M2 exit criteria:** two devices stay consistent through 1 h offline. A restart loses no data. The display never receives hidden lists.
A child account cannot perform protected commands even with a crafted request (add an API test for this).

After M2, M3 is ICS + CalDAV sync (tsdav, ical.js, pg-boss jobs), reminders, Capacitor builds and push. See spec §12.

## 7. Suggested first prompts for Claude Code

```text
1. Read CLAUDE.md, HANDOVER.md and docs/02-technical-specification.md. Run the test, typecheck and lint
   commands and confirm everything is green. Then initialise git and make the import commit.
2. Fix security gap #1 from HANDOVER.md §5 in a test-first way: the API must derive the Actor server-side.
   For now, use a temporary dev token header until auth lands. Add an API test where a crafted
   {elevated:true} from a child device is rejected.
3. Implement M2 step 2 (Drizzle + Postgres repository) per spec §4.1 and §5.3. Plan first and show me
   the schema before writing migrations.
```

## 8. Definition of done (every change)

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass.
- New domain logic has Vitest coverage in `packages/shared`. New endpoints have `app.inject` tests.
- UI changes are checked at 1920×1080 (`#/display`) and 390×844 (`#/app`). Touch targets are ≥ 48 px (≥ 64 px for child actions).
- No new non-OSI dependency. Licence noted in spec §2.2.
- Docs are updated when behaviour, the API or the schema changes (FRD/spec plus this file's status table).
