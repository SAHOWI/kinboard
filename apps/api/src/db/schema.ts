import {
  bigint,
  boolean,
  doublePrecision,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * PostgreSQL schema (spec §4.1, adapted to the current domain in packages/shared/src/types.ts).
 *
 * - Ids are the client-generated text ids the commands carry, unique per household: (household_id, id).
 * - `ord` keeps the insertion order of the domain arrays, so a loaded snapshot matches the reducer's.
 * - Only join tables reference their parent. Other cross-references (task → member, completion → task …)
 *   have no foreign key, because the reducer allows them to dangle and the database must not disagree.
 */

const householdId = () =>
  text("household_id")
    .notNull()
    .references(() => household.id, { onDelete: "cascade" });
const ord = () => bigint("ord", { mode: "number" }).generatedAlwaysAsIdentity();

export const household = pgTable("household", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  locale: text("locale").notNull(),
  weekStartsOn: smallint("week_starts_on").notNull(),
  /** Household-scoped monotonic revision; the `rev` of the snapshot. */
  rev: bigint("rev", { mode: "number" }).notNull().default(0),
  /** change_log is complete after this revision; `/sync?since` below it needs a full snapshot. */
  historyFromRev: bigint("history_from_rev", { mode: "number" }).notNull().default(0),
  /** Argon2id hash of the adult PIN (gap #2). */
  pinHash: text("pin_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const member = pgTable(
  "member",
  {
    householdId: householdId(),
    id: text("id").notNull(),
    ord: ord(),
    name: text("name").notNull(),
    role: text("role", { enum: ["adult", "child"] }).notNull(),
    color: text("color").notNull(),
    emoji: text("emoji").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.id] })],
);

export const event = pgTable(
  "event",
  {
    householdId: householdId(),
    id: text("id").notNull(),
    ord: ord(),
    title: text("title").notNull(),
    /** Floating local time as the domain stores it (ISO date-time or YYYY-MM-DD). Timezones: gap #8. */
    start: text("start").notNull(),
    end: text("end").notNull(),
    allDay: boolean("all_day").notNull(),
    location: text("location"),
    rrule: text("rrule"),
    source: text("source", { enum: ["local", "ics", "caldav", "google", "msgraph"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.id] })],
);

export const eventAssignee = pgTable(
  "event_assignee",
  {
    householdId: text("household_id").notNull(),
    eventId: text("event_id").notNull(),
    memberId: text("member_id").notNull(),
    pos: integer("pos").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.eventId, t.memberId] }),
    foreignKey({
      columns: [t.householdId, t.eventId],
      foreignColumns: [event.householdId, event.id],
    }).onDelete("cascade"),
  ],
);

export const routine = pgTable(
  "routine",
  {
    householdId: householdId(),
    id: text("id").notNull(),
    ord: ord(),
    name: text("name").notNull(),
    icon: text("icon").notNull(),
    windowStart: text("window_start").notNull(), // "HH:mm"
    windowEnd: text("window_end").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.id] })],
);

export const task = pgTable(
  "task",
  {
    householdId: householdId(),
    id: text("id").notNull(),
    ord: ord(),
    title: text("title").notNull(),
    icon: text("icon").notNull(),
    points: integer("points").notNull(),
    routineId: text("routine_id"),
    /** Weekdays the task repeats on (0 = Sunday). Empty → one-off on `date`. */
    days: smallint("days").array().notNull(),
    date: text("date"),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.id] })],
);

export const taskAssignee = pgTable(
  "task_assignee",
  {
    householdId: text("household_id").notNull(),
    taskId: text("task_id").notNull(),
    memberId: text("member_id").notNull(),
    pos: integer("pos").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.taskId, t.memberId] }),
    foreignKey({ columns: [t.householdId, t.taskId], foreignColumns: [task.householdId, task.id] }).onDelete(
      "cascade",
    ),
  ],
);

export const taskCompletion = pgTable(
  "task_completion",
  {
    householdId: householdId(),
    taskId: text("task_id").notNull(),
    memberId: text("member_id").notNull(),
    occurrenceDate: text("occurrence_date").notNull(), // YYYY-MM-DD
    ord: ord(),
    completedAt: text("completed_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.taskId, t.memberId, t.occurrenceDate] })],
);

export const reward = pgTable(
  "reward",
  {
    householdId: householdId(),
    id: text("id").notNull(),
    ord: ord(),
    title: text("title").notNull(),
    icon: text("icon").notNull(),
    cost: integer("cost").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.id] })],
);

export const rewardRedemption = pgTable(
  "reward_redemption",
  {
    householdId: householdId(),
    id: text("id").notNull(),
    ord: ord(),
    rewardId: text("reward_id").notNull(),
    memberId: text("member_id").notNull(),
    status: text("status", { enum: ["requested", "approved", "rejected"] }).notNull(),
    requestedAt: text("requested_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.id] })],
);

export const pointsLedger = pgTable(
  "points_ledger",
  {
    householdId: householdId(),
    id: text("id").notNull(),
    ord: ord(),
    memberId: text("member_id").notNull(),
    delta: integer("delta").notNull(),
    reason: text("reason", { enum: ["task", "redeem", "adjust"] }).notNull(),
    refId: text("ref_id").notNull(),
    at: text("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.id] })],
);

export const list = pgTable(
  "list",
  {
    householdId: householdId(),
    id: text("id").notNull(),
    ord: ord(),
    name: text("name").notNull(),
    icon: text("icon").notNull(),
    kind: text("kind", { enum: ["shopping", "todo", "packing", "generic"] }).notNull(),
    hidden: boolean("hidden").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.id] })],
);

export const listVisibility = pgTable(
  "list_visibility",
  {
    householdId: text("household_id").notNull(),
    listId: text("list_id").notNull(),
    memberId: text("member_id").notNull(),
    pos: integer("pos").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.listId, t.memberId] }),
    foreignKey({ columns: [t.householdId, t.listId], foreignColumns: [list.householdId, list.id] }).onDelete(
      "cascade",
    ),
  ],
);

export const listItem = pgTable(
  "list_item",
  {
    householdId: householdId(),
    id: text("id").notNull(),
    ord: ord(),
    listId: text("list_id").notNull(),
    text: text("text").notNull(),
    checked: boolean("checked").notNull(),
    sort: doublePrecision("sort").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.id] })],
);

export const meal = pgTable(
  "meal",
  {
    householdId: householdId(),
    id: text("id").notNull(),
    ord: ord(),
    date: text("date").notNull(),
    slot: text("slot", { enum: ["breakfast", "lunch", "dinner"] }).notNull(),
    title: text("title").notNull(),
    icon: text("icon").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.id] }), unique().on(t.householdId, t.date, t.slot)],
);

/** One row per entity a command changed. Powers `GET /sync?since=rev` (spec §5.3, M2 step 7). */
export const changeLog = pgTable(
  "change_log",
  {
    householdId: householdId(),
    rev: bigint("rev", { mode: "number" }).notNull(),
    /** Insertion order within a revision (deletes before upserts). */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    op: text("op", { enum: ["upsert", "delete"] }).notNull(),
    payload: jsonb("payload"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.rev, t.entity, t.entityId] })],
);

/** Idempotency keys: a replayed command id returns the stored result. Pruned after 7 days (gap #6). */
export const commandReceipt = pgTable(
  "command_receipt",
  {
    householdId: householdId(),
    commandId: text("command_id").notNull(),
    rev: bigint("rev", { mode: "number" }).notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.commandId] })],
);
