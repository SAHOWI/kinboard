import { type Actor, type Command, type CommandInput, type Snapshot, newId } from "@kinboard/shared";
import { create } from "zustand";
import { type Backend, DemoBackend, createBackend } from "./backend.ts";
import { indexedDbStorage, memoryStorage } from "./storage.ts";
import { SyncEngine, type SyncStatus } from "./sync.ts";

export interface Toast {
  id: string;
  text: string;
  tone: "info" | "error" | "success";
}

interface Store {
  /** What the UI shows: the server-confirmed state plus this device's queued commands. */
  snapshot: Snapshot | null;
  backend: Backend | null;
  status: SyncStatus;
  /** Commands queued on this device that the server has not confirmed yet (shown while offline). */
  pending: number;
  toasts: Toast[];
  init(device: "display" | "app"): Promise<void>;
  /** Queues a command (applied optimistically at once). False when it is rejected locally. */
  dispatch(input: CommandInput, actor: Actor): Promise<boolean>;
  /** Checks the adult PIN with the backend. Resolves to the elevation lifetime in ms, or null. */
  verifyPin(pin: string): Promise<number | null>;
  lock(): void;
  /** Sets the household PIN as this adult. Toasts the outcome; true on success. */
  setPin(pin: string, memberId: string): Promise<boolean>;
  toast(text: string, tone?: Toast["tone"]): void;
}

let engine: SyncEngine | null = null;

export const useStore = create<Store>((set, get) => ({
  snapshot: null,
  backend: null,
  status: "loading",
  pending: 0,
  toasts: [],

  async init(device) {
    if (engine) return;
    const make = (backend: Backend & { cacheKey?: string }) =>
      new SyncEngine(
        backend,
        // The demo starts fresh every time; a real server's state is cached per server and identity.
        backend.cacheKey ? indexedDbStorage(backend.cacheKey) : memoryStorage(),
        {
          onChange: (e) => set({ snapshot: e.view(), status: e.status, pending: e.pending }),
          onRejected: (_cmd, message) => get().toast(`Not saved: ${message}`, "error"),
          onNotice: (text) => get().toast(text, "info"),
          schedule: (fn, ms) => setTimeout(fn, ms),
        },
      );

    let backend: Backend = createBackend(device);
    engine = make(backend);
    if (!(await engine.start())) {
      // No server and nothing cached → keep the UI usable with the in-browser demo backend.
      backend = new DemoBackend();
      engine = make(backend);
      await engine.start();
      setTimeout(() => get().toast("Server not reachable: running in demo mode", "info"), 300);
    }
    set({ backend });
    const e = engine;
    window.addEventListener("online", () => void e.retryNow());
  },

  async dispatch(input, actor) {
    if (!engine) return false;
    const cmd = { ...input, id: newId("cmd"), at: new Date().toISOString(), actor } as Command;
    return engine.dispatch(cmd);
  },

  async verifyPin(pin) {
    const backend = get().backend;
    if (!backend) return null;
    try {
      return await backend.verifyPin(pin);
    } catch (e) {
      get().toast((e as Error).message, "error"); // e.g. locked out, or offline
      return null;
    }
  },

  lock() {
    get().backend?.lock();
  },

  async setPin(pin, memberId) {
    const backend = get().backend;
    if (!backend) return false;
    try {
      await backend.setPin(pin, memberId);
      get().toast("Family PIN updated", "success");
      return true;
    } catch (e) {
      get().toast((e as Error).message, "error");
      return false;
    }
  },

  toast(text, tone = "info") {
    const id = newId("t");
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
  },
}));
