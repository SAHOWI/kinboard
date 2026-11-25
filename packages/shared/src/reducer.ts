import type { Command, Snapshot } from "./types.ts";

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
    // Children may not touch hidden lists.
    if (cmd.type === "item.toggle" || cmd.type === "item.add") {
      const listId =
        cmd.type === "item.add" ? cmd.item.listId : state.items.find((i) => i.id === cmd.itemId)?.listId;
      const list = state.lists.find((l) => l.id === listId);
      if (list?.hidden) return false;
    }
    return true;
  }
  // Signed-in adults (app) are elevated by definition; everything else needs the PIN.
  const actor = state.members.find((m) => m.id === cmd.actor.memberId);
  return actor?.role === "adult" && cmd.actor.device === "app";
}

export function balanceOf(state: Snapshot, memberId: string): number {
  return state.ledger.filter((l) => l.memberId === memberId).reduce((s, l) => s + l.delta, 0);
}

/**
 * Pure, deterministic state transition shared by server, demo backend and optimistic client updates.
 * Returns a NEW snapshot with rev + 1. Throws DomainError on rejection.
 */
export function applyCommand(state: Snapshot, cmd: Command): Snapshot {
  if (!isAllowed(state, cmd)) throw new DomainError("forbidden", `${cmd.type} requires adult PIN`);
  const s: Snapshot = structuredClone(state);
  s.rev = state.rev + 1;

  switch (cmd.type) {
    case "task.complete": {
      const task = s.tasks.find((t) => t.id === cmd.taskId);
      if (!task) throw new DomainError("not_found", "task");
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
      s.tasks.push(cmd.task);
      break;
    case "task.delete":
      s.tasks = s.tasks.filter((t) => t.id !== cmd.taskId);
      break;
    case "event.add":
      s.events.push(cmd.event);
      break;
    case "event.delete":
      s.events = s.events.filter((e) => e.id !== cmd.eventId);
      break;
    case "list.add":
      s.lists.push(cmd.list);
      break;
    case "item.add":
      if (!s.lists.some((l) => l.id === cmd.item.listId)) throw new DomainError("not_found", "list");
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
      s.rewards.push(cmd.reward);
      break;
    case "reward.request": {
      const reward = s.rewards.find((r) => r.id === cmd.rewardId);
      if (!reward) throw new DomainError("not_found", "reward");
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
  const hidden = new Set(state.lists.filter((l) => l.hidden).map((l) => l.id));
  return {
    ...state,
    lists: state.lists.filter((l) => !hidden.has(l.id)),
    items: state.items.filter((i) => !hidden.has(i.listId)),
  };
}
