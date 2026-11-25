import {
  type Command,
  type EntityName,
  type Snapshot,
  type StoredChange,
  applyCommand,
  diffSnapshots,
} from "@kinboard/shared";
import { type SQL, and, asc, eq, getTableColumns, gt, inArray, lt, or, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Applied, PinAttempts, Repository } from "../repository.ts";
import type { Db } from "./client.ts";
import * as t from "./schema.ts";

const RECEIPT_TTL_MS = 7 * 86_400_000;

type Row = Record<string, unknown>;
type Entity = { id: string } | Snapshot["completions"][number];

/** How one domain collection maps onto a table (plus an optional join table for an id array). */
interface Collection<E extends Entity> {
  entity: Exclude<EntityName, "household">;
  table: PgTable & { householdId: PgColumn; ord: PgColumn };
  /** Columns identifying a row within the household. */
  keyCols: PgColumn[];
  keyValues(e: E): unknown[];
  toRow(e: E): Row;
  join?: {
    table: PgTable & { householdId: PgColumn; pos: PgColumn };
    parentCol: PgColumn;
    pick(e: E): string[];
    row(parentId: string, memberId: string, pos: number): Row;
  };
}

const byId = <E extends { id: string }>(c: Omit<Collection<E>, "keyValues">): Collection<E> => ({
  ...c,
  keyValues: (e) => [e.id],
});

const collections = [
  byId<Snapshot["members"][number]>({
    entity: "member",
    table: t.member,
    keyCols: [t.member.id],
    toRow: (m) => ({ id: m.id, name: m.name, role: m.role, color: m.color, emoji: m.emoji }),
  }),
  byId<Snapshot["events"][number]>({
    entity: "event",
    table: t.event,
    keyCols: [t.event.id],
    toRow: (e) => ({
      id: e.id,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      location: e.location ?? null,
      rrule: e.rrule ?? null,
      source: e.source,
    }),
    join: {
      table: t.eventAssignee,
      parentCol: t.eventAssignee.eventId,
      pick: (e) => e.memberIds,
      row: (eventId, memberId, pos) => ({ eventId, memberId, pos }),
    },
  }),
  byId<Snapshot["routines"][number]>({
    entity: "routine",
    table: t.routine,
    keyCols: [t.routine.id],
    toRow: (r) => ({ id: r.id, name: r.name, icon: r.icon, windowStart: r.from, windowEnd: r.to }),
  }),
  byId<Snapshot["tasks"][number]>({
    entity: "task",
    table: t.task,
    keyCols: [t.task.id],
    toRow: (k) => ({
      id: k.id,
      title: k.title,
      icon: k.icon,
      points: k.points,
      routineId: k.routineId ?? null,
      days: k.days,
      date: k.date ?? null,
    }),
    join: {
      table: t.taskAssignee,
      parentCol: t.taskAssignee.taskId,
      pick: (k) => k.memberIds,
      row: (taskId, memberId, pos) => ({ taskId, memberId, pos }),
    },
  }),
  {
    entity: "task_completion",
    table: t.taskCompletion,
    keyCols: [t.taskCompletion.taskId, t.taskCompletion.memberId, t.taskCompletion.occurrenceDate],
    keyValues: (c) => [c.taskId, c.memberId, c.date],
    toRow: (c) => ({ taskId: c.taskId, memberId: c.memberId, occurrenceDate: c.date, completedAt: c.at }),
  } satisfies Collection<Snapshot["completions"][number]>,
  byId<Snapshot["rewards"][number]>({
    entity: "reward",
    table: t.reward,
    keyCols: [t.reward.id],
    toRow: (r) => ({ id: r.id, title: r.title, icon: r.icon, cost: r.cost }),
  }),
  byId<Snapshot["redemptions"][number]>({
    entity: "reward_redemption",
    table: t.rewardRedemption,
    keyCols: [t.rewardRedemption.id],
    toRow: (r) => ({
      id: r.id,
      rewardId: r.rewardId,
      memberId: r.memberId,
      status: r.status,
      requestedAt: r.at,
    }),
  }),
  byId<Snapshot["ledger"][number]>({
    entity: "points_ledger",
    table: t.pointsLedger,
    keyCols: [t.pointsLedger.id],
    toRow: (l) => ({
      id: l.id,
      memberId: l.memberId,
      delta: l.delta,
      reason: l.reason,
      refId: l.refId,
      at: l.at,
    }),
  }),
  byId<Snapshot["lists"][number]>({
    entity: "list",
    table: t.list,
    keyCols: [t.list.id],
    toRow: (l) => ({ id: l.id, name: l.name, icon: l.icon, kind: l.kind, hidden: l.hidden }),
    join: {
      table: t.listVisibility,
      parentCol: t.listVisibility.listId,
      pick: (l) => l.visibleTo,
      row: (listId, memberId, pos) => ({ listId, memberId, pos }),
    },
  }),
  byId<Snapshot["items"][number]>({
    entity: "list_item",
    table: t.listItem,
    keyCols: [t.listItem.id],
    toRow: (i) => ({ id: i.id, listId: i.listId, text: i.text, checked: i.checked, sort: i.sort }),
  }),
  byId<Snapshot["meals"][number]>({
    entity: "meal",
    table: t.meal,
    keyCols: [t.meal.id],
    toRow: (m) => ({ id: m.id, date: m.date, slot: m.slot, title: m.title, icon: m.icon }),
  }),
] as unknown as Collection<Entity>[];

const specs = new Map<string, Collection<Entity>>(collections.map((c) => [c.entity, c]));

const omitNull = <T extends Row>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as T;

const EMPTY: Omit<Snapshot, "rev" | "household"> = {
  members: [],
  events: [],
  routines: [],
  tasks: [],
  completions: [],
  rewards: [],
  redemptions: [],
  ledger: [],
  lists: [],
  items: [],
  meals: [],
};

/**
 * PostgreSQL persistence (gap #4). Each command is one transaction: lock the household row, check the
 * idempotency receipt, load the snapshot, run the shared reducer, then write only the rows that changed,
 * one change_log row per changed entity, the new household rev and the receipt.
 */
export class DrizzleRepository implements Repository {
  constructor(readonly db: Db) {}

  /** Inserts `seed` if its household does not exist yet. Returns whether it did. */
  async seed(seed: Snapshot): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const h = seed.household;
      const inserted = await tx
        .insert(t.household)
        .values({
          id: h.id,
          name: h.name,
          timezone: h.timezone,
          locale: h.locale,
          weekStartsOn: h.weekStartsOn,
          rev: seed.rev,
          historyFromRev: seed.rev,
        })
        .onConflictDoNothing()
        .returning({ id: t.household.id });
      if (!inserted.length) return false;
      await this.write(
        tx,
        h.id,
        diffSnapshots({ ...EMPTY, rev: seed.rev, household: h }, seed),
        seed.rev,
        false,
      );
      return true;
    });
  }

  async snapshot(householdId: string): Promise<Snapshot> {
    return this.load(this.db, householdId);
  }

  async apply(householdId: string, cmd: Command): Promise<Applied> {
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: t.household.id })
        .from(t.household)
        .where(eq(t.household.id, householdId))
        .for("update");
      if (!locked) throw new Error(`household ${householdId} not found`);
      const prev = await this.load(tx, householdId);
      const [receipt] = await tx
        .select({ rev: t.commandReceipt.rev })
        .from(t.commandReceipt)
        .where(and(eq(t.commandReceipt.householdId, householdId), eq(t.commandReceipt.commandId, cmd.id)));
      if (receipt) return { state: prev, fromRev: prev.rev, replay: true, changes: [] };

      const next = applyCommand(prev, cmd); // throws DomainError → the transaction rolls back
      const changes = diffSnapshots(prev, next);
      await this.write(tx, householdId, changes, next.rev, true);
      if (next.rev !== prev.rev)
        await tx.update(t.household).set({ rev: next.rev }).where(eq(t.household.id, householdId));
      await tx.insert(t.commandReceipt).values({ householdId, commandId: cmd.id, rev: next.rev });
      return { state: next, fromRev: prev.rev, replay: false, changes };
    });
  }

  /** Changes after `since`, in order, or null when change_log does not reach back that far (spec §5.3). */
  async changesSince(householdId: string, since: number) {
    const [h] = await this.db
      .select({ rev: t.household.rev, historyFromRev: t.household.historyFromRev })
      .from(t.household)
      .where(eq(t.household.id, householdId));
    if (!h || since > h.rev || since < h.historyFromRev) return null;
    const rows = await this.db
      .select()
      .from(t.changeLog)
      .where(and(eq(t.changeLog.householdId, householdId), gt(t.changeLog.rev, since)))
      .orderBy(asc(t.changeLog.rev), asc(t.changeLog.seq));
    const changes: StoredChange[] = rows.map((r) => ({
      entity: r.entity as EntityName,
      id: r.entityId,
      op: r.op,
      ...(r.op === "delete" ? { prev: r.payload } : { data: r.payload }),
    }));
    return { rev: h.rev, changes };
  }

  async getPinHash(householdId: string): Promise<string | null> {
    const [h] = await this.db
      .select({ pinHash: t.household.pinHash })
      .from(t.household)
      .where(eq(t.household.id, householdId));
    return h?.pinHash ?? null;
  }

  async setPinHash(householdId: string, hash: string): Promise<void> {
    await this.db.update(t.household).set({ pinHash: hash }).where(eq(t.household.id, householdId));
  }

  async getPinAttempts(householdId: string, scope: string): Promise<PinAttempts | null> {
    const [a] = await this.db
      .select()
      .from(t.pinAttempt)
      .where(and(eq(t.pinAttempt.householdId, householdId), eq(t.pinAttempt.scope, scope)));
    if (!a) return null;
    return {
      failures: a.failures,
      windowStart: a.windowStart.getTime(),
      lockedUntil: a.lockedUntil?.getTime() ?? 0,
    };
  }

  async setPinAttempts(householdId: string, scope: string, attempts: PinAttempts | null): Promise<void> {
    if (!attempts) {
      await this.db
        .delete(t.pinAttempt)
        .where(and(eq(t.pinAttempt.householdId, householdId), eq(t.pinAttempt.scope, scope)));
      return;
    }
    const row = {
      failures: attempts.failures,
      windowStart: new Date(attempts.windowStart),
      lockedUntil: attempts.lockedUntil ? new Date(attempts.lockedUntil) : null,
    };
    await this.db
      .insert(t.pinAttempt)
      .values({ householdId, scope, ...row })
      .onConflictDoUpdate({ target: [t.pinAttempt.householdId, t.pinAttempt.scope], set: row });
  }

  /** Deletes idempotency receipts older than 7 days before `now`. Returns how many. */
  async pruneReceipts(now = new Date()): Promise<number> {
    const deleted = await this.db
      .delete(t.commandReceipt)
      .where(lt(t.commandReceipt.appliedAt, new Date(now.getTime() - RECEIPT_TTL_MS)))
      .returning({ id: t.commandReceipt.commandId });
    return deleted.length;
  }

  private async load(db: Db, householdId: string): Promise<Snapshot> {
    const [h] = await db.select().from(t.household).where(eq(t.household.id, householdId));
    if (!h) throw new Error(`household ${householdId} not found`);
    const rows = (table: PgTable & { householdId: PgColumn }, order: PgColumn) =>
      db.select().from(table).where(eq(table.householdId, householdId)).orderBy(asc(order)) as Promise<Row[]>;
    const ids = (r: Row[], parent: string) => {
      const m = new Map<string, string[]>();
      for (const x of r)
        m.set(x[parent] as string, [...(m.get(x[parent] as string) ?? []), x.memberId as string]);
      return m;
    };
    const [members, events, eventAssignees, routines, tasks, taskAssignees, completions, rewards] =
      await Promise.all([
        rows(t.member, t.member.ord),
        rows(t.event, t.event.ord),
        rows(t.eventAssignee, t.eventAssignee.pos),
        rows(t.routine, t.routine.ord),
        rows(t.task, t.task.ord),
        rows(t.taskAssignee, t.taskAssignee.pos),
        rows(t.taskCompletion, t.taskCompletion.ord),
        rows(t.reward, t.reward.ord),
      ]);
    const [redemptions, ledger, lists, visibility, items, meals] = await Promise.all([
      rows(t.rewardRedemption, t.rewardRedemption.ord),
      rows(t.pointsLedger, t.pointsLedger.ord),
      rows(t.list, t.list.ord),
      rows(t.listVisibility, t.listVisibility.pos),
      rows(t.listItem, t.listItem.ord),
      rows(t.meal, t.meal.ord),
    ]);
    const eventMembers = ids(eventAssignees, "eventId");
    const taskMembers = ids(taskAssignees, "taskId");
    const listMembers = ids(visibility, "listId");
    const strip = ({ householdId: _h, ord: _o, ...rest }: Row) => rest;

    return {
      rev: h.rev,
      household: {
        id: h.id,
        name: h.name,
        timezone: h.timezone,
        locale: h.locale,
        weekStartsOn: h.weekStartsOn as 0 | 1,
      },
      members: members.map(strip) as Snapshot["members"],
      events: events.map((e) =>
        omitNull({ ...strip(e), memberIds: eventMembers.get(e.id as string) ?? [] }),
      ) as Snapshot["events"],
      routines: routines.map(({ windowStart, windowEnd, ...r }) => ({
        ...strip(r),
        from: windowStart,
        to: windowEnd,
      })) as Snapshot["routines"],
      tasks: tasks.map((k) =>
        omitNull({ ...strip(k), memberIds: taskMembers.get(k.id as string) ?? [] }),
      ) as Snapshot["tasks"],
      completions: completions.map((c) => ({
        taskId: c.taskId,
        memberId: c.memberId,
        date: c.occurrenceDate,
        at: c.completedAt,
      })) as Snapshot["completions"],
      rewards: rewards.map(strip) as Snapshot["rewards"],
      redemptions: redemptions.map(({ requestedAt, ...r }) => ({
        ...strip(r),
        at: requestedAt,
      })) as Snapshot["redemptions"],
      ledger: ledger.map(strip) as Snapshot["ledger"],
      lists: lists.map((l) => ({
        ...strip(l),
        visibleTo: listMembers.get(l.id as string) ?? [],
      })) as Snapshot["lists"],
      items: items.map(strip) as Snapshot["items"],
      meals: meals.map(strip) as Snapshot["meals"],
    };
  }

  /** Persists changes from `diffSnapshots`: deletes first, then upserts that keep each row's `ord`. */
  private async write(db: Db, householdId: string, changes: StoredChange[], rev: number, log: boolean) {
    const group = (op: StoredChange["op"]) => {
      const m = new Map<string, StoredChange[]>();
      for (const ch of changes) if (ch.op === op) m.set(ch.entity, [...(m.get(ch.entity) ?? []), ch]);
      return m;
    };
    for (const [entity, removed] of group("delete")) {
      const c = specs.get(entity);
      if (!c) continue;
      const match = removed.map(
        (ch) => and(...c.keyCols.map((col, i) => eq(col, c.keyValues(ch.prev as Entity)[i]))) as SQL,
      );
      await db.delete(c.table).where(and(eq(c.table.householdId, householdId), or(...match)));
    }
    for (const [entity, changed] of group("upsert")) {
      if (entity === "household") {
        const h = changed[0].data as Snapshot["household"];
        await db
          .update(t.household)
          .set({ name: h.name, timezone: h.timezone, locale: h.locale, weekStartsOn: h.weekStartsOn })
          .where(eq(t.household.id, householdId));
        continue;
      }
      const c = specs.get(entity);
      if (!c) continue;
      const entities = changed.map((ch) => ch.data as Entity);
      const values = entities.map((e) => ({ householdId, ...c.toRow(e) }));
      const cols = getTableColumns(c.table) as Record<string, PgColumn>;
      const keyNames = new Set(["householdId", ...c.keyCols.map((k) => k.name)]);
      const update = Object.fromEntries(
        Object.keys(values[0])
          .filter((k) => !keyNames.has(k) && !keyNames.has(cols[k].name))
          .map((k) => [k, sql.raw(`excluded."${cols[k].name}"`)]),
      );
      await db
        .insert(c.table)
        .values(values as never)
        .onConflictDoUpdate({ target: [c.table.householdId, ...c.keyCols], set: update as never });

      if (c.join) {
        const j = c.join;
        const parents = changed.map((ch) => ch.id);
        await db
          .delete(j.table)
          .where(and(eq(j.table.householdId, householdId), inArray(j.parentCol, parents)));
        const joinRows = changed.flatMap((ch, k) =>
          j.pick(entities[k]).map((memberId, pos) => ({ householdId, ...j.row(ch.id, memberId, pos) })),
        );
        if (joinRows.length) await db.insert(j.table).values(joinRows as never);
      }
    }
    if (log && changes.length)
      await db.insert(t.changeLog).values(
        changes.map((ch) => ({
          householdId,
          rev,
          entity: ch.entity,
          entityId: ch.id,
          op: ch.op,
          payload: ch.op === "delete" ? ch.prev : ch.data, // the removed entity stays server-side
        })),
      );
  }
}
