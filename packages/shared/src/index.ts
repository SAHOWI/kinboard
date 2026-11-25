export * from "./types.ts";
export * from "./reducer.ts";
export * from "./selectors.ts";
export * from "./seed.ts";
export * from "./sync.ts";

let counter = 0;
/** Sortable, collision-resistant id (UUID v7 on the server in production). */
export function newId(prefix = "id"): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
