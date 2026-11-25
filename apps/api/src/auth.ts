import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Actor, Snapshot } from "@kinboard/shared";

/**
 * Who is calling. The server derives the command `Actor` from this; the client's actor is never trusted.
 *
 * TEMPORARY (until M2 step 3, better-auth + device pairing): identities come from unsigned dev tokens
 * `dev:display` and `dev:app:<memberId>`. They prove nothing, so they are refused in production unless
 * KINBOARD_DEV_AUTH=1 is set explicitly.
 */
export interface Identity {
  device: "display" | "app";
  /** The signed-in member on the app. Always null on the shared display. */
  memberId: string | null;
}

export const PIN_TTL_MS = 5 * 60_000; // spec §5.2
const MAX_PIN_FAILURES = 5;
const PIN_LOCKOUT_MS = 60_000;

export function bearerToken(header: string | undefined, query?: string): string | undefined {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  return m?.[1] ?? query;
}

export function parseDevToken(token: string | undefined, state: Snapshot): Identity | null {
  if (token === "dev:display") return { device: "display", memberId: null };
  const m = token?.match(/^dev:app:(\S+)$/);
  if (m && state.members.some((x) => x.id === m[1])) return { device: "app", memberId: m[1] };
  return null;
}

export const identityKey = (id: Identity) => `${id.device}:${id.memberId ?? ""}`;

/** Builds the actor for a command: elevation comes from the member's role (app) or a verified PIN (display). */
export function actorFor(id: Identity, state: Snapshot, displayElevated: boolean): Actor {
  if (id.device === "display") return { memberId: null, elevated: displayElevated, device: "display" };
  const role = state.members.find((m) => m.id === id.memberId)?.role;
  return { memberId: id.memberId, elevated: role === "adult", device: "app" };
}

/**
 * Adult PIN check for shared displays (FR-HH-08). Issues short-lived elevation tokens bound to one identity
 * and locks an identity out after repeated failures. In-memory for now. M2 (gap #2) moves the PIN to an
 * Argon2id hash on the household.
 */
export class PinGate {
  private tokens = new Map<string, { key: string; expires: number }>();
  private failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private pin: string | undefined,
    private now: () => number,
  ) {}

  get enabled() {
    return !!this.pin;
  }

  /** Returns a token, "locked" while the identity is rate-limited, or null for a wrong PIN. */
  verify(id: Identity, attempt: string): { token: string; ttlMs: number } | "locked" | null {
    const key = identityKey(id);
    const now = this.now();
    let f = this.failures.get(key);
    if (f && f.lockedUntil > now) return "locked";
    if (f?.lockedUntil) f = undefined; // an expired lockout starts a fresh count
    if (!this.pin || !safeEqual(attempt, this.pin)) {
      const count = (f?.count ?? 0) + 1;
      this.failures.set(key, { count, lockedUntil: count >= MAX_PIN_FAILURES ? now + PIN_LOCKOUT_MS : 0 });
      return null;
    }
    this.failures.delete(key);
    this.sweep(now);
    const token = randomBytes(32).toString("base64url");
    this.tokens.set(token, { key, expires: now + PIN_TTL_MS });
    return { token, ttlMs: PIN_TTL_MS };
  }

  isElevated(id: Identity, token: string | undefined): boolean {
    if (!token) return false;
    const t = this.tokens.get(token);
    return !!t && t.key === identityKey(id) && t.expires > this.now();
  }

  private sweep(now: number) {
    for (const [k, t] of this.tokens) if (t.expires <= now) this.tokens.delete(k);
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
