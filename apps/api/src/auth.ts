import { hkdfSync, randomBytes } from "node:crypto";
import type { Actor, Snapshot } from "@kinboard/shared";
import argon2 from "argon2";
import type { PinAttempts, PinStore } from "./repository.ts";

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
/** Per device: 5 wrong PINs lock it for a minute. */
const DEVICE_LIMIT = { failures: 5, windowMs: 15 * 60_000, lockMs: 60_000 };
/** Per household: 20 wrong PINs within an hour lock PIN entry everywhere for 15 minutes. */
const HOUSEHOLD_LIMIT = { failures: 20, windowMs: 60 * 60_000, lockMs: 15 * 60_000 };
const HOUSEHOLD_SCOPE = "*";
const PIN_FORMAT = /^\d{4,8}$/;
/** OWASP minimum for Argon2id (19 MiB, 2 passes, 1 lane): about 20–50 ms per check. */
const ARGON2 = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

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
 * A secret mixed into every PIN hash (Argon2 "secret"/pepper), derived from KINBOARD_MASTER_KEY.
 * A 4-digit PIN has only 10,000 values, so a leaked hash alone would be brute-forced in minutes; with the
 * pepper, the database is useless without the server's key. Changing the key invalidates the stored PIN.
 */
export function pinPepper(masterKeyBase64: string | undefined): Buffer | undefined {
  if (!masterKeyBase64) return undefined;
  const key = Buffer.from(masterKeyBase64, "base64");
  if (key.length < 32) throw new Error("KINBOARD_MASTER_KEY must be at least 32 bytes (base64)");
  return Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), "kinboard/pin-pepper/v1", 32));
}

export class PinFormatError extends Error {}

type VerifyResult = { token: string; ttlMs: number } | "locked" | "unset" | null;

/**
 * Adult PIN for shared displays (FR-HH-08, gap #2). The PIN is stored only as a peppered Argon2id hash on
 * the household. Wrong attempts are counted per device and per household in the store, so a restart does
 * not reset a lockout. Successful checks issue short-lived elevation tokens bound to one identity (kept in
 * memory: they live 5 minutes, and a restart only means entering the PIN again).
 */
export class PinGate {
  private tokens = new Map<string, { householdId: string; key: string; expires: number }>();
  /** One verification per household at a time, so parallel guesses cannot race past the counters. */
  private queues = new Map<string, Promise<unknown>>();
  private now: () => number;
  private pepper: Buffer | undefined;

  constructor(
    private store: PinStore,
    opts: { pepper?: Buffer; now?: () => number } = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.pepper = opts.pepper;
  }

  private get options() {
    return this.pepper ? { ...ARGON2, secret: this.pepper } : ARGON2;
  }

  /** Sets the household PIN and revokes all of its elevation tokens. Throws PinFormatError. */
  async setPin(householdId: string, pin: string): Promise<void> {
    if (!PIN_FORMAT.test(pin)) throw new PinFormatError("The PIN must be 4–8 digits");
    await this.store.setPinHash(householdId, await argon2.hash(pin, this.options));
    await this.store.setPinAttempts(householdId, HOUSEHOLD_SCOPE, null);
    for (const [t, v] of this.tokens) if (v.householdId === householdId) this.tokens.delete(t);
  }

  /** Sets `pin` only if the household has none yet (initial PIN from the environment). */
  async ensurePin(householdId: string, pin: string): Promise<void> {
    if (!(await this.store.getPinHash(householdId))) await this.setPin(householdId, pin);
  }

  /** A token, "locked" while rate-limited, "unset" when no PIN exists, or null for a wrong PIN. */
  verify(householdId: string, id: Identity, attempt: string): Promise<VerifyResult> {
    const run = (this.queues.get(householdId) ?? Promise.resolve()).then(() =>
      this.verifyNow(householdId, id, attempt),
    );
    const tail = run.catch(() => {});
    this.queues.set(householdId, tail);
    void tail.then(() => {
      if (this.queues.get(householdId) === tail) this.queues.delete(householdId);
    });
    return run;
  }

  private async verifyNow(householdId: string, id: Identity, attempt: string): Promise<VerifyResult> {
    const now = this.now();
    const scope = identityKey(id);
    const [device, household] = await Promise.all([
      this.store.getPinAttempts(householdId, scope),
      this.store.getPinAttempts(householdId, HOUSEHOLD_SCOPE),
    ]);
    if ((device?.lockedUntil ?? 0) > now || (household?.lockedUntil ?? 0) > now) return "locked";
    const hash = await this.store.getPinHash(householdId);
    if (!hash) return "unset";

    const ok =
      PIN_FORMAT.test(attempt) &&
      (await argon2.verify(hash, attempt, this.pepper ? { secret: this.pepper } : {}));
    if (!ok) {
      await Promise.all([
        this.store.setPinAttempts(householdId, scope, fail(device, now, DEVICE_LIMIT)),
        this.store.setPinAttempts(householdId, HOUSEHOLD_SCOPE, fail(household, now, HOUSEHOLD_LIMIT)),
      ]);
      return null;
    }
    await this.store.setPinAttempts(householdId, scope, null);
    if (argon2.needsRehash(hash, ARGON2))
      await this.store.setPinHash(householdId, await argon2.hash(attempt, this.options));
    for (const [t, v] of this.tokens) if (v.expires <= now) this.tokens.delete(t);
    const token = randomBytes(32).toString("base64url");
    this.tokens.set(token, { householdId, key: scope, expires: now + PIN_TTL_MS });
    return { token, ttlMs: PIN_TTL_MS };
  }

  isElevated(householdId: string, id: Identity, token: string | undefined): boolean {
    if (!token) return false;
    const t = this.tokens.get(token);
    return !!t && t.householdId === householdId && t.key === identityKey(id) && t.expires > this.now();
  }
}

/** Counts one failure in a sliding window; locks once the limit is reached. */
function fail(
  prev: PinAttempts | null,
  now: number,
  limit: { failures: number; windowMs: number; lockMs: number },
): PinAttempts {
  const fresh =
    !prev || now - prev.windowStart > limit.windowMs || (prev.lockedUntil && prev.lockedUntil <= now);
  const failures = fresh ? 1 : prev.failures + 1;
  const windowStart = fresh ? now : prev.windowStart;
  return { failures, windowStart, lockedUntil: failures >= limit.failures ? now + limit.lockMs : 0 };
}
