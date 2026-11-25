import { dateKey } from "@kinboard/shared";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

const actor = { memberId: "m_mia", elevated: false, device: "display" };

describe("API", () => {
  it("returns a snapshot and hides hidden lists for displays", async () => {
    const app = buildApp();
    const appView = (await app.inject("/api/v1/snapshot")).json();
    const displayView = (await app.inject("/api/v1/snapshot?device=display")).json();
    expect(appView.lists.some((l: { hidden: boolean }) => l.hidden)).toBe(true);
    expect(displayView.lists.some((l: { hidden: boolean }) => l.hidden)).toBe(false);
  });

  it("applies commands idempotently and enforces permissions", async () => {
    const app = buildApp();
    const body = {
      id: "cmd-1",
      at: new Date().toISOString(),
      actor,
      type: "task.complete",
      taskId: "t_teeth_am",
      memberId: "m_mia",
      date: dateKey(new Date()),
    };
    const r1 = await app.inject({ method: "POST", url: "/api/v1/commands", payload: body });
    const r2 = await app.inject({ method: "POST", url: "/api/v1/commands", payload: body });
    expect(r1.json().replay).toBe(false);
    expect(r2.json().replay).toBe(true);

    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/commands",
      payload: { id: "cmd-2", at: body.at, actor, type: "event.delete", eventId: "e_dentist" },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("rejects crafted point-farming requests (FR-TSK-03, FR-RWD-01)", async () => {
    const app = buildApp();
    const base = { at: new Date().toISOString(), actor, type: "task.complete", taskId: "t_bed" };
    const send = (payload: object) => app.inject({ method: "POST", url: "/api/v1/commands", payload });
    const sibling = await send({ ...base, id: "f-1", memberId: "m_ben", date: dateKey(new Date()) });
    const pastDay = await send({ ...base, id: "f-2", memberId: "m_mia", date: "2020-01-06" });
    expect(sibling.statusCode).toBe(403);
    expect(pastDay.statusCode).toBe(422);
  });

  it("rejects malformed commands with problem+json", async () => {
    const res = await buildApp().inject({
      method: "POST",
      url: "/api/v1/commands",
      payload: { type: "nope" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("problem+json");
  });
});
