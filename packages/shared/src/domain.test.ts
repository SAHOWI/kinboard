import { describe, expect, it } from "vitest";
import {
  type Actor,
  type Command,
  type CommandInput,
  DomainError,
  applyCommand,
  balanceOf,
  createSeed,
  dateKey,
  memberProgress,
  occurrences,
  projectForDisplay,
} from "./index.ts";

const NOW = new Date(2026, 10, 25, 7, 30); // Wed 25 Nov 2026
const child: Actor = { memberId: "m_mia", elevated: false, device: "display" };
const parent: Actor = { memberId: "m_anna", elevated: true, device: "app" };
let n = 0;
const cmd = (input: CommandInput, actor: Actor = child): Command =>
  ({ ...input, id: `c${++n}`, at: NOW.toISOString(), actor }) as Command;

describe("tasks & points", () => {
  it("completing a task credits points once (idempotent)", () => {
    const s0 = createSeed(NOW);
    const c = cmd({ type: "task.complete", taskId: "t_teeth_am", memberId: "m_mia", date: dateKey(NOW) });
    const s1 = applyCommand(s0, c);
    const s2 = applyCommand(s1, { ...c, id: "other" });
    expect(balanceOf(s1, "m_mia")).toBe(100);
    expect(balanceOf(s2, "m_mia")).toBe(100);
    expect(memberProgress(s1, "m_mia", NOW).done).toBe(1);
  });

  it("uncomplete reverses the points", () => {
    const s0 = createSeed(NOW);
    const args = { taskId: "t_teeth_am", memberId: "m_mia", date: dateKey(NOW) };
    const s1 = applyCommand(s0, cmd({ type: "task.complete", ...args }));
    const s2 = applyCommand(s1, cmd({ type: "task.uncomplete", ...args }));
    expect(balanceOf(s2, "m_mia")).toBe(95);
  });
});

describe("permissions (child mode)", () => {
  it("children cannot delete events without the PIN", () => {
    const s0 = createSeed(NOW);
    expect(() => applyCommand(s0, cmd({ type: "event.delete", eventId: "e_dentist" }))).toThrow(DomainError);
    expect(applyCommand(s0, cmd({ type: "event.delete", eventId: "e_dentist" }, parent)).events).toHaveLength(
      s0.events.length - 1,
    );
  });

  it("children cannot toggle items on hidden lists", () => {
    const s0 = createSeed(NOW);
    expect(() => applyCommand(s0, cmd({ type: "item.toggle", itemId: "i_g0" }))).toThrow(DomainError);
  });

  it("display projection strips hidden lists", () => {
    const p = projectForDisplay(createSeed(NOW));
    expect(p.lists.some((l) => l.hidden)).toBe(false);
    expect(p.items.some((i) => i.listId === "l_gifts")).toBe(false);
  });
});

describe("rewards", () => {
  it("request + approve deducts points; insufficient balance is rejected", () => {
    let s = createSeed(NOW);
    s = applyCommand(
      s,
      cmd({ type: "reward.request", redemptionId: "rd1", rewardId: "rw_movie", memberId: "m_mia" }),
    );
    expect(() =>
      applyCommand(
        s,
        cmd({ type: "reward.request", redemptionId: "rd2", rewardId: "rw_icecream", memberId: "m_mia" }),
      ),
    ).toThrow(/not enough points/);
    s = applyCommand(s, cmd({ type: "reward.decide", redemptionId: "rd1", approve: true }, parent));
    expect(balanceOf(s, "m_mia")).toBe(35);
  });
});

describe("recurrence", () => {
  it("expands weekly school events Mon–Fri only", () => {
    const s = createSeed(NOW);
    const mon = new Date(2026, 10, 23);
    const nextMon = new Date(2026, 10, 30);
    const school = occurrences(s.events, mon, nextMon).filter((o) => o.event.id === "e_school");
    expect(school).toHaveLength(5);
    expect(school[0].start.getHours()).toBe(8);
  });
});
