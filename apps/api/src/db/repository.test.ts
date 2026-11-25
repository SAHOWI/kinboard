import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Actor,
  type Command,
  type CommandInput,
  DomainError,
  type Snapshot,
  createSeed,
  dateKey,
} from "@kinboard/shared";
import { afterAll, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../repository.ts";
import { type DbHandle, openPglite, openPostgres } from "./client.ts";
import { DrizzleRepository } from "./repository.ts";

const NOW = new Date(2026, 10, 25, 7, 30); // Wed 25 Nov 2026
const HH = "hh_1";
const seed = () => createSeed(NOW);
const child: Actor = { memberId: null, elevated: false, device: "display" };
const parent: Actor = { memberId: "m_anna", elevated: true, device: "app" };
let n = 0;
const cmd = (input: CommandInput, actor: Actor = parent): Command =>
  ({ ...input, id: `c${++n}`, at: NOW.toISOString(), actor }) as Command;

/** A run touching every collection, including deletes, join tables and meal-slot replacement. */
const script = (): Command[] => [
  cmd({ type: "task.complete", taskId: "t_teeth_am", memberId: "m_mia", date: dateKey(NOW) }, child),
  cmd({ type: "task.complete", taskId: "t_bed", memberId: "m_mia", date: dateKey(NOW) }, child),
  cmd({ type: "task.uncomplete", taskId: "t_bed", memberId: "m_mia", date: dateKey(NOW) }, child),
  cmd({ type: "item.add", item: { id: "i_new", listId: "l_shop", text: "Oats", checked: false, sort: 9.5 } }),
  cmd({ type: "item.toggle", itemId: "i_new" }, child),
  cmd({ type: "item.remove", itemId: "i_new" }),
  cmd({
    type: "event.add",
    event: {
      id: "e_new",
      title: "Swim",
      start: "2026-11-26T17:00",
      end: "2026-11-26T18:00",
      allDay: false,
      memberIds: ["m_ben", "m_mia"],
      rrule: "FREQ=WEEKLY;BYDAY=TH",
      source: "local",
    },
  }),
  cmd({ type: "event.delete", eventId: "e_dentist" }),
  cmd({
    type: "task.add",
    task: { id: "t_new", title: "Feed cat", icon: "🐈", memberIds: ["m_ben"], points: 3, days: [1, 3] },
  }),
  cmd({ type: "task.delete", taskId: "t_bed" }),
  cmd({ type: "reward.add", reward: { id: "rw_new", title: "Zoo", icon: "🦁", cost: 50 } }),
  cmd({ type: "reward.request", redemptionId: "rd1", rewardId: "rw_movie", memberId: "m_mia" }, child),
  cmd({ type: "reward.decide", redemptionId: "rd1", approve: true }),
  cmd({
    type: "meal.set",
    meal: { id: "ml_a", date: dateKey(NOW), slot: "dinner", title: "Soup", icon: "🥣" },
  }),
  cmd({
    type: "meal.set",
    meal: { id: "ml_b", date: dateKey(NOW), slot: "dinner", title: "Pizza", icon: "🍕" },
  }),
  cmd({
    type: "list.add",
    list: {
      id: "l_secret",
      name: "Surprise",
      icon: "🎁",
      kind: "generic",
      hidden: true,
      visibleTo: ["m_tom", "m_anna"],
    },
  }),
];

/** Meal order may differ (meal.set moves a slot to the end in memory); everything else must match exactly. */
const normalise = (s: Snapshot) => ({ ...s, meals: [...s.meals].sort((a, b) => a.id.localeCompare(b.id)) });

const backends: [string, () => Promise<DbHandle>][] = [["PGlite", () => openPglite()]];
if (process.env.DATABASE_URL_TEST)
  backends.push(["PostgreSQL", () => openPostgres(process.env.DATABASE_URL_TEST as string, { reset: true })]);

describe.each(backends)("DrizzleRepository on %s", (_name, open) => {
  const handles: DbHandle[] = [];
  const fresh = async () => {
    const h = await open();
    handles.push(h);
    const repo = new DrizzleRepository(h.db);
    await repo.seed(seed());
    return repo;
  };
  afterAll(async () => {
    for (const h of handles) await h.close();
  });

  it("loads the seed exactly as stored", async () => {
    const repo = await fresh();
    expect(normalise(await repo.snapshot(HH))).toEqual(normalise(seed()));
    expect(await repo.seed(seed())).toBe(false); // seeding is a no-op once the household exists
  });

  it("produces the same state as the in-memory repository for every command type", async () => {
    const repo = await fresh();
    const memory = new InMemoryRepository(seed);
    for (const c of script()) {
      const [a, b] = [await repo.apply(HH, c), await memory.apply(HH, c)];
      expect(a.state.rev).toBe(b.state.rev);
    }
    const stored = await repo.snapshot(HH);
    expect(normalise(stored)).toEqual(normalise(await memory.snapshot(HH)));
    expect(normalise(await new DrizzleRepository(repo.db).snapshot(HH))).toEqual(normalise(stored));
  });

  it("is idempotent by command id", async () => {
    const repo = await fresh();
    const c = cmd({ type: "item.toggle", itemId: "i_s0" }, child);
    const first = await repo.apply(HH, c);
    const again = await repo.apply(HH, c);
    expect(first.replay).toBe(false);
    expect(again.replay).toBe(true);
    expect(again.state.rev).toBe(first.state.rev);
    expect(again.state.items.find((i) => i.id === "i_s0")?.checked).toBe(
      first.state.items.find((i) => i.id === "i_s0")?.checked,
    );
  });

  it("rolls back rejected commands and lets the same id be retried", async () => {
    const repo = await fresh();
    const before = await repo.snapshot(HH);
    const forbidden = cmd({ type: "event.delete", eventId: "e_dentist" }, child);
    await expect(repo.apply(HH, forbidden)).rejects.toBeInstanceOf(DomainError);
    expect(await repo.snapshot(HH)).toEqual(before);
    const retried = await repo.apply(HH, { ...forbidden, actor: parent });
    expect(retried.replay).toBe(false);
  });

  it("serialises concurrent commands without lost updates", async () => {
    const repo = await fresh();
    const { rev } = await repo.snapshot(HH);
    const adds = Array.from({ length: 20 }, (_, i) =>
      cmd({
        type: "item.add",
        item: { id: `i_c${i}`, listId: "l_shop", text: `C${i}`, checked: false, sort: i },
      }),
    );
    await Promise.all(adds.map((c) => repo.apply(HH, c)));
    const after = await repo.snapshot(HH);
    expect(after.rev).toBe(rev + 20);
    expect(after.items.filter((i) => i.id.startsWith("i_c"))).toHaveLength(20);
  });

  it("writes one change_log row per changed entity", async () => {
    const repo = await fresh();
    const { state } = await repo.apply(HH, cmd({ type: "item.toggle", itemId: "i_s0" }, child));
    await repo.apply(HH, cmd({ type: "item.remove", itemId: "i_s0" }));
    const log = await repo.changesSince(HH, state.rev - 1);
    expect(log.map((r) => [r.rev, r.entity, r.entityId, r.op])).toEqual([
      [state.rev, "list_item", "i_s0", "upsert"],
      [state.rev + 1, "list_item", "i_s0", "delete"],
    ]);
  });

  it("prunes old idempotency receipts", async () => {
    const repo = await fresh();
    const c = cmd({ type: "item.toggle", itemId: "i_s0" }, child);
    await repo.apply(HH, c);
    expect(await repo.pruneReceipts(new Date(Date.now() + 8 * 86_400_000))).toBeGreaterThan(0);
    expect((await repo.apply(HH, c)).replay).toBe(false);
  });
});

describe("persistence across restarts (gap #4)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kinboard-pglite-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps applied commands after the database is closed and reopened", async () => {
    const first = await openPglite(dir);
    const repo = new DrizzleRepository(first.db);
    await repo.seed(seed());
    const { state } = await repo.apply(HH, cmd({ type: "item.toggle", itemId: "i_s0" }, child));
    await first.close();

    const second = await openPglite(dir);
    const reopened = await new DrizzleRepository(second.db).snapshot(HH);
    await second.close();
    expect(reopened.rev).toBe(state.rev);
    expect(reopened.items.find((i) => i.id === "i_s0")?.checked).toBe(
      state.items.find((i) => i.id === "i_s0")?.checked,
    );
  });
});
