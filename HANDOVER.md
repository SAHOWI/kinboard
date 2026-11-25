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

Verified on 2026-11-25: `pnpm test` (34 tests) ✅ · `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm build` and `pnpm build:demo` ✅ ·
display and app in two browsers against the live API sync in real time ✅ · hidden lists reach only members in `visibleTo` and never the display ✅.

| Area | Status |
|---|---|
| `packages/shared` | Zod schemas, the command reducer with permissions, recurrence (rrule), selectors, seed data, 13 tests |
| `apps/api` | Fastify: `GET /api/v1/snapshot`, `POST /api/v1/commands` (idempotent, RFC 9457 errors), `POST /api/v1/pin/verify`, `WS /api/v1/realtime`, **Drizzle repository** on PostgreSQL (`DATABASE_URL`) or embedded PGlite in dev (`apps/api/.pglite/`, delete it to reset the demo data); `KINBOARD_STORE=memory` keeps the in-memory one. The server builds the `Actor` from a **temporary dev token** (see gap #1). 21 tests |
| `apps/web` | React 19 + Vite 6 + Tailwind 4 + Zustand. Routes: `#/` studio (side by side), `#/display`, `#/app`. Demo backend (no server) with BroadcastChannel tab sync. Falls back to demo mode automatically if the API is unreachable |
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
UI action ──► CommandInput + Actor ──► store.dispatch()
                                         │ 1. applyCommand() locally (optimistic, same rules)
                                         │ 2. POST /commands (idempotent by command.id)
                                         ▼
                           API: Zod validate → repo.apply() → applyCommand() → broadcast WS
                                         ▼
                Other clients: receive {type:"applied", command} → applyCommand() locally
                (pending ids are skipped; any error or {type:"rev"} → full resync via /snapshot)
```

**Invariants (do not break):**
1. **All state changes go through a `Command`** in `packages/shared/src/types.ts`, and **one pure reducer** in `reducer.ts`. There are no ad-hoc mutations in the API or UI.
2. **Permissions live in the reducer** (`isAllowed`). UI checks are convenience only. Children may only run `task.complete/uncomplete`, `item.add/toggle` (on non-hidden lists) and `reward.request`.
3. **Hidden lists reach only members in `visibleTo`, never a display.** This is enforced server-side: `projectForMember` on `/snapshot`, per-viewer WS fan-out (`rev` instead of the command) in `app.ts`, and the reducer treats a hidden list the actor can't see as `not_found`.
4. **Shells never use viewport units or `position: fixed`.** The studio view renders both shells scaled inside boxes. Modals are `absolute` inside the shell.
5. **The reducer is deterministic.** Ids and timestamps come in on the command, not from `Date.now()` inside the reducer.
6. **New dependencies must be OSI-licensed and mature.** Record the licence in spec §2.2 when you add one.

## 5. Known gaps and technical debt (prioritised)

| # | Severity | Issue | Where | Fix (milestone) |
|---|---|---|---|---|
| 1 | 🔴 Security | **The actor is trusted from the client.** Anyone can send `elevated: true` | `app.ts`, `auth.ts` | ✅ **Fixed 2026-11-25.** The server builds the Actor and ignores the client's. Identity comes from unsigned dev tokens (`Bearer dev:display`, `dev:app:<memberId>`, `?token=` on the WebSocket), which anyone can forge, so they are refused when `NODE_ENV=production` unless `KINBOARD_DEV_AUTH=1`. Display elevation needs a server-issued PIN token. **Remaining:** replace dev tokens with better-auth sessions and device tokens (M2 steps 3 and 5) |
| 2 | 🔴 Security | The PIN is checked client-side (`"1234"` hard-coded) | `auth.ts` | 🟡 **Partly fixed 2026-11-25.** `POST /pin/verify` checks it server-side (constant-time compare, 5 failures → 60 s lockout) and returns a 5-min elevation token (`x-kinboard-elevation`). The PIN comes from `KINBOARD_PIN` (`1234` only with dev auth). **Remaining:** Argon2id hash on the household, persisted lockout (M2) |
| 3 | 🔴 Privacy | App clients receive **all** hidden lists, not only those where they are in `visibleTo` | `reducer.ts`, `app.ts` | ✅ **Fixed 2026-11-25.** `projectForMember(state, memberId)` on snapshot and realtime. Commands on a hidden list the actor can't see fail with `not_found` |
| 4 | 🟠 Data | In-memory repository, so data was lost on restart. Single hard-coded household `hh_1` | `db/` | ✅ **Fixed 2026-11-25** (except the household): Drizzle schema + migrations in `apps/api/drizzle`, `DrizzleRepository` writes each command in one transaction (row lock, reducer, diffed entity rows, `change_log`, receipt). LISTEN/NOTIFY deferred to multi-node / delta sync. `hh_1` stays until M2 step 8 |
| 5 | 🟠 Sync | No `GET /sync?since=rev`. Reconnect does a full snapshot. No offline outbox | `backend.ts` | Implement spec §5.3 (M2) |
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
| 16 | 🟠 Security | The date window trusts the client's `cmd.at` | `app.ts` | The server should stamp `at` itself. This changes the sync protocol, so ask first |
| 17 | 🟠 Sync | `resync()` clears `pending`. An own echo arriving afterwards is applied twice (`item.toggle` flips back, `item.add` duplicates). Clients never compare `rev` | `store.ts` | Keep pending ids until echoed, and resync on a rev gap (with M2 step 7) |
| 18 | 🟡 Security | CORS allows every origin (`origin: true`) while there is no auth | `app.ts` | Restrict to configured origins (M2 auth) |
| 19 | 🟡 Infra | No `.dockerignore` (`COPY . .` copies `node_modules`). Compose requires `KINBOARD_MASTER_KEY`, which nothing reads. The API runs via `tsx` in production | `infra/`, `apps/api/Dockerfile` | Fix together with #12 |
| — | Open decision | **Licence.** AGPL-3.0 is set for now; Apache-2.0 is the alternative | `package.json` | Ask Holger before release |

## 6. Next milestone: M2 work plan

Do these in order. Each step should be a separate PR (or commit) with tests.

1. **Repo hygiene.** git init, a CI workflow (install → lint → typecheck → test → build), and Turborepo for cached builds (optional).
2. ~~**Postgres + Drizzle.**~~ Done 2026-11-25. Deviations from spec §4.1: text ids instead of UUID v7, event times kept as floating text (gap #8), no tombstones or per-row `rev` yet (step 7), no LISTEN/NOTIFY yet. Run `DATABASE_URL_TEST=postgres://… pnpm test` to run the repository suite against a real Postgres too.
3. **Auth.** better-auth (e-mail/password + magic link), sessions, `users ↔ members` link. **The server builds the `Actor`.** Remove `actor` from the client payload (fixes gap #1).
4. **Adult PIN.** Hashed PIN, `POST /pin/verify` returning an elevated token valid for 5 min, rate limiting (gap #2).
5. **Device pairing.** Device-code flow (spec §5.2): the display shows a QR code and short code, the app claims it, and the display receives a revocable device token. Remote revoke (FR-HH-05, FR-HH-07).
6. ~~**Per-member projection** for hidden lists (gap #3), applied to both snapshot and realtime.~~ Done 2026-11-25.
7. **Delta sync and offline outbox.** `GET /sync?since`, an IndexedDB outbox with replay, TanStack Query persistence (spec §5.3, NFR-05).
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
