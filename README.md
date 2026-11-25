# ✿ Kinboard

**Open-source family organiser**: a wall-mounted touchscreen, a companion app, and a self-hostable server.
Kinboard is inspired by commercial family planners such as Dæly, Skylight, and Hearth, but it is built entirely from robust OSI-licensed components and has no subscription lock-in.

| | |
|---|---|
| 📄 Product analysis | [`docs/00-product-analysis.md`](docs/00-product-analysis.md) |
| 📋 Functional requirements | [`docs/01-functional-requirements.md`](docs/01-functional-requirements.md) |
| 🛠 Technical specification and stack | [`docs/02-technical-specification.md`](docs/02-technical-specification.md) |

## Quick start

```bash
corepack enable            # Node 22+ and pnpm 10
pnpm install
pnpm dev                   # API → http://localhost:8787, Web → http://localhost:5173
```

| URL | What you see |
|---|---|
| `http://localhost:5173/` | **Studio**: the display and the phone side by side, sharing live state |
| `http://localhost:5173/#/display` | Kiosk UI (1920×1080). Child-safe by default; the adult PIN is `1234` |
| `http://localhost:5173/#/app` | Companion app layout (open it on your phone on the same Wi-Fi) |

Open `#/display` and `#/app` in two different browser windows. Ticking a chore or adding a grocery item syncs through the API's WebSocket in real time.

**No server?** `pnpm dev:demo` (or append `?demo`) runs the in-browser demo backend, and tabs sync with each other over `BroadcastChannel`.
`pnpm build:demo` builds a single self-contained `apps/web/dist-demo/index.html` for design reviews.

```bash
pnpm test        # domain + API tests (Vitest)
pnpm typecheck   # strict TypeScript across all packages
pnpm lint        # Biome
```

## Repository layout

```
apps/
  web/        React 19 + Vite + Tailwind 4: the /display (kiosk) and /app (mobile) shells
  mobile/     Capacitor 7 project wrapping the web build for iOS/Android
  api/        Fastify 5: REST commands, snapshot, WebSocket realtime, Drizzle/PostgreSQL repository
packages/
  shared/     Zod schemas, the command reducer, permissions, recurrence (rrule), seed data
infra/
  docker-compose.yml, Caddyfile   self-hosting (API + PostgreSQL + Caddy)
  kiosk/                          Raspberry Pi kiosk: Cage + Chromium systemd unit
docs/         analysis, FRD, specification
```

## Architecture in one paragraph

Every state change is a typed **command** (`task.complete`, `item.add`, `reward.decide` …) validated with Zod.
A single pure function, `applyCommand(state, command)` in `packages/shared`, runs **on the server** as the authority,
**in the client** for instant optimistic updates, and **in the demo backend**. Permissions such as child mode and hidden lists live in that same reducer,
so the UI, server and tests can never disagree. The server broadcasts applied commands over WebSocket, and clients replay them.
Data is stored in PostgreSQL through Drizzle (`DATABASE_URL`). Without it, `pnpm dev` uses an embedded PGlite database in `apps/api/.pglite/`; delete that folder to reset the demo data.

## MVP scope (milestone M1) ✅

- Display: Today dashboard (agenda with a "now" line, active routine per child, dinner, groceries), Week / Family-day / Month calendar,
  chores per member with progress rings and celebrations, lists with suggestions, a weekly dinner plan, a points and rewards flow, standby clock,
  member filter, and an adult PIN gate.
- App: Today, 14-day agenda, chores, lists (including private gift lists), reward approvals, a calendar-connections overview, and pairing.
- API: snapshot and command endpoints, idempotency, RFC 9457 errors, realtime fan-out, and a display projection that never leaks hidden lists.

**Next:** see the milestones in spec §12 (Postgres + auth + pairing, then CalDAV/ICS sync + push, then OAuth calendars + OTA image).

## Licence

Every dependency is OSI-approved (MIT, Apache-2.0, BSD, MPL-2.0, LGPL). The project licence is still **to be decided**:
AGPL-3.0 keeps hosted forks open, and Apache-2.0 allows maximum adoption. The `package.json` currently says AGPL-3.0-or-later.
