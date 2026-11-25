# CLAUDE.md — Kinboard

Open-source family organiser: a wall display (kiosk), a mobile app (Capacitor) and a self-hostable server.
Current status and next steps are in **`HANDOVER.md`**. Requirements are in `docs/01-functional-requirements.md`, and the architecture is in `docs/02-technical-specification.md`.

## Commands
- `pnpm dev` starts the API on :8787 and the web app on :5173 (`/#/display`, `/#/app`, `/` studio)
- `pnpm dev:demo` runs the web app with the in-browser backend
- `pnpm test` · `pnpm typecheck` · `pnpm lint` all must pass before you commit
- `pnpm --filter @kinboard/shared test` runs the domain tests only

## Layout
- `packages/shared`: Zod types, **commands**, the **reducer `applyCommand`** (including permissions), selectors, seed
- `apps/api`: Fastify REST + WebSocket. `Repository` port: `DrizzleRepository` (Postgres via `DATABASE_URL`, PGlite in dev) and `InMemoryRepository` (tests). Schema changes: edit `src/db/schema.ts`, then `pnpm --filter @kinboard/api db:generate` and commit the SQL
- `apps/web`: React 19, Vite, Tailwind 4 (tokens in `src/styles/index.css`), Zustand store in `src/data/`
- `apps/mobile`: Capacitor wrapper around the `apps/web` build

## Rules
- Every state change is a `Command` handled by the shared reducer. Never mutate state anywhere else.
- Clients apply the server's change batches (`applyChanges`), never other clients' commands. Commands that devices may send concurrently or replay from an offline outbox must be idempotent (set values, don't toggle).
- Permissions belong in `isAllowed()` in the reducer. A UI check is never the only guard.
- Hidden lists must never reach display clients. This is enforced server-side.
- Display and mobile shells must not use `vh`/`vw` or `position: fixed`. Modals are `absolute` inside the shell.
- The reducer stays pure and deterministic: ids and timestamps arrive on the command.
- Only add mature, OSI-licensed dependencies, and record the licence in spec §2.2.
- Use TypeScript strict mode, Biome formatting (2 spaces, double quotes, width 110), and `.ts` extension imports inside workspace packages.
- Commit as `type(scope): message (FR-XXX-nn)` and reference requirement IDs.
- The UI language is English for now. i18n with i18next comes later, so keep user-facing strings easy to extract.
- Ask before changing the licence, the stack choices in spec §2, or the sync protocol.
