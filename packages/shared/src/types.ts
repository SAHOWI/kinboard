import { z } from "zod";

/* ───────────── Entities ───────────── */

export const Role = z.enum(["adult", "child"]);
export type Role = z.infer<typeof Role>;

export const Member = z.object({
  id: z.string(),
  name: z.string().min(1),
  role: Role,
  color: z.string(),
  emoji: z.string(),
});
export type Member = z.infer<typeof Member>;

export const Household = z.object({
  id: z.string(),
  name: z.string(),
  timezone: z.string(),
  locale: z.string(),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
});
export type Household = z.infer<typeof Household>;

export const CalendarEvent = z.object({
  id: z.string(),
  title: z.string().min(1),
  start: z.string(), // ISO date-time (or YYYY-MM-DD for all-day)
  end: z.string(),
  allDay: z.boolean().default(false),
  memberIds: z.array(z.string()),
  location: z.string().optional(),
  rrule: z.string().optional(), // RFC 5545 RRULE body, e.g. "FREQ=WEEKLY;BYDAY=TU"
  source: z.enum(["local", "ics", "caldav", "google", "msgraph"]).default("local"),
});
export type CalendarEvent = z.infer<typeof CalendarEvent>;

export const Routine = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  from: z.string(), // "HH:mm"
  to: z.string(),
});
export type Routine = z.infer<typeof Routine>;

export const Task = z.object({
  id: z.string(),
  title: z.string().min(1),
  icon: z.string(),
  memberIds: z.array(z.string()),
  points: z.number().int().min(0),
  routineId: z.string().optional(),
  /** Weekdays the task repeats on (0=Sun … 6=Sat). Empty → one-off on `date`. */
  days: z.array(z.number().int().min(0).max(6)),
  date: z.string().optional(), // YYYY-MM-DD for one-off tasks
});
export type Task = z.infer<typeof Task>;

export const Completion = z.object({
  taskId: z.string(),
  memberId: z.string(),
  date: z.string(), // occurrence date YYYY-MM-DD
  at: z.string(),
});
export type Completion = z.infer<typeof Completion>;

export const Reward = z.object({
  id: z.string(),
  title: z.string(),
  icon: z.string(),
  cost: z.number().int().positive(),
});
export type Reward = z.infer<typeof Reward>;

export const Redemption = z.object({
  id: z.string(),
  rewardId: z.string(),
  memberId: z.string(),
  status: z.enum(["requested", "approved", "rejected"]),
  at: z.string(),
});
export type Redemption = z.infer<typeof Redemption>;

export const LedgerEntry = z.object({
  id: z.string(),
  memberId: z.string(),
  delta: z.number().int(),
  reason: z.enum(["task", "redeem", "adjust"]),
  refId: z.string(),
  at: z.string(),
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

export const List = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  kind: z.enum(["shopping", "todo", "packing", "generic"]),
  /** Hidden lists are only visible to `visibleTo` and never on the shared display. */
  hidden: z.boolean().default(false),
  visibleTo: z.array(z.string()).default([]),
});
export type List = z.infer<typeof List>;

export const ListItem = z.object({
  id: z.string(),
  listId: z.string(),
  text: z.string().min(1),
  checked: z.boolean(),
  sort: z.number(),
});
export type ListItem = z.infer<typeof ListItem>;

export const Meal = z.object({
  id: z.string(),
  date: z.string(),
  slot: z.enum(["breakfast", "lunch", "dinner"]),
  title: z.string(),
  icon: z.string(),
});
export type Meal = z.infer<typeof Meal>;

export const Snapshot = z.object({
  rev: z.number().int(),
  household: Household,
  members: z.array(Member),
  events: z.array(CalendarEvent),
  routines: z.array(Routine),
  tasks: z.array(Task),
  completions: z.array(Completion),
  rewards: z.array(Reward),
  redemptions: z.array(Redemption),
  ledger: z.array(LedgerEntry),
  lists: z.array(List),
  items: z.array(ListItem),
  meals: z.array(Meal),
});
export type Snapshot = z.infer<typeof Snapshot>;

/* ───────────── Commands (the only way state changes) ───────────── */

export const Actor = z.object({
  memberId: z.string().nullable(), // null = shared display, nobody selected
  /** True when an adult PIN was verified (display) or an adult is signed in (app). */
  elevated: z.boolean(),
  device: z.enum(["display", "app"]),
});
export type Actor = z.infer<typeof Actor>;

const base = { id: z.string(), at: z.string(), actor: Actor };

export const Command = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("task.complete"),
    taskId: z.string(),
    memberId: z.string(),
    date: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("task.uncomplete"),
    taskId: z.string(),
    memberId: z.string(),
    date: z.string(),
  }),
  z.object({ ...base, type: z.literal("task.add"), task: Task }),
  z.object({ ...base, type: z.literal("task.delete"), taskId: z.string() }),
  z.object({ ...base, type: z.literal("event.add"), event: CalendarEvent }),
  z.object({ ...base, type: z.literal("event.delete"), eventId: z.string() }),
  z.object({ ...base, type: z.literal("list.add"), list: List }),
  z.object({ ...base, type: z.literal("item.add"), item: ListItem }),
  /** Sets (not flips) the checked state, so replaying queued offline commands converges (FR-LST-05). */
  z.object({ ...base, type: z.literal("item.check"), itemId: z.string(), checked: z.boolean() }),
  z.object({ ...base, type: z.literal("item.remove"), itemId: z.string() }),
  z.object({ ...base, type: z.literal("reward.add"), reward: Reward }),
  z.object({
    ...base,
    type: z.literal("reward.request"),
    redemptionId: z.string(),
    rewardId: z.string(),
    memberId: z.string(),
  }),
  z.object({ ...base, type: z.literal("reward.decide"), redemptionId: z.string(), approve: z.boolean() }),
  z.object({ ...base, type: z.literal("meal.set"), meal: Meal }),
]);
export type Command = z.infer<typeof Command>;
export type CommandType = Command["type"];

/** Distributive Omit so each union member keeps its own fields. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CommandInput = DistributiveOmit<Command, "id" | "at" | "actor">;
