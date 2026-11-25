import type { Actor, CommandInput } from "@kinboard/shared";
import { createContext, useContext } from "react";

export type DisplayView = "home" | "calendar" | "tasks" | "lists" | "rewards" | "meals";

export interface DisplayCtx {
  view: DisplayView;
  setView(v: DisplayView): void;
  /** Members currently visible (header avatar filter, FR-CAL-04). */
  filter: Set<string>;
  toggleFilter(id: string): void;
  elevated: boolean;
  /** Runs `fn` immediately if the adult PIN is unlocked, otherwise asks for it first. */
  withPin(fn: () => void): void;
  lock(): void;
  /** Dispatch from the shared display as a given member (or nobody). */
  run(input: CommandInput, memberId?: string | null): Promise<boolean>;
  actor(memberId?: string | null): Actor;
}

export const DisplayContext = createContext<DisplayCtx | null>(null);
export const useDisplay = () => {
  const c = useContext(DisplayContext);
  if (!c) throw new Error("DisplayContext missing");
  return c;
};
