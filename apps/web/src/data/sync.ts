import { type ChangeBatch, type Command, type Snapshot, applyChanges, applyCommand } from "@kinboard/shared";
import type { OutboxEntry, SyncStorage } from "./storage.ts";

/** The server said no (domain or permission error). The command is dropped, never retried. */
export class RejectedError extends Error {}

/** How the engine talks to a backend: the API (`RemoteBackend`) or the in-browser demo. */
export interface Transport {
  readonly mode: "remote" | "demo";
  snapshot(): Promise<Snapshot>;
  sync(since: number): Promise<ChangeBatch | { reset: true }>;
  /** Resolves with the revision the command was applied at. Throws `RejectedError` or a network error. */
  send(cmd: Command): Promise<{ rev: number }>;
  /** Pushed change batches. `onOpen` fires on every (re)connect, so the engine can catch up. */
  subscribe(onBatch: (b: ChangeBatch) => void, onOpen: () => void): () => void;
}

export type SyncStatus = "loading" | "online" | "offline";

export interface SyncEvents {
  onChange?(engine: SyncEngine): void;
  onRejected?(cmd: Command, message: string): void;
  onNotice?(text: string): void;
  /** Timer for retries (injectable for tests). */
  schedule?(fn: () => void, ms: number): void;
  now?(): number;
}

/** The server keeps idempotency receipts for 7 days; older queued commands could be applied twice. */
const MAX_QUEUE_AGE_MS = 7 * 86_400_000;

/**
 * Client side of delta sync (spec §5.3) with an offline outbox (NFR-05, FR-LST-05).
 *
 * - `base` is the last server-confirmed state at `base.rev`. It only changes through server change
 *   batches (`applyChanges`), never by replaying other clients' commands.
 * - `outbox` holds this device's commands in order. They are sent one at a time; an entry stays until
 *   `base` has caught up with the revision the server applied it at, so the UI never flickers.
 * - What the UI shows is `view()`: `base` with the outbox replayed on top through the shared reducer.
 * - `base` and the outbox are persisted, so the app starts offline from cache and loses no queued command.
 */
export class SyncEngine {
  base: Snapshot | null = null;
  outbox: OutboxEntry[] = [];
  status: SyncStatus = "loading";

  private flushing: Promise<void> | null = null;
  private catching: Promise<void> | null = null;
  private retryTimer = false;
  private attempt = 0;
  private unsubscribe: (() => void) | undefined;
  private cachedView: Snapshot | null = null;

  constructor(
    readonly transport: Transport,
    private storage: SyncStorage,
    private events: SyncEvents = {},
  ) {}

  private get now() {
    return this.events.now?.() ?? Date.now();
  }

  /** Number of commands the server has not confirmed yet. */
  get pending(): number {
    return this.outbox.filter((e) => e.ackRev === undefined).length;
  }

  /** Loads the cache, connects and catches up. False when there is neither a server nor a cache. */
  async start(): Promise<boolean> {
    const cached = await this.storage.load().catch(() => undefined);
    if (cached) {
      this.base = cached.base;
      const fresh = cached.outbox.filter((e) => this.now - Date.parse(e.cmd.at) < MAX_QUEUE_AGE_MS);
      const expired = cached.outbox.length - fresh.length;
      if (expired) this.events.onNotice?.(`${expired} change(s) older than 7 days were not sent`);
      this.outbox = fresh;
      this.changed();
    }
    this.unsubscribe = this.transport.subscribe(
      (b) => this.onBatch(b),
      () => void this.retryNow(),
    );
    try {
      if (this.base) await this.catchUp(true);
      else this.base = await this.transport.snapshot();
      this.setStatus("online");
    } catch {
      if (!this.base) {
        this.unsubscribe();
        return false;
      }
      this.setStatus("offline");
      this.scheduleRetry();
    }
    this.changed();
    void this.flush();
    return true;
  }

  stop() {
    this.unsubscribe?.();
  }

  /** The state the UI shows: confirmed state plus this device's pending commands. */
  view(): Snapshot | null {
    if (!this.base) return null;
    if (this.cachedView) return this.cachedView;
    let s = this.base;
    for (const e of this.outbox) {
      if (e.ackRev !== undefined && e.ackRev <= this.base.rev) continue;
      try {
        s = applyCommand(s, e.cmd);
      } catch {
        // No longer applicable on the newer base (e.g. the item was deleted elsewhere): the server decides.
      }
    }
    this.cachedView = s;
    return s;
  }

  /** Queues a command. False (and `onRejected`) when it is already invalid locally. */
  dispatch(cmd: Command): boolean {
    const view = this.view();
    if (!view) return false;
    try {
      applyCommand(view, cmd); // same rules as the server → instant feedback
    } catch (e) {
      this.events.onRejected?.(cmd, (e as Error).message);
      return false;
    }
    this.outbox.push({ cmd });
    this.changed();
    void this.flush();
    return true;
  }

  /** Reconnect now: catch up and send the outbox (after a reconnect or the browser's `online` event). */
  async retryNow(): Promise<void> {
    try {
      await this.catchUp();
    } catch {
      this.setStatus("offline");
      this.scheduleRetry();
      return;
    }
    await this.flush();
  }

  /** Resolves once no send or catch-up is in flight (tests). */
  async idle(): Promise<void> {
    while (this.flushing || this.catching) await (this.flushing ?? this.catching);
  }

  private onBatch(b: ChangeBatch) {
    if (!this.base || b.rev <= this.base.rev) return; // already have it
    if (b.rev !== this.base.rev + 1) {
      void this.catchUp().catch(() => this.scheduleRetry()); // missed a batch
      return;
    }
    this.base = applyChanges(this.base, b.changes, b.rev);
    this.setStatus("online");
    this.changed();
  }

  /** Fetches the changes since `base.rev` (or the full snapshot when the server says reset). */
  private catchUp(rethrow = true): Promise<void> {
    if (!this.catching) {
      // Cleared in .finally (after the assignment), never inside the body: the body may finish synchronously.
      const run = this.runCatchUp().finally(() => {
        if (this.catching === run) this.catching = null;
      });
      this.catching = run;
    }
    return rethrow ? this.catching : this.catching.catch(() => {});
  }

  private async runCatchUp() {
    if (!this.base) return;
    const r = await this.transport.sync(this.base.rev);
    if ("reset" in r) this.base = await this.transport.snapshot();
    else if (r.rev > this.base.rev) this.base = applyChanges(this.base, r.changes, r.rev);
    this.setStatus("online");
    this.changed();
  }

  /** Sends queued commands one at a time, in order. Stops at the first network failure. */
  private flush(): Promise<void> {
    if (!this.flushing) {
      const run = this.runFlush().finally(() => {
        if (this.flushing === run) this.flushing = null;
      });
      this.flushing = run;
    }
    return this.flushing;
  }

  private async runFlush() {
    for (let e = this.next(); e; e = this.next()) {
      try {
        const { rev } = await this.transport.send(e.cmd);
        e.ackRev = rev;
        this.attempt = 0;
        this.setStatus("online");
      } catch (err) {
        if (err instanceof RejectedError) {
          this.outbox = this.outbox.filter((x) => x !== e);
          this.events.onRejected?.(e.cmd, err.message);
        } else {
          this.setStatus("offline");
          this.scheduleRetry();
          return;
        }
      } finally {
        this.changed();
      }
    }
    // Confirmed but not yet seen in a batch (e.g. the socket is down): fetch the changes.
    const rev = this.base?.rev ?? 0;
    if (this.outbox.some((x) => x.ackRev !== undefined && x.ackRev > rev)) await this.catchUp(false);
  }

  private next() {
    return this.outbox.find((e) => e.ackRev === undefined);
  }

  private scheduleRetry() {
    if (this.retryTimer || !this.events.schedule) return;
    this.retryTimer = true;
    const ms = Math.min(30_000, 1000 * 2 ** this.attempt++);
    this.events.schedule(() => {
      this.retryTimer = false;
      void this.retryNow();
    }, ms);
  }

  private setStatus(s: SyncStatus) {
    this.status = s;
  }

  /** Drops confirmed entries `base` already contains, persists, and notifies. */
  private changed() {
    if (this.base) {
      const rev = this.base.rev;
      this.outbox = this.outbox.filter((e) => e.ackRev === undefined || e.ackRev > rev);
      void this.storage.save({ base: this.base, outbox: this.outbox }).catch(() => {});
    }
    this.cachedView = null;
    this.events.onChange?.(this);
  }
}
