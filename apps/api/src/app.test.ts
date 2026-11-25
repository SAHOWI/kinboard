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
      const events: { type: string; rev: number; changes: { id: string }[] }[] = [];
      ws.on("message", (m) => events.push(JSON.parse(m.toString())));
      return { ws, events };
    };
    const [tom, mia, display] = [await listen("dev:app:m_tom"), await listen(MIA), await listen(DISPLAY)];
    const item = { id: "i_secret", listId: "l_gifts", text: "Bike", checked: false, sort: 1 };
    expect((await send(app, ANNA, { type: "item.add", item })).statusCode).toBe(200);
    expect((await send(app, ANNA, { type: "item.remove", itemId: "i_secret" })).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    const ids = (c: typeof tom) => c.events.map((e) => [e.type, e.changes.map((x) => x.id)]);
    expect(ids(tom)).toEqual([
      ["changes", ["i_secret"]],
      ["changes", ["i_secret"]],
    ]);
    // Others still get every revision (so they can detect gaps), just without the hidden changes.
    for (const viewer of [mia, display])
      expect(ids(viewer)).toEqual([
        ["changes", []],
        ["changes", []],
      ]);
    expect(mia.events.map((e) => e.rev)).toEqual(tom.events.map((e) => e.rev));
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

  it("lets only an adult on the app change the PIN (FR-HH-08)", async () => {
    const repo = new InMemoryRepository();
    const app = buildApp(repo, { pin: "2468" });
    const setPin = (token: string, pin: unknown) =>
      app.inject({ method: "PUT", url: "/api/v1/pin", headers: auth(token), payload: { pin } });
    const { token } = (await verifyPin(app, "2468")).json();

    expect((await setPin(MIA, "9753")).statusCode).toBe(403);
    expect((await setPin(DISPLAY, "9753")).statusCode).toBe(403);
    expect((await setPin(ANNA, "12")).statusCode).toBe(400);
    expect((await setPin(ANNA, 9753)).statusCode).toBe(400);
    expect((await setPin(ANNA, "9753")).statusCode).toBe(204);

    expect(await repo.getPinHash("hh_1")).toMatch(/^\$argon2id\$/);
    expect((await send(app, DISPLAY, deleteDentist, token)).statusCode).toBe(403); // old elevation revoked
    expect((await verifyPin(app, "2468")).statusCode).toBe(401);
    expect((await verifyPin(app, "9753")).statusCode).toBe(200);
  });

  it("keeps a changed PIN and the lockout across restarts", async () => {
    const repo = new InMemoryRepository();
    const first = buildApp(repo, { pin: "2468" });
    await first.inject({ method: "PUT", url: "/api/v1/pin", headers: auth(ANNA), payload: { pin: "9753" } });
    for (let i = 0; i < 5; i++) expect((await verifyPin(first, "1111")).statusCode).toBe(401);
    await first.close();

    let clock = Date.now();
    const second = buildApp(repo, { pin: "2468", now: () => clock }); // same storage, initial PIN ignored
    expect((await verifyPin(second, "9753")).statusCode).toBe(429);
    clock += 60_001;
    expect((await verifyPin(second, "2468")).statusCode).toBe(401);
    expect((await verifyPin(second, "9753")).statusCode).toBe(200);
  });

  it("broadcasts the server's resulting changes and closes unauthenticated sockets", async () => {
    const app = make();
    await app.ready();
    const anon = await app.injectWS("/api/v1/realtime");
    const closed = await new Promise<number>((r) => anon.on("close", (code) => r(code)));
    expect(closed).toBe(4401);

    const ws = await app.injectWS(`/api/v1/realtime?token=${DISPLAY}`);
    const got = new Promise<{ type: string; changes: { entity: string }[] }>((r) =>
      ws.on("message", (m) => r(JSON.parse(m.toString()))),
    );
    const done = {
      type: "task.complete",
      taskId: "t_teeth_am",
      memberId: "m_mia",
      date: dateKey(new Date()),
    };
    await send(app, DISPLAY, { ...done, actor: crafted });
    const batch = await got;
    expect(batch.type).toBe("changes");
    expect(batch.changes.map((c) => c.entity)).toEqual(["task_completion", "points_ledger"]);
    expect(JSON.stringify(batch)).not.toContain("actor"); // clients never replay other clients' commands
    ws.terminate();
    await app.close();
  });

  it("serves per-viewer delta sync and asks for a reload when history is unavailable (spec §5.3)", async () => {
    const app = make();
    const sync = async (token: string, since: string | number) =>
      app.inject({ url: `/api/v1/sync?since=${since}`, headers: auth(token) });
    const { rev } = (await app.inject({ url: "/api/v1/snapshot", headers: auth(ANNA) })).json();
    const item = { id: "i_secret", listId: "l_gifts", text: "Bike", checked: false, sort: 1 };
    await send(app, ANNA, { type: "item.add", item });
    await send(app, ANNA, { type: "item.check", itemId: "i_s0", checked: true });

    const tom = (await sync("dev:app:m_tom", rev)).json();
    const mia = (await sync(MIA, rev)).json();
    expect(tom.rev).toBe(rev + 2);
    expect(tom.changes.map((c: { id: string }) => c.id)).toEqual(["i_secret", "i_s0"]);
    expect(mia).toEqual({ rev: rev + 2, changes: [tom.changes[1]] });
    expect((await sync(MIA, rev + 2)).json()).toEqual({ rev: rev + 2, changes: [] });
    expect((await sync(MIA, rev - 1)).json()).toEqual({ reset: true });
    expect((await sync(MIA, rev + 9)).json()).toEqual({ reset: true });
    expect((await sync(MIA, "abc")).statusCode).toBe(400);
    expect((await app.inject("/api/v1/sync?since=0")).statusCode).toBe(401);
  });

  it("rejects malformed commands with problem+json", async () => {
    const res = await send(make(), DISPLAY, { type: "nope" });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("problem+json");
  });
});
