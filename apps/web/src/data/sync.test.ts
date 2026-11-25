import {
  type Actor,
  type ChangeBatch,
  type Command,
  type CommandInput,
  DomainError,
  type Snapshot,
  applyCommand,
  createSeed,
  diffSnapshots,
} from "@kinboard/shared";
import { describe, expect, it } from "vitest";
import { type Persisted, memoryStorage } from "./storage.ts";
import { RejectedError, SyncEngine, type Transport } from "./sync.ts";

const NOW = new Date(2026, 10, 25, 7, 30);
const child: Actor = { memberId: null, elevated: false, device: "display" };
const anna: Actor = { memberId: "m_anna", elevated: true, device: "app" };
let n = 0;
const cmd = (input: CommandInput, actor: Actor = child): Command =>
  ({ ...input, id: `c${++n}`, at: NOW.toISOString(), actor }) as Command;
const check = (itemId: string, checked = true) => cmd({ type: "item.check", itemId, checked });
const add = (id: string) =>
  cmd({ type: "item.add", item: { id, listId: "l_shop", text: id, checked: false, sort: 99 } }, anna);
const checked = (s: Snapshot | null, id: string) => s?.items.find((i) => i.id === id)?.checked;

/** A tiny server with the real reducer and diff. `online = false` makes every call fail like a network error. */
class FakeServer implements Transport {
  readonly mode = "remote" as const;
  state = createSeed(NOW);
  history: ChangeBatch[] = [];
  online = true;
  /** When false, batches are not pushed (socket down) but HTTP still works. */
  push = true;
  private listeners = new Set<(b: ChangeBatch) => void>();
  private seen = new Set<string>();

  private up() {
    if (!this.online) throw new TypeError("Failed to fetch");
  }
  async snapshot() {
    this.up();
    return structuredClone(this.state);
  }
  async sync(since: number) {
    this.up();
    if (since < createSeed(NOW).rev) return { reset: true as const };
    const changes = this.history.filter((b) => b.rev > since).flatMap((b) => b.changes);
    return { rev: this.state.rev, changes: structuredClone(changes) };
  }
  async send(c: Command) {
    this.up();
    if (this.seen.has(c.id)) return { rev: this.state.rev };
    let next: Snapshot;
    try {
      // Like the real API, a display is only elevated with a server-side PIN token, which this fake never has.
      const actor = c.actor.device === "display" ? { ...c.actor, elevated: false } : c.actor;
      next = applyCommand(this.state, { ...c, actor });
    } catch (e) {
      if (e instanceof DomainError) throw new RejectedError(e.message);
      throw e;
    }
    this.seen.add(c.id);
    if (next.rev !== this.state.rev) this.publish(next);
    return { rev: next.rev };
  }
  /** A change made by another device. */
  remote(c: Command) {
    this.seen.add(c.id);
    this.publish(applyCommand(this.state, c));
  }
  private publish(next: Snapshot) {
    const batch = {
      rev: next.rev,
      changes: diffSnapshots(this.state, next).map(({ prev: _p, ...ch }) => ch),
    };
    this.state = next;
    this.history.push(batch);
    if (this.push && this.online) for (const l of this.listeners) l(structuredClone(batch));
  }
  subscribe(onBatch: (b: ChangeBatch) => void) {
    this.listeners.add(onBatch);
    return () => this.listeners.delete(onBatch);
  }
}

function setup(server = new FakeServer(), storage = memoryStorage()) {
  const rejected: string[] = [];
  const notices: string[] = [];
  const engine = new SyncEngine(server, storage, {
    onRejected: (_c, message) => rejected.push(message),
    onNotice: (text) => notices.push(text),
    schedule: () => {}, // tests call retryNow() explicitly
    now: () => NOW.getTime(),
  });
  return { server, storage, engine, rejected, notices };
}

describe("SyncEngine (spec §5.3, NFR-05, FR-LST-05)", () => {
  it("applies own commands optimistically and settles on the server's state", async () => {
    const { server, engine } = setup();
    expect(await engine.start()).toBe(true);
    expect(engine.dispatch(check("i_s0"))).toBe(true);
    expect(checked(engine.view(), "i_s0")).toBe(true); // before the server answered
    await engine.idle();
    expect(engine.pending).toBe(0);
    expect(engine.base?.rev).toBe(server.state.rev);
    expect(engine.view()).toEqual(server.state);
  });

  it("applies another device's changes without replaying its command", async () => {
    const { server, engine } = setup();
    await engine.start();
    server.remote(add("i_r1"));
    expect(engine.view()?.items.some((i) => i.id === "i_r1")).toBe(true);
    expect(engine.view()).toEqual(server.state);
  });

  it("queues commands while offline and replays them in order when back (NFR-05)", async () => {
    const { server, engine } = setup();
    await engine.start();
    server.online = false;
    engine.dispatch(add("i_o1"));
    engine.dispatch(check("i_o1"));
    await engine.idle();
    expect(engine.status).toBe("offline");
    expect(engine.pending).toBe(2);
    expect(checked(engine.view(), "i_o1")).toBe(true);

    server.online = true;
    await engine.retryNow();
    expect(engine.status).toBe("online");
    expect(engine.pending).toBe(0);
    expect(checked(server.state, "i_o1")).toBe(true); // add arrived before check
    expect(engine.view()).toEqual(server.state);
  });

  it("converges when two offline devices check the same item (FR-LST-05)", async () => {
    const server = new FakeServer();
    const a = setup(server);
    const b = setup(server);
    await a.engine.start();
    await b.engine.start();
    server.online = false;
    a.engine.dispatch(check("i_s0"));
    b.engine.dispatch(check("i_s0"));
    server.online = true;
    await a.engine.retryNow();
    await b.engine.retryNow();
    expect(checked(server.state, "i_s0")).toBe(true); // a toggle would have flipped it back
    expect(a.engine.view()).toEqual(server.state);
    expect(b.engine.view()).toEqual(server.state);
  });

  it("drops a command the server rejects and reports why", async () => {
    const { engine, rejected } = setup();
    await engine.start();
    engine.dispatch(cmd({ type: "event.delete", eventId: "e_dentist" }, { ...child, elevated: true })); // server says no
    await engine.idle();
    expect(rejected).toEqual(["event.delete requires adult PIN"]);
    expect(engine.pending).toBe(0);
    expect(engine.view()?.events.some((e) => e.id === "e_dentist")).toBe(true);
  });

  it("rejects locally invalid commands without queueing them", async () => {
    const { engine, rejected } = setup();
    await engine.start();
    expect(engine.dispatch(cmd({ type: "event.delete", eventId: "e_dentist" }))).toBe(false);
    expect(rejected).toHaveLength(1);
    expect(engine.pending).toBe(0);
  });

  it("catches up through /sync when a batch is missed", async () => {
    const { server, engine } = setup();
    await engine.start();
    server.push = false;
    server.remote(add("i_m1")); // never pushed
    server.push = true;
    server.remote(add("i_m2")); // rev gap → sync
    await engine.idle();
    expect(engine.view()).toEqual(server.state);
  });

  it("reloads the snapshot when the server cannot serve the history", async () => {
    const server = new FakeServer();
    const stale = { ...createSeed(NOW), rev: 0 };
    const { engine } = setup(server, memoryStorage({ base: stale, outbox: [] }));
    await engine.start();
    expect(engine.view()).toEqual(server.state);
  });

  it("starts from the cache with pending commands when the server is down (NFR-05)", async () => {
    const server = new FakeServer();
    const queued = check("i_s0");
    const cache: Persisted = { base: createSeed(NOW), outbox: [{ cmd: queued }] };
    server.online = false;
    const { engine, storage } = setup(server, memoryStorage(cache));
    expect(await engine.start()).toBe(true);
    expect(engine.status).toBe("offline");
    expect(checked(engine.view(), "i_s0")).toBe(true);

    server.online = true;
    await engine.retryNow();
    expect(checked(server.state, "i_s0")).toBe(true);
    expect((await storage.load())?.outbox).toEqual([]);
  });

  it("reports when there is neither a server nor a cache", async () => {
    const server = new FakeServer();
    server.online = false;
    expect(await setup(server).engine.start()).toBe(false);
  });

  it("persists the outbox so a reload does not lose queued commands", async () => {
    const { server, engine, storage } = setup();
    await engine.start();
    server.online = false;
    const queued = check("i_s0");
    engine.dispatch(queued);
    await engine.idle();
    expect((await storage.load())?.outbox.map((e) => e.cmd.id)).toEqual([queued.id]);
  });

  it("discards queued commands older than the server's 7-day idempotency window", async () => {
    const old = { ...check("i_s0"), at: new Date(NOW.getTime() - 8 * 86_400_000).toISOString() };
    const server = new FakeServer();
    const { engine, notices } = setup(
      server,
      memoryStorage({ base: createSeed(NOW), outbox: [{ cmd: old }] }),
    );
    await engine.start();
    expect(engine.pending).toBe(0);
    expect(notices).toHaveLength(1);
    expect(checked(server.state, "i_s0")).toBe(false);
  });

  it("does not apply its own command twice when the echo arrives before the HTTP answer", async () => {
    const { server, engine } = setup();
    await engine.start();
    engine.dispatch(add("i_e1"));
    await engine.idle();
    expect(engine.view()?.items.filter((i) => i.id === "i_e1")).toHaveLength(1);
    expect(engine.view()).toEqual(server.state);
  });
});
