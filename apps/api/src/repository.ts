import { type Command, type Snapshot, applyCommand, createSeed } from "@kinboard/shared";

/**
 * Persistence port. MVP: in-memory. Milestone M2 swaps in a Drizzle/PostgreSQL implementation
 * (each command = one transaction writing entity rows + a change_log row, then NOTIFY).
 */
export interface Repository {
  snapshot(householdId: string): Promise<Snapshot>;
  /** Applies a command atomically. Returns the new state and whether it was a replay of a known id. */
  apply(householdId: string, cmd: Command): Promise<{ state: Snapshot; replay: boolean }>;
}

export class InMemoryRepository implements Repository {
  private states = new Map<string, Snapshot>();
  private seen = new Map<string, Set<string>>(); // idempotency keys per household

  private get(id: string): Snapshot {
    let s = this.states.get(id);
    if (!s) {
      s = createSeed();
      this.states.set(id, s);
    }
    return s;
  }

  async snapshot(householdId: string) {
    return this.get(householdId);
  }

  async apply(householdId: string, cmd: Command) {
    const seen = this.seen.get(householdId) ?? new Set<string>();
    this.seen.set(householdId, seen);
    if (seen.has(cmd.id)) return { state: this.get(householdId), replay: true };
    const next = applyCommand(this.get(householdId), cmd); // throws DomainError on rejection
    this.states.set(householdId, next);
    seen.add(cmd.id);
    return { state: next, replay: false };
  }
}
