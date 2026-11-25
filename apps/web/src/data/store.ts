import {
  type Actor,
  type Command,
  type CommandInput,
  type Snapshot,
  applyCommand,
  newId,
} from "@kinboard/shared";
import { create } from "zustand";
import { type Backend, DemoBackend, createBackend } from "./backend.ts";

export interface Toast {
  id: string;
  text: string;
  tone: "info" | "error" | "success";
}

interface Store {
  snapshot: Snapshot | null;
  backend: Backend | null;
  status: "loading" | "online" | "offline";
  toasts: Toast[];
  /** Command ids applied optimistically and not yet echoed by the backend. */
  pending: Set<string>;
  init(device: "display" | "app"): Promise<void>;
  dispatch(input: CommandInput, actor: Actor): Promise<boolean>;
  toast(text: string, tone?: Toast["tone"]): void;
}

export const useStore = create<Store>((set, get) => ({
  snapshot: null,
  backend: null,
  status: "loading",
  toasts: [],
  pending: new Set(),

  async init(device) {
    if (get().backend) return;
    let backend = createBackend(device);
    let snapshot: Snapshot;
    try {
      snapshot = await backend.load();
    } catch {
      // No server reachable → keep the UI usable with the in-browser demo backend.
      backend = new DemoBackend();
      snapshot = await backend.load();
      setTimeout(() => get().toast("Server not reachable: running in demo mode", "info"), 300);
    }
    set({ backend, snapshot, status: "online" });

    const resync = async () => {
      try {
        set({ snapshot: await backend.load(), pending: new Set(), status: "online" });
      } catch {
        set({ status: "offline" });
      }
    };
    backend.subscribe((e) => {
      const { snapshot: s, pending } = get();
      if (!s) return;
      if (e.type === "rev") return void resync();
      if (pending.has(e.command.id)) {
        pending.delete(e.command.id); // our own optimistic change, already applied
        return;
      }
      try {
        set({ snapshot: applyCommand(s, e.command) });
      } catch {
        void resync();
      }
    }, resync);
  },

  async dispatch(input, actor) {
    const { snapshot, backend } = get();
    if (!snapshot || !backend) return false;
    const cmd = { ...input, id: newId("cmd"), at: new Date().toISOString(), actor } as Command;
    let optimistic: Snapshot;
    try {
      optimistic = applyCommand(snapshot, cmd); // same rules as the server → instant feedback
    } catch (e) {
      get().toast((e as Error).message, "error");
      return false;
    }
    get().pending.add(cmd.id);
    set({ snapshot: optimistic });
    try {
      await backend.send(cmd);
      return true;
    } catch (e) {
      get().pending.delete(cmd.id);
      get().toast(`Not saved: ${(e as Error).message}`, "error");
      set({ snapshot: await backend.load().catch(() => snapshot) }); // roll back to server truth
      return false;
    }
  },

  toast(text, tone = "info") {
    const id = newId("t");
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
  },
}));
