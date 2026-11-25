import { canSeeList } from "./reducer.ts";
import type { Snapshot } from "./types.ts";

/**
 * Entity-level changes (spec §5.3). The server records them per command (`change_log`) and sends them to
 * clients filtered per viewer; clients patch their snapshot instead of replaying other clients' commands.
 */
export type EntityName =
  | "household"
  | "member"
  | "event"
  | "routine"
  | "task"
  | "task_completion"
  | "reward"
  | "reward_redemption"
  | "points_ledger"
  | "list"
  | "list_item"
  | "meal";

export interface Change {
  entity: EntityName;
  id: string;
  op: "upsert" | "delete";
  /** The entity after an upsert. */
  data?: unknown;
}

/** Server-side form: deletes also carry the removed entity, so they can be filtered per viewer. Never sent. */
export interface StoredChange extends Change {
  prev?: unknown;
}

export interface ChangeBatch {
  /** Revision after these changes. */
  rev: number;
  changes: Change[];
}

type Keyed = Record<string, unknown>;
type CollectionKey = Exclude<keyof Snapshot, "rev" | "household">;

interface Collection {
  entity: EntityName;
  field: CollectionKey;
  key(e: Keyed): string;
}

const byId = (e: Keyed) => e.id as string;

/** Every collection of the snapshot, in a fixed order (parents before children). */
export const COLLECTIONS: readonly Collection[] = [
  { entity: "member", field: "members", key: byId },
  { entity: "event", field: "events", key: byId },
  { entity: "routine", field: "routines", key: byId },
  { entity: "task", field: "tasks", key: byId },
  {
    entity: "task_completion",
    field: "completions",
    key: (c) => `${c.taskId}:${c.memberId}:${c.date}`,
  },
  { entity: "reward", field: "rewards", key: byId },
  { entity: "reward_redemption", field: "redemptions", key: byId },
  { entity: "points_ledger", field: "ledger", key: byId },
  { entity: "list", field: "lists", key: byId },
  { entity: "list_item", field: "items", key: byId },
  { entity: "meal", field: "meals", key: byId },
];

/** JSON with sorted keys and without undefined values, so equal entities compare equal. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .filter((k) => (v as Keyed)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Keyed)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/** What changed between two snapshots: deletes first, then upserts (new or modified entities). */
export function diffSnapshots(prev: Snapshot, next: Snapshot): StoredChange[] {
  const deletes: StoredChange[] = [];
  const upserts: StoredChange[] = [];
  if (stableJson(prev.household) !== stableJson(next.household))
    upserts.push({ entity: "household", id: next.household.id, op: "upsert", data: next.household });
  for (const c of COLLECTIONS) {
    const before = new Map((prev[c.field] as Keyed[]).map((e) => [c.key(e), e]));
    const after = new Map((next[c.field] as Keyed[]).map((e) => [c.key(e), e]));
    for (const [id, e] of before)
      if (!after.has(id)) deletes.push({ entity: c.entity, id, op: "delete", prev: e });
    for (const [id, e] of after) {
      const old = before.get(id);
      if (!old || stableJson(old) !== stableJson(e))
        upserts.push({ entity: c.entity, id, op: "upsert", data: e });
    }
  }
  return [...deletes, ...upserts];
}

/** Applies changes to a snapshot (pure). Updated entities keep their position, new ones are appended. */
export function applyChanges(state: Snapshot, changes: readonly Change[], rev: number): Snapshot {
  const s: Snapshot = { ...state, rev };
  for (const ch of changes) {
    if (ch.entity === "household") {
      if (ch.op === "upsert") s.household = ch.data as Snapshot["household"];
      continue;
    }
    const c = COLLECTIONS.find((x) => x.entity === ch.entity);
    if (!c) continue; // unknown entity from a newer server: ignore
    const list = s[c.field] as Keyed[];
    const at = list.findIndex((e) => c.key(e) === ch.id);
    let next: Keyed[];
    if (ch.op === "delete") next = at < 0 ? list : list.filter((_, i) => i !== at);
    else if (at < 0) next = [...list, ch.data as Keyed];
    else next = list.map((e, i) => (i === at ? (ch.data as Keyed) : e));
    (s as unknown as Record<CollectionKey, Keyed[]>)[c.field] = next;
  }
  return s;
}

/**
 * The changes one viewer may receive (gap #3 for deltas): nothing about hidden lists they cannot see.
 * `state` is the state after the changes. Strips the server-only `prev`.
 */
export function projectChanges(
  changes: readonly StoredChange[],
  state: Snapshot,
  memberId: string | null,
): Change[] {
  const out: Change[] = [];
  for (const ch of changes) {
    const entity = (ch.data ?? ch.prev) as Keyed | undefined;
    if (ch.entity === "list" && entity && !canSeeList(entity as Snapshot["lists"][number], memberId))
      continue;
    if (ch.entity === "list_item") {
      const list = state.lists.find((l) => l.id === entity?.listId);
      if (!list || !canSeeList(list, memberId)) continue;
    }
    const { entity: name, id, op, data } = ch;
    out.push(op === "delete" ? { entity: name, id, op } : { entity: name, id, op, data });
  }
  return out;
}
