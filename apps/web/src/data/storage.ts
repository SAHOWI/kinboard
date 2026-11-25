import type { Command, Snapshot } from "@kinboard/shared";

/** A command waiting for the server. `ackRev` is set once the server applied it at that revision. */
export interface OutboxEntry {
  cmd: Command;
  ackRev?: number;
}

/** What survives a reload: the last server-confirmed state and the commands not yet confirmed. */
export interface Persisted {
  base: Snapshot;
  outbox: OutboxEntry[];
}

export interface SyncStorage {
  load(): Promise<Persisted | undefined>;
  save(p: Persisted): Promise<void>;
}

export function memoryStorage(initial?: Persisted): SyncStorage {
  let value = initial ? structuredClone(initial) : undefined;
  return {
    load: async () => (value ? structuredClone(value) : undefined),
    save: async (p) => {
      value = structuredClone(p);
    },
  };
}

const DB = "kinboard";
const STORE = "sync";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB-backed storage under one key (one per device identity). Writes are serialised in order. */
export function indexedDbStorage(key: string): SyncStorage {
  const db = open();
  let last: Promise<void> = Promise.resolve();
  const run = <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) =>
    db.then(
      (d) =>
        new Promise<T>((resolve, reject) => {
          const req = fn(d.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }),
    );
  return {
    load: () => run<Persisted | undefined>("readonly", (s) => s.get(key)),
    save: (p) => {
      last = last.then(() => run("readwrite", (s) => s.put(p, key)).then(() => undefined)).catch(() => {});
      return last;
    },
  };
}
