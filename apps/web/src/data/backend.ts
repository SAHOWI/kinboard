import {
  type Actor,
  type ChangeBatch,
  type Command,
  type Snapshot,
  applyCommand,
  createSeed,
  diffSnapshots,
} from "@kinboard/shared";
import { RejectedError, type Transport } from "./sync.ts";

/** A transport plus the display's adult-PIN elevation. The UI never knows whether it talks to a server. */
export interface Backend extends Transport {
  /** Adult PIN on the shared display. Resolves to the elevation lifetime in ms, or null for a wrong PIN. */
  verifyPin(pin: string): Promise<number | null>;
  /** Drops the display's elevation. */
  lock(): void;
  /** An adult on the app sets the household PIN (FR-HH-08). Throws with the server's message. */
  setPin(pin: string, memberId: string): Promise<void>;
}

const PIN_TTL_MS = 5 * 60_000;
const DEMO_PIN = "1234";
const PIN_FORMAT = /^\d{4,8}$/;

/**
 * TEMPORARY identity until auth and device pairing land (M2 steps 3 and 5): unsigned dev tokens that the API
 * accepts only in development. The server builds the Actor from them and ignores any actor we would send.
 */
const devToken = (device: Actor["device"], memberId: string | null) =>
  device === "display" ? "dev:display" : `dev:app:${memberId}`;

/* ───────────── Remote: Fastify REST + WebSocket ───────────── */
export class RemoteBackend implements Backend {
  readonly mode = "remote" as const;
  private elevation: { token: string; until: number } | undefined;

  constructor(
    private base: string,
    private device: "display" | "app",
    /** Member the app shell loads as. The app's member switcher is still a mock-up (gap #10). */
    private appMember = "m_anna",
  ) {}

  /** Identifies this storage/cache slot: one per server and device identity. */
  get cacheKey() {
    return `${this.base}|${this.token}`;
  }

  private get token() {
    return devToken(this.device, this.appMember);
  }

  private async get<T>(path: string): Promise<T> {
    const r = await fetch(`${this.base}${path}`, { headers: { authorization: `Bearer ${this.token}` } });
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return (await r.json()) as T;
  }

  snapshot() {
    return this.get<Snapshot>("/api/v1/snapshot");
  }

  sync(since: number) {
    return this.get<ChangeBatch | { reset: true }>(`/api/v1/sync?since=${since}`);
  }

  async send(cmd: Command) {
    const { actor, ...body } = cmd; // the server derives the actor; we only say which device is asking
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "idempotency-key": cmd.id,
      authorization: `Bearer ${devToken(actor.device, actor.memberId)}`,
    };
    if (actor.device === "display" && this.elevation && this.elevation.until > Date.now())
      headers["x-kinboard-elevation"] = this.elevation.token;
    const r = await fetch(`${this.base}/api/v1/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }); // a network failure throws here and the command stays queued
    const p = await r.json().catch(() => ({}));
    if (r.ok) return { rev: (p as { rev: number }).rev };
    const message = (p as { detail?: string }).detail ?? `HTTP ${r.status}`;
    // 4xx is the server's final answer; 408, 429 and 5xx are worth retrying.
    if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429)
      throw new RejectedError(message);
    throw new Error(message);
  }

  async verifyPin(pin: string) {
    const r = await fetch(`${this.base}/api/v1/pin/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${devToken("display", null)}` },
      body: JSON.stringify({ pin }),
    });
    if (r.status === 401) return null;
    const p = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(p.detail ?? `HTTP ${r.status}`);
    const { token, ttlMs } = p as { token: string; ttlMs: number };
    this.elevation = { token, until: Date.now() + ttlMs };
    return ttlMs;
  }

  lock() {
    this.elevation = undefined;
  }

  async setPin(pin: string, memberId: string) {
    const r = await fetch(`${this.base}/api/v1/pin`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${devToken("app", memberId)}` },
      body: JSON.stringify({ pin }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `HTTP ${r.status}`);
  }

  subscribe(onBatch: (b: ChangeBatch) => void, onOpen: () => void) {
    let ws: WebSocket | undefined;
    let closed = false;
    let retry = 0;
    let ping: ReturnType<typeof setInterval> | undefined;
    const connect = () => {
      const url = `${this.base.replace(/^http/, "ws")}/api/v1/realtime?token=${encodeURIComponent(this.token)}`;
      ws = new WebSocket(url);
      ws.onopen = () => {
        if (retry > 0) onOpen(); // catch up on what happened while disconnected
        retry = 0;
        ping = setInterval(() => ws?.readyState === 1 && ws.send("ping"), 25_000);
      };
      ws.onmessage = (m) => {
        if (m.data === "pong") return;
        const e = JSON.parse(m.data) as { type: string } & ChangeBatch;
        if (e.type === "changes") onBatch({ rev: e.rev, changes: e.changes });
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (closed) return;
        retry++;
        setTimeout(connect, Math.min(30_000, 500 * 2 ** retry)); // exponential backoff
      };
    };
    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }
}

/* ───────────── Demo: authoritative state inside the browser ───────────── */
export class DemoBackend implements Backend {
  readonly mode = "demo" as const;
  private state: Snapshot = createSeed();
  private readonly historyFrom = this.state.rev;
  private history: ChangeBatch[] = [];
  private listeners = new Set<(b: ChangeBatch) => void>();
  private channel: BroadcastChannel | undefined;

  constructor() {
    // Lets several tabs (e.g. /display and /app) stay in sync without a server: each tab applies the
    // others' commands to its own copy.
    try {
      this.channel = new BroadcastChannel("kinboard-demo");
      this.channel.onmessage = (m) => {
        try {
          this.commit(applyCommand(this.state, m.data as Command));
        } catch {
          /* diverged tab – ignored in demo */
        }
      };
    } catch {
      this.channel = undefined;
    }
  }

  private commit(next: Snapshot) {
    if (next.rev === this.state.rev) return;
    const batch = { rev: next.rev, changes: diffSnapshots(this.state, next).map(({ prev: _p, ...c }) => c) };
    this.state = next;
    this.history.push(batch);
    for (const l of this.listeners) l(batch);
  }

  async snapshot() {
    return this.state;
  }

  async sync(since: number) {
    if (since < this.historyFrom || since > this.state.rev) return { reset: true as const };
    return {
      rev: this.state.rev,
      changes: this.history.filter((b) => b.rev > since).flatMap((b) => b.changes),
    };
  }

  async send(cmd: Command) {
    await new Promise((r) => setTimeout(r, 60)); // simulate network
    let next: Snapshot;
    try {
      next = applyCommand(this.state, cmd);
    } catch (e) {
      throw new RejectedError((e as Error).message);
    }
    this.commit(next);
    try {
      this.channel?.postMessage(cmd);
    } catch {
      /* ignore */
    }
    return { rev: this.state.rev };
  }

  subscribe(onBatch: (b: ChangeBatch) => void) {
    this.listeners.add(onBatch);
    return () => this.listeners.delete(onBatch);
  }

  private pin = DEMO_PIN;

  /** No server in demo mode, so the PIN is checked here. Never used against a real API. */
  async verifyPin(pin: string) {
    return pin === this.pin ? PIN_TTL_MS : null;
  }

  lock() {}

  async setPin(pin: string, memberId: string) {
    if (this.state.members.find((m) => m.id === memberId)?.role !== "adult")
      throw new Error("Only an adult in the app can change the PIN");
    if (!PIN_FORMAT.test(pin)) throw new Error("The PIN must be 4–8 digits");
    this.pin = pin;
  }
}

export function createBackend(device: "display" | "app"): Backend & { cacheKey?: string } {
  const demo = import.meta.env.VITE_DEMO === "1" || new URLSearchParams(location.search).has("demo");
  if (demo) return new DemoBackend();
  const base = import.meta.env.VITE_API_URL ?? `${location.protocol}//${location.hostname}:8787`;
  return new RemoteBackend(base, device);
}
