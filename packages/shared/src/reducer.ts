import { parseLocal, tasksForDay } from "./selectors.ts";
import type { Command, List, Snapshot, Task } from "./types.ts";

export class DomainError extends Error {
  constructor(
    public code: "forbidden" | "not_found" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

/** Commands a child (or the un-elevated shared display) may perform without the adult PIN. FRD §8.4 */
const CHILD_SAFE: ReadonlySet<Command["type"]> = new Set([
  "task.complete",
  "task.uncomplete",
  "item.add",
  "item.toggle",
  "reward.request",
]);

export function isAllowed(state: Snapshot, cmd: Command): boolean {
  if (cmd.actor.elevated) return true;
  if (CHILD_SAFE.has(cmd.type)) {
    // A signed-in child acts only for themself. The shared display (memberId null) may act for anyone.
    if (
      (cmd.type === "task.complete" || cmd.type === "task.uncomplete" || cmd.type === "reward.request") &&
      cmd.actor.memberId !== null &&
      cmd.actor.memberId !== cmd.memberId
    )
      return false;
    // Children may not touch hidden lists, even ones they can see.
    return !hiddenListOf(state, cmd);
  }
  // Signed-in adults (app) are elevated by definition; everything else needs the PIN.
  const actor = state.members.find((m) => m.id === cmd.actor.memberId);
  return actor?.role === "adult" && cmd.actor.device === "app";
}

const DAY_MS = 86_400_000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Days between a YYYY-MM-DD key and the UTC calendar day of an ISO timestamp (NaN if either is invalid). */
function daysFromCommandTime(date: string, at: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const atMs = Date.parse(at);
  return (Date.UTC(y, m - 1, d) - (atMs - (atMs % DAY_MS))) / DAY_MS;
}

/** Rejects completions points could be farmed with (FR-TSK-03, FR-RWD-01). */
function assertCompletable(state: Snapshot, cmd: Extract<Command, { type: "task.complete" }>): Task {
  const task = state.tasks.find((t) => t.id === cmd.taskId);
  if (!task) throw new DomainError("not_found", "task");
  if (!task.memberIds.includes(cmd.memberId))
    throw new DomainError("invalid", "task is not assigned to this member");
  if (!DATE_KEY.test(cmd.date) || Number.isNaN(parseLocal(cmd.date).getTime()))
    throw new DomainError("invalid", "date must be YYYY-MM-DD");
  if (!tasksForDay([task], parseLocal(cmd.date)).length)
    throw new DomainError("invalid", "task is not due on this date");
  // Without the PIN only today's occurrence counts. ±1 day absorbs the device's offset from UTC.
  if (!cmd.actor.elevated && !(Math.abs(daysFromCommandTime(cmd.date, cmd.at)) <= 1))
    throw new DomainError("invalid", "only today's tasks can be completed without the adult PIN");
  return task;
}

function assertNewId(existing: readonly { id: string }[], id: string) {
  if (existing.some((x) => x.id === id)) throw new DomainError("invalid", `duplicate id ${id}`);
}

export function balanceOf(state: Snapshot, memberId: string): number {
  return state.ledger.filter((l) => l.memberId === memberId).reduce((s, l) => s + l.delta, 0);
}

/**
 * Pure, deterministic state transition shared by server, demo backend and optimistic client updates.
 * Returns a NEW snapshot with rev + 1. Throws DomainError on rejection.
 */
export function applyCommand(state: Snapshot, cmd: Command): Snapshot {
  // A hidden list the actor may not see behaves as if it did not exist (FR-LST-04).
  const hidden = hiddenListOf(state, cmd);
  if (hidden && !canSeeList(hidden, cmd.actor.memberId)) throw new DomainError("not_found", "list");
  if (!isAllowed(state, cmd)) throw new DomainError("forbidden", `${cmd.type} requires adult PIN`);
  const s: Snapshot = structuredClone(state);
  s.rev = state.rev + 1;

  switch (cmd.type) {
    case "task.complete": {
      const task = assertCompletable(s, cmd);
      const done = s.completions.some(
        (c) => c.taskId === cmd.taskId && c.memberId === cmd.memberId && c.date === cmd.date,
      );
      if (done) return state; // idempotent
      s.completions.push({ taskId: cmd.taskId, memberId: cmd.memberId, date: cmd.date, at: cmd.at });
      if (task.points > 0)
        s.ledger.push({
          id: `L-${cmd.id}`,
          memberId: cmd.memberId,
          delta: task.points,
          reason: "task",
          refId: `${cmd.taskId}@${cmd.date}`,
          at: cmd.at,
        });
      break;
    }
    case "task.uncomplete": {
      const before = s.completions.length;
      s.completions = s.completions.filter(
        (c) => !(c.taskId === cmd.taskId && c.memberId === cmd.memberId && c.date === cmd.date),
      );
      if (before === s.completions.length) return state;
      const ref = `${cmd.taskId}@${cmd.date}`;
      const idx = s.ledger.findIndex(
        (l) => l.reason === "task" && l.refId === ref && l.memberId === cmd.memberId,
      );
      if (idx >= 0) s.ledger.splice(idx, 1);
      break;
    }
    case "task.add":
      assertNewId(s.tasks, cmd.task.id);
      s.tasks.push(cmd.task);
      break;
    case "task.delete":
      s.tasks = s.tasks.filter((t) => t.id !== cmd.taskId);
      break;
    case "event.add":
      assertNewId(s.events, cmd.event.id);
      s.events.push(cmd.event);
      break;
    case "event.delete":
      s.events = s.events.filter((e) => e.id !== cmd.eventId);
      break;
    case "list.add":
      assertNewId(s.lists, cmd.list.id);
      s.lists.push(cmd.list);
      break;
    case "item.add":
      if (!s.lists.some((l) => l.id === cmd.item.listId)) throw new DomainError("not_found", "list");
      assertNewId(s.items, cmd.item.id);
      s.items.push(cmd.item);
      break;
    case "item.toggle": {
      const it = s.items.find((i) => i.id === cmd.itemId);
      if (!it) throw new DomainError("not_found", "item");
      it.checked = !it.checked;
      break;
    }
    case "item.remove":
      s.items = s.items.filter((i) => i.id !== cmd.itemId);
      break;
    case "reward.add":
      assertNewId(s.rewards, cmd.reward.id);
      s.rewards.push(cmd.reward);
      break;
    case "reward.request": {
      const reward = s.rewards.find((r) => r.id === cmd.rewardId);
      if (!reward) throw new DomainError("not_found", "reward");
      if (!s.members.some((m) => m.id === cmd.memberId)) throw new DomainError("not_found", "member");
      assertNewId(s.redemptions, cmd.redemptionId);
      const pending = s.redemptions
        .filter((r) => r.memberId === cmd.memberId && r.status === "requested")
        .reduce((sum, r) => sum + (s.rewards.find((x) => x.id === r.rewardId)?.cost ?? 0), 0);
      if (balanceOf(s, cmd.memberId) - pending < reward.cost)
        throw new DomainError("invalid", "not enough points");
      s.redemptions.push({
        id: cmd.redemptionId,
        rewardId: cmd.rewardId,
        memberId: cmd.memberId,
        status: "requested",
        at: cmd.at,
      });
      break;
    }
    case "reward.decide": {
      const r = s.redemptions.find((x) => x.id === cmd.redemptionId);
      if (!r || r.status !== "requested") throw new DomainError("not_found", "redemption");
      r.status = cmd.approve ? "approved" : "rejected";
      if (cmd.approve) {
        const cost = s.rewards.find((x) => x.id === r.rewardId)?.cost ?? 0;
        s.ledger.push({
          id: `L-${cmd.id}`,
          memberId: r.memberId,
          delta: -cost,
          reason: "redeem",
          refId: r.id,
          at: cmd.at,
        });
      }
      break;
    }
    case "meal.set":
      s.meals = s.meals.filter((m) => !(m.date === cmd.meal.date && m.slot === cmd.meal.slot));
      s.meals.push(cmd.meal);
      break;
  }
  return s;
}

/** Server-side projection for shared display tokens: hidden lists never leave the server (spec §9). */
export function projectForDisplay(state: Snapshot): Snapshot {
  return projectForMember(state, null);
}

/** Who may see a list: everyone for normal lists, only `visibleTo` members for hidden ones. Displays are `null`. */
export function canSeeList(list: List, memberId: string | null): boolean {
  return !list.hidden || (memberId !== null && list.visibleTo.includes(memberId));
}

/** Server-side projection per viewer: hidden lists and their items reach only members in `visibleTo` (gap #3). */
export function projectForMember(state: Snapshot, memberId: string | null): Snapshot {
  const invisible = new Set(state.lists.filter((l) => !canSeeList(l, memberId)).map((l) => l.id));
  if (!invisible.size) return state;
  return {
    ...state,
    lists: state.lists.filter((l) => !invisible.has(l.id)),
    items: state.items.filter((i) => !invisible.has(i.listId)),
  };
}

/**
 * The hidden list a command touches, resolved against the state BEFORE the command
 * (after an `item.remove` the item, and with it the list, can no longer be found).
 */
export function hiddenListOf(state: Snapshot, cmd: Command): List | undefined {
  if (cmd.type === "list.add") return cmd.list.hidden ? cmd.list : undefined;
  const listId =
    cmd.type === "item.add"
      ? cmd.item.listId
      : cmd.type === "item.toggle" || cmd.type === "item.remove"
        ? state.items.find((i) => i.id === cmd.itemId)?.listId
        : undefined;
  const list = listId ? state.lists.find((l) => l.id === listId) : undefined;
  return list?.hidden ? list : undefined;
}
