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
  projectForMember,
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

  it("hidden lists reach only members in visibleTo (FR-LST-04)", () => {
    const s0 = createSeed(NOW);
    const s = {
      ...s0,
      lists: s0.lists.map((l) => (l.id === "l_gifts" ? { ...l, visibleTo: ["m_tom"] } : l)),
    };
    const sees = (memberId: string | null) =>
      projectForMember(s, memberId).lists.some((l) => l.id === "l_gifts");
    expect([sees("m_tom"), sees("m_anna"), sees("m_mia"), sees(null)]).toEqual([true, false, false, false]);
    expect(projectForMember(s, "m_anna").items.some((i) => i.listId === "l_gifts")).toBe(false);

    const anna: Actor = { memberId: "m_anna", elevated: true, device: "app" };
    const tom: Actor = { memberId: "m_tom", elevated: true, device: "app" };
    const remove = { type: "item.remove", itemId: "i_g0" } as const;
    expect(() => applyCommand(s, cmd(remove, anna))).toThrow(/not_found|list/);
    expect(() => applyCommand(s, cmd(remove, { ...anna, memberId: null, device: "display" }))).toThrow(
      DomainError,
    );
    expect(applyCommand(s, cmd(remove, tom)).items.some((i) => i.id === "i_g0")).toBe(false);

    const secret = {
      id: "l_x",
      name: "Secret",
      icon: "🎁",
      kind: "generic",
      hidden: true,
      visibleTo: ["m_tom"],
    };
    expect(() => applyCommand(s, cmd({ type: "list.add", list: secret } as CommandInput, anna))).toThrow(
      DomainError,
    );
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

describe("crafted commands (FR-TSK-03, FR-RWD-01, FR-RWD-03)", () => {
  const display: Actor = { memberId: null, elevated: false, device: "display" };
  const complete = (memberId: string, date: string, taskId = "t_bed") =>
    ({ type: "task.complete", taskId, memberId, date }) as const;

  it("rejects completing a task for a member it is not assigned to", () => {
    const s0 = createSeed(NOW);
    expect(() => applyCommand(s0, cmd(complete("m_ben", dateKey(NOW)), display))).toThrow(/not assigned/);
    expect(() => applyCommand(s0, cmd(complete("m_ben", dateKey(NOW)), parent))).toThrow(/not assigned/);
  });

  it("rejects dates the task does not occur on, or that are malformed", () => {
    const s0 = createSeed(NOW);
    expect(() => applyCommand(s0, cmd(complete("m_mia", "2026-11-28"), parent))).toThrow(/not due/); // Sat
    expect(() => applyCommand(s0, cmd(complete("m_mia", "2026-11-25-1"), parent))).toThrow(/date/);
  });

  it("children cannot farm points with past or future dates; adults may backfill", () => {
    const s0 = createSeed(NOW);
    expect(() => applyCommand(s0, cmd(complete("m_mia", "2026-11-20")))).toThrow(/today/);
    expect(() => applyCommand(s0, cmd(complete("m_mia", "2026-11-27")))).toThrow(/today/);
    expect(balanceOf(applyCommand(s0, cmd(complete("m_mia", "2026-11-20"), parent)), "m_mia")).toBe(100);
  });

  it("a signed-in child cannot act for a sibling", () => {
    const s0 = createSeed(NOW);
    const args = { taskId: "t_teeth_am", memberId: "m_ben", date: dateKey(NOW) };
    expect(() => applyCommand(s0, cmd({ type: "task.complete", ...args }))).toThrow(DomainError);
    expect(() =>
      applyCommand(
        s0,
        cmd({ type: "reward.request", redemptionId: "rd1", rewardId: "rw_movie", memberId: "m_ben" }),
      ),
    ).toThrow(DomainError);
    expect(applyCommand(s0, cmd({ type: "task.complete", ...args }, display)).completions).toHaveLength(1);
  });

  it("rejects unknown members and duplicate entity ids", () => {
    const s0 = createSeed(NOW);
    expect(() =>
      applyCommand(
        s0,
        cmd({ type: "reward.request", redemptionId: "rd1", rewardId: "rw_movie", memberId: "m_x" }, display),
      ),
    ).toThrow(/member/);
    const dentist = s0.events.find((e) => e.id === "e_dentist");
    if (!dentist) throw new Error("seed changed");
    expect(() => applyCommand(s0, cmd({ type: "event.add", event: dentist }, parent))).toThrow(/duplicate/);
    const s1 = applyCommand(
      s0,
      cmd({ type: "reward.request", redemptionId: "rd1", rewardId: "rw_movie", memberId: "m_mia" }),
    );
    expect(() =>
      applyCommand(
        s1,
        cmd({ type: "reward.request", redemptionId: "rd1", rewardId: "rw_movie", memberId: "m_mia" }),
      ),
    ).toThrow(/duplicate/);
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
