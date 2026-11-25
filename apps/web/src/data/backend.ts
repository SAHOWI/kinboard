import { type Command, type Snapshot, applyCommand, createSeed } from "@kinboard/shared";

export type ServerEvent = { type: "applied"; rev: number; command: Command } | { type: "rev"; rev: number };

/** Transport port: the UI never knows whether it talks to a real server or the in-browser demo. */
export interface Backend {
  readonly mode: "remote" | "demo";
  load(): Promise<Snapshot>;
  send(cmd: Command): Promise<void>;
  subscribe(cb: (e: ServerEvent) => void, onReconnect: () => void): () => void;
}

/* ───────────── Remote: Fastify REST + WebSocket ───────────── */
export class RemoteBackend implements Backend {
  readonly mode = "remote" as const;
  constructor(
    private base: string,
    private device: "display" | "app",
  ) {}

  async load() {
    const r = await fetch(`${this.base}/api/v1/snapshot?device=${this.device}`);
    if (!r.ok) throw new Error(`snapshot ${r.status}`);
    return (await r.json()) as Snapshot;
  }

  async send(cmd: Command) {
    const r = await fetch(`${this.base}/api/v1/commands`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": cmd.id },
      body: JSON.stringify(cmd),
    });
    if (!r.ok) {
      const p = await r.json().catch(() => ({}));
      throw new Error(p.detail ?? `HTTP ${r.status}`);
    }
  }

  subscribe(cb: (e: ServerEvent) => void, onReconnect: () => void) {
    let ws: WebSocket | undefined;
    let closed = false;
    let retry = 0;
    let ping: ReturnType<typeof setInterval> | undefined;
    const connect = () => {
      const url = `${this.base.replace(/^http/, "ws")}/api/v1/realtime?device=${this.device}`;
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
}

export function createBackend(device: "display" | "app"): Backend {
  const demo = import.meta.env.VITE_DEMO === "1" || new URLSearchParams(location.search).has("demo");
  if (demo) return new DemoBackend();
  const base = import.meta.env.VITE_API_URL ?? `${location.protocol}//${location.hostname}:8787`;
  return new RemoteBackend(base, device);
}
