import {
  type Command,
  type Snapshot,
  type StoredChange,
  applyCommand,
  createSeed,
  diffSnapshots,
} from "@kinboard/shared";

export interface Applied {
  state: Snapshot;
  /** The revision this command was applied to. `state.rev > fromRev` exactly when it created a revision. */
  fromRev: number;
  /** True when the command id was already applied; nothing changed this time. */
  replay: boolean;
  /** What the command changed (empty for replays and no-ops). */
  changes: StoredChange[];
}

/** Failed PIN attempts for one scope (a device identity, or "*" for the whole household). */
export interface PinAttempts {
  failures: number;
  /** Start of the counting window (ms since epoch). */
  windowStart: number;
  /** Locked until (ms since epoch); 0 when not locked. */
  lockedUntil: number;
}

/** Server-only credentials. Never part of the Snapshot, so never sent to a client (gap #2). */
export interface PinStore {
  getPinHash(householdId: string): Promise<string | null>;
  setPinHash(householdId: string, hash: string): Promise<void>;
  getPinAttempts(householdId: string, scope: string): Promise<PinAttempts | null>;
  /** `null` clears the record. */
  setPinAttempts(householdId: string, scope: string, attempts: PinAttempts | null): Promise<void>;
}

/**
 * Persistence port: `DrizzleRepository` (PostgreSQL / PGlite) and `InMemoryRepository` (tests).
 * Each command is applied atomically and recorded as entity changes for delta sync (spec §5.3).
 */
export interface Repository extends PinStore {
  snapshot(householdId: string): Promise<Snapshot>;
  apply(householdId: string, cmd: Command): Promise<Applied>;
  /** All changes after `since`, or null when that history is unavailable (the client reloads the snapshot). */
  changesSince(householdId: string, since: number): Promise<{ rev: number; changes: StoredChange[] } | null>;
}

interface Household {
  state: Snapshot;
  historyFromRev: number;
  log: { rev: number; changes: StoredChange[] }[];
  seen: Set<string>; // idempotency keys; grows forever (tests and demos only)
}

export class InMemoryRepository implements Repository {
  private households = new Map<string, Household>();
  private pinHashes = new Map<string, string>();
  private attempts = new Map<string, PinAttempts>();

  constructor(private seed: () => Snapshot = createSeed) {}

  private get(id: string): Household {
    let h = this.households.get(id);
    if (!h) {
      const state = this.seed();
      h = { state, historyFromRev: state.rev, log: [], seen: new Set() };
      this.households.set(id, h);
    }
    return h;
  }

  async snapshot(householdId: string) {
    return this.get(householdId).state;
  }

  async apply(householdId: string, cmd: Command): Promise<Applied> {
    const h = this.get(householdId);
    const fromRev = h.state.rev;
    if (h.seen.has(cmd.id)) return { state: h.state, fromRev, replay: true, changes: [] };
    const next = applyCommand(h.state, cmd); // throws DomainError on rejection
    const changes = diffSnapshots(h.state, next);
    if (changes.length) h.log.push({ rev: next.rev, changes });
    h.state = next;
    h.seen.add(cmd.id);
    return { state: next, fromRev, replay: false, changes };
  }

  async getPinHash(householdId: string) {
    return this.pinHashes.get(householdId) ?? null;
  }

  async setPinHash(householdId: string, hash: string) {
    this.pinHashes.set(householdId, hash);
  }

  async getPinAttempts(householdId: string, scope: string) {
    const a = this.attempts.get(`${householdId}|${scope}`);
    return a ? { ...a } : null;
  }

  async setPinAttempts(householdId: string, scope: string, attempts: PinAttempts | null) {
    if (attempts) this.attempts.set(`${householdId}|${scope}`, { ...attempts });
    else this.attempts.delete(`${householdId}|${scope}`);
  }

  async changesSince(householdId: string, since: number) {
    const h = this.get(householdId);
    if (since > h.state.rev || since < h.historyFromRev) return null;
    return { rev: h.state.rev, changes: h.log.filter((b) => b.rev > since).flatMap((b) => b.changes) };
  }
}
