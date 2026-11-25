import { createSeed } from "@kinboard/shared";
import { buildApp } from "./app.ts";
import { type DbHandle, openPglite, openPostgres } from "./db/client.ts";
import { DrizzleRepository } from "./db/repository.ts";
import { InMemoryRepository, type Repository } from "./repository.ts";

const port = Number(process.env.PORT ?? 8787);
const production = process.env.NODE_ENV === "production";

/**
 * Storage, in order of precedence:
 *   KINBOARD_STORE=memory  → in-memory (data is lost on restart)
 *   DATABASE_URL           → PostgreSQL
 *   otherwise (dev only)   → embedded PGlite in KINBOARD_PGLITE_DIR (default ./.pglite)
 */
async function openStore(): Promise<{ repo: Repository; handle?: DbHandle; label: string }> {
  if (process.env.KINBOARD_STORE === "memory") return { repo: new InMemoryRepository(), label: "in-memory" };
  let handle: DbHandle;
  let label: string;
  if (process.env.DATABASE_URL) {
    handle = await openPostgres(process.env.DATABASE_URL);
    label = "PostgreSQL";
  } else if (!production) {
    const dir = process.env.KINBOARD_PGLITE_DIR ?? ".pglite";
    handle = await openPglite(dir);
    label = `PGlite (${dir})`;
  } else {
    throw new Error("DATABASE_URL is required in production");
  }
  const repo = new DrizzleRepository(handle.db);
  // Demo data until household creation lands (M2 step 8). Never seeded in production unless asked.
  if (!production || process.env.KINBOARD_SEED_DEMO === "1") await repo.seed(createSeed());
  await repo.pruneReceipts();
  setInterval(() => void repo.pruneReceipts().catch(() => {}), 6 * 3_600_000).unref();
  return { repo, handle, label };
}

const { repo, handle, label } = await openStore();
const app = buildApp(repo);
app.addHook("onClose", async () => handle?.close());
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void app.close());

app.listen({ port, host: "0.0.0.0" }).then(
  () => app.log.info(`storage: ${label}`),
  (err) => {
    app.log.error(err);
    process.exit(1);
  },
);
