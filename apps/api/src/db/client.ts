import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.ts";

/** Driver-independent Drizzle handle: node-postgres in production, PGlite for tests and local dev. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export interface DbHandle {
  db: Db;
  close(): Promise<void>;
}

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** PostgreSQL via node-postgres. Runs pending migrations. `reset` drops everything first (tests only). */
export async function openPostgres(url: string, opts: { reset?: boolean } = {}): Promise<DbHandle> {
  const [{ Pool }, { drizzle }, { migrate }] = await Promise.all([
    import("pg"),
    import("drizzle-orm/node-postgres"),
    import("drizzle-orm/node-postgres/migrator"),
  ]);
  const pool = new Pool({ connectionString: url, max: 10 });
  if (opts.reset)
    await pool.query(
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
    );
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => pool.end() };
}

/**
 * Embedded Postgres (PGlite, WASM). In memory without `dataDir`, otherwise persisted in that folder.
 * PGlite is a dev dependency: never the production database.
 */
export async function openPglite(dataDir?: string): Promise<DbHandle> {
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => client.close() };
}
