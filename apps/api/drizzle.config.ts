import { defineConfig } from "drizzle-kit";

/** `pnpm --filter @kinboard/api db:generate` writes SQL migrations to ./drizzle. They run on server start. */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
