import { dateKey } from "@kinboard/shared";
import { describe, expect, it } from "vitest";
import { type AppOptions, buildApp } from "./app.ts";
import { InMemoryRepository } from "./repository.ts";

const DISPLAY = "dev:display";
const ANNA = "dev:app:m_anna"; // adult
const MIA = "dev:app:m_mia"; // child

type App = ReturnType<typeof buildApp>;
const make = (opts: AppOptions = {}) => buildApp(new InMemoryRepository(), { pin: "2468", ...opts });
const auth = (token: string, elevation?: string) => ({
  authorization: `Bearer ${token}`,
  ...(elevation ? { "x-kinboard-elevation": elevation } : {}),
});
let n = 0;
const send = (app: App, token: string | null, body: object, elevation?: string) =>
  app.inject({
    method: "POST",
    url: "/api/v1/commands",
    headers: token ? auth(token, elevation) : {},
    payload: { id: `cmd-${++n}`, at: new Date().toISOString(), ...body },
  });
const verifyPin = (app: App, pin: string, token = DISPLAY) =>
  app.inject({ method: "POST", url: "/api/v1/pin/verify", headers: auth(token), payload: { pin } });
const deleteDentist = { type: "event.delete", eventId: "e_dentist" };
const crafted = { memberId: "m_anna", elevated: true, device: "app" };

describe("API", () => {
  it("rejects requests without a valid identity", async () => {
    const app = make();
    expect((await app.inject("/api/v1/snapshot")).statusCode).toBe(401);
    expect((await send(app, null, deleteDentist)).statusCode).toBe(401);
    expect((await send(app, "dev:app:m_nobody", deleteDentist)).statusCode).toBe(401);
    expect((await send(app, "garbage", deleteDentist)).statusCode).toBe(401);
  });

  it("refuses dev tokens when dev auth is disabled", async () => {
    const app = make({ devAuth: false });
    expect((await app.inject({ url: "/api/v1/snapshot", headers: auth(ANNA) })).statusCode).toBe(401);
  });

  it("projects the snapshot from the token, not the query string", async () => {
    const app = make();
    const display = (await app.inject({ url: "/api/v1/snapshot?device=app", headers: auth(DISPLAY) })).json();
    const anna = (await app.inject({ url: "/api/v1/snapshot", headers: auth(ANNA) })).json();
    expect(display.lists.some((l: { hidden: boolean }) => l.hidden)).toBe(false);
    expect(anna.lists.some((l: { hidden: boolean }) => l.hidden)).toBe(true);
  });

  it("sends hidden lists only to members in visibleTo (gap #3, FR-LST-04)", async () => {
    const app = make();
    const mia = (await app.inject({ url: "/api/v1/snapshot", headers: auth(MIA) })).json();
    expect(mia.lists.some((l: { id: string }) => l.id === "l_gifts")).toBe(false);
    expect(mia.items.some((i: { listId: string }) => i.listId === "l_gifts")).toBe(false);
  });

  it("fans realtime events out per viewer, without leaking hidden-list activity (gaps #3, #7)", async () => {
    const app = make();
    await app.ready();
    const listen = async (token: string) => {
      const ws = await app.injectWS(`/api/v1/realtime?token=${token}`);
      const events: { type: string }[] = [];
      ws.on("message", (m) => events.push(JSON.parse(m.toString())));
      return { ws, events };
    };
    const [tom, mia, display] = [await listen("dev:app:m_tom"), await listen(MIA), await listen(DISPLAY)];
    const item = { id: "i_secret", listId: "l_gifts", text: "Bike", checked: false, sort: 1 };
    expect((await send(app, ANNA, { type: "item.add", item })).statusCode).toBe(200);
    expect((await send(app, ANNA, { type: "item.remove", itemId: "i_secret" })).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    expect(tom.events.map((e) => e.type)).toEqual(["applied", "applied"]);
    expect(mia.events.map((e) => e.type)).toEqual(["rev", "rev"]);
    expect(display.events.map((e) => e.type)).toEqual(["rev", "rev"]);
    expect(JSON.stringify([...mia.events, ...display.events])).not.toContain("i_secret");
    for (const c of [tom, mia, display]) c.ws.terminate();
    await app.close();
  });

  it("applies commands idempotently and enforces permissions", async () => {
    const app = make();
    const body = {
      id: "cmd-fixed",
      at: new Date().toISOString(),
      type: "task.complete",
      taskId: "t_teeth_am",
      memberId: "m_mia",
      date: dateKey(new Date()),
    };
    const post = () =>
      app.inject({ method: "POST", url: "/api/v1/commands", headers: auth(DISPLAY), payload: body });
    expect((await post()).json().replay).toBe(false);
    expect((await post()).json().replay).toBe(true);
    expect((await send(app, DISPLAY, deleteDentist)).statusCode).toBe(403);
  });

  it("ignores a crafted elevated actor from a display or a child (gap #1)", async () => {
    const app = make();
    expect((await send(app, DISPLAY, { ...deleteDentist, actor: crafted })).statusCode).toBe(403);
    expect((await send(app, MIA, { ...deleteDentist, actor: crafted })).statusCode).toBe(403);
    expect((await send(app, ANNA, deleteDentist)).statusCode).toBe(200);
  });

  it("rejects crafted point-farming requests (FR-TSK-03, FR-RWD-01)", async () => {
    const app = make();
    const base = { type: "task.complete", taskId: "t_bed" };
    const sibling = await send(app, "dev:app:m_ben", {
      ...base,
      memberId: "m_mia",
      date: dateKey(new Date()),
    });
    const pastDay = await send(app, DISPLAY, { ...base, memberId: "m_mia", date: "2020-01-06" });
    expect(sibling.statusCode).toBe(403);
    expect(pastDay.statusCode).toBe(422);
  });

  it("elevates a display only with a server-verified PIN token (FR-HH-08)", async () => {
    let clock = Date.now();
    const app = make({ now: () => clock });
    expect((await verifyPin(app, "0000")).statusCode).toBe(401);
    expect((await verifyPin(app, "2468", ANNA)).statusCode).toBe(403); // displays only

    const ok = await verifyPin(app, "2468");
    expect(ok.statusCode).toBe(200);
    const { token, ttlMs } = ok.json();
    expect(ttlMs).toBe(5 * 60_000);

    expect((await send(app, MIA, deleteDentist, token)).statusCode).toBe(403); // not this identity's token
    expect((await send(app, DISPLAY, deleteDentist, "forged")).statusCode).toBe(403);
    expect((await send(app, DISPLAY, deleteDentist, token)).statusCode).toBe(200);

    clock += ttlMs + 1;
    const deleteTask = { type: "task.delete", taskId: "t_bed" };
    expect((await send(app, DISPLAY, deleteTask, token)).statusCode).toBe(403); // expired
  });

  it("locks PIN entry after repeated failures", async () => {
    let clock = Date.now();
    const app = make({ now: () => clock });
    for (let i = 0; i < 5; i++) expect((await verifyPin(app, "1111")).statusCode).toBe(401);
    expect((await verifyPin(app, "2468")).statusCode).toBe(429);
    clock += 60_001;
    expect((await verifyPin(app, "2468")).statusCode).toBe(200);
  });

  it("disables PIN elevation when no PIN is configured", async () => {
    const app = buildApp(new InMemoryRepository(), { pin: undefined, devAuth: true });
    expect((await verifyPin(app, "1234")).statusCode).toBe(403);
  });

  it("broadcasts the server-built actor and closes unauthenticated sockets", async () => {
    const app = make();
    await app.ready();
    const anon = await app.injectWS("/api/v1/realtime");
    const closed = await new Promise<number>((r) => anon.on("close", (code) => r(code)));
    expect(closed).toBe(4401);

    const ws = await app.injectWS(`/api/v1/realtime?token=${DISPLAY}`);
    const got = new Promise<{ command: { actor: unknown } }>((r) =>
      ws.on("message", (m) => r(JSON.parse(m.toString()))),
    );
    const done = {
      type: "task.complete",
      taskId: "t_teeth_am",
      memberId: "m_mia",
      date: dateKey(new Date()),
    };
    await send(app, DISPLAY, { ...done, actor: crafted });
    expect((await got).command.actor).toEqual({ memberId: null, elevated: false, device: "display" });
    ws.terminate();
    await app.close();
  });

  it("rejects malformed commands with problem+json", async () => {
    const res = await send(make(), DISPLAY, { type: "nope" });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("problem+json");
  });
});
