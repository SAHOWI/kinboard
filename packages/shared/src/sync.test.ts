import { describe, expect, it } from "vitest";
import {
  type Actor,
  type Command,
  type CommandInput,
  type Snapshot,
  applyChanges,
  applyCommand,
  createSeed,
  dateKey,
  diffSnapshots,
  projectChanges,
} from "./index.ts";

const NOW = new Date(2026, 10, 25, 7, 30); // Wed 25 Nov 2026
const child: Actor = { memberId: null, elevated: false, device: "display" };
const anna: Actor = { memberId: "m_anna", elevated: true, device: "app" };
let n = 0;
const cmd = (input: CommandInput, actor: Actor = anna): Command =>
  ({ ...input, id: `c${++n}`, at: NOW.toISOString(), actor }) as Command;
const today = dateKey(NOW);

const script: Command[] = [
  cmd({ type: "task.complete", taskId: "t_teeth_am", memberId: "m_mia", date: today }, child),
  cmd({ type: "task.uncomplete", taskId: "t_teeth_am", memberId: "m_mia", date: today }, child),
  cmd({ type: "item.add", item: { id: "i_n", listId: "l_shop", text: "Oats", checked: false, sort: 9 } }),
  cmd({ type: "item.check", itemId: "i_n", checked: true }, child),
  cmd({ type: "item.remove", itemId: "i_n" }),
  cmd({
    type: "event.add",
    event: {
      id: "e_n",
      title: "Swim",
      start: "2026-11-26T17:00",
      end: "2026-11-26T18:00",
      allDay: false,
      memberIds: ["m_ben"],
      source: "local",
    },
  }),
  cmd({ type: "event.delete", eventId: "e_dentist" }),
  cmd({
    type: "task.add",
    task: { id: "t_n", title: "Cat", icon: "🐈", memberIds: ["m_ben"], points: 3, days: [1] },
  }),
  cmd({ type: "task.delete", taskId: "t_bed" }),
  cmd({ type: "reward.add", reward: { id: "rw_n", title: "Zoo", icon: "🦁", cost: 50 } }),
  cmd({ type: "reward.request", redemptionId: "rd1", rewardId: "rw_movie", memberId: "m_mia" }, child),
  cmd({ type: "reward.decide", redemptionId: "rd1", approve: true }),
  cmd({ type: "meal.set", meal: { id: "ml_b", date: today, slot: "dinner", title: "Pizza", icon: "🍕" } }),
  cmd({
    type: "list.add",
    list: { id: "l_x", name: "X", icon: "🎁", kind: "generic", hidden: true, visibleTo: ["m_tom", "m_anna"] },
  }),
];

const normalise = (s: Snapshot) => ({ ...s, meals: [...s.meals].sort((a, b) => a.id.localeCompare(b.id)) });

describe("delta sync (spec §5.3)", () => {
  it("diff + apply reproduces every command's result", () => {
    let s = createSeed(NOW);
    for (const c of script) {
      const next = applyCommand(s, c);
      const patched = applyChanges(s, diffSnapshots(s, next), next.rev);
      expect(normalise(patched)).toEqual(normalise(next));
      s = next;
    }
  });

  it("only reports what changed, deletes first, and keeps the deleted entity server-side", () => {
    const s0 = createSeed(NOW);
    const s1 = applyCommand(s0, script[2]);
    const s2 = applyCommand(s1, cmd({ type: "item.remove", itemId: "i_n" }));
    expect(diffSnapshots(s0, s1)).toEqual([
      { entity: "list_item", id: "i_n", op: "upsert", data: s1.items.at(-1) },
    ]);
    expect(diffSnapshots(s1, s2)).toEqual([
      { entity: "list_item", id: "i_n", op: "delete", prev: s1.items.at(-1) },
    ]);
    expect(diffSnapshots(s0, s0)).toEqual([]);
  });

  it("projects changes per viewer and never sends prev", () => {
    const s0 = createSeed(NOW);
    const add = cmd({
      type: "item.add",
      item: { id: "i_g9", listId: "l_gifts", text: "Bike", checked: false, sort: 9 },
    });
    const s1 = applyCommand(s0, add);
    const s2 = applyCommand(s1, cmd({ type: "item.remove", itemId: "i_g9" }));
    const adds = diffSnapshots(s0, s1);
    const removes = diffSnapshots(s1, s2);
    expect(projectChanges(adds, s1, "m_mia")).toEqual([]);
    expect(projectChanges(adds, s1, null)).toEqual([]);
    expect(projectChanges(adds, s1, "m_tom")).toHaveLength(1);
    expect(projectChanges(removes, s2, null)).toEqual([]);
    expect(projectChanges(removes, s2, "m_tom")).toEqual([{ entity: "list_item", id: "i_g9", op: "delete" }]);

    const hiddenList = diffSnapshots(s0, applyCommand(s0, script[13]));
    expect(projectChanges(hiddenList, s0, "m_mia")).toEqual([]);
    expect(projectChanges(hiddenList, s0, "m_tom")).toHaveLength(1);
  });

  it("item.check is idempotent, so replayed offline commands converge (FR-LST-05)", () => {
    const s0 = createSeed(NOW);
    const check = cmd({ type: "item.check", itemId: "i_s0", checked: true }, child);
    const s1 = applyCommand(s0, check);
    const s2 = applyCommand(s1, { ...check, id: "replayed-from-another-device" });
    expect(s2).toBe(s1); // no change, no new revision
    expect(s1.items.find((i) => i.id === "i_s0")?.checked).toBe(true);
  });
});
