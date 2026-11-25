import { type Actor, type Command, type Snapshot, applyCommand, createSeed } from "@kinboard/shared";

export type ServerEvent = { type: "applied"; rev: number; command: Command } | { type: "rev"; rev: number };

/** Transport port: the UI never knows whether it talks to a real server or the in-browser demo. */
export interface Backend {
  readonly mode: "remote" | "demo";
  load(): Promise<Snapshot>;
  send(cmd: Command): Promise<void>;
  subscribe(cb: (e: ServerEvent) => void, onReconnect: () => void): () => void;
  /** Adult PIN on the shared display. Resolves to the elevation lifetime in ms, or null for a wrong PIN. */
  verifyPin(pin: string): Promise<number | null>;
  /** Drops the display's elevation. */
  lock(): void;
}

const PIN_TTL_MS = 5 * 60_000;
const DEMO_PIN = "1234";

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

  private get token() {
    return devToken(this.device, this.appMember);
  }

  async load() {
    const r = await fetch(`${this.base}/api/v1/snapshot`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!r.ok) throw new Error(`snapshot ${r.status}`);
    return (await r.json()) as Snapshot;
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
    });
    if (!r.ok) {
      const p = await r.json().catch(() => ({}));
      throw new Error(p.detail ?? `HTTP ${r.status}`);
    }
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

  subscribe(cb: (e: ServerEvent) => void, onReconnect: () => void) {
    let ws: WebSocket | undefined;
    let closed = false;
    let retry = 0;
    let ping: ReturnType<typeof setInterval> | undefined;
    const connect = () => {
      const url = `${this.base.replace(/^http/, "ws")}/api/v1/realtime?token=${encodeURIComponent(this.token)}`;
      ws = new WebSocket(url);
      ws.onopen = () => {
        if (retry > 0) onReconnect(); // resync after a gap
        retry = 0;
        ping = setInterval(() => ws?.readyState === 1 && ws.send("ping"), 25_000);
      };
      ws.onmessage = (m) => {
        if (m.data === "pong") return;
        cb(JSON.parse(m.data));
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
  private listeners = new Set<(e: ServerEvent) => void>();
  private channel: BroadcastChannel | undefined;

  constructor() {
    // Lets several tabs (e.g. /display and /app) stay in sync without a server.
    try {
      this.channel = new BroadcastChannel("kinboard-demo");
      this.channel.onmessage = (m) => {
        const e = m.data as ServerEvent;
        if (e.type === "applied") {
          try {
            this.state = applyCommand(this.state, e.command);
          } catch {
            /* diverged tab – ignored in demo */
          }
          for (const l of this.listeners) l(e);
        }
      };
    } catch {
      this.channel = undefined;
    }
  }

  async load() {
    return this.state;
  }

  async send(cmd: Command) {
    await new Promise((r) => setTimeout(r, 60)); // simulate network
    this.state = applyCommand(this.state, cmd); // throws like the server would
    const e: ServerEvent = { type: "applied", rev: this.state.rev, command: cmd };
    for (const l of this.listeners) l(e);
    try {
      this.channel?.postMessage(e);
    } catch {
      /* ignore */
    }
  }

  subscribe(cb: (e: ServerEvent) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** No server in demo mode, so the PIN is checked here. Never used against a real API. */
  async verifyPin(pin: string) {
    return pin === DEMO_PIN ? PIN_TTL_MS : null;
  }

  lock() {}
}

export function createBackend(device: "display" | "app"): Backend {
  const demo = import.meta.env.VITE_DEMO === "1" || new URLSearchParams(location.search).has("demo");
  if (demo) return new DemoBackend();
  const base = import.meta.env.VITE_API_URL ?? `${location.protocol}//${location.hostname}:8787`;
  return new RemoteBackend(base, device);
}
