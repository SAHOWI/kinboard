import { describe, expect, it } from "vitest";
import { type Identity, PinGate, pinPepper } from "./auth.ts";
import { InMemoryRepository } from "./repository.ts";

const HH = "hh_1";
const display: Identity = { device: "display", memberId: null };
/** A different device identity each time (attackers rotating devices). */
const device = (i: number): Identity => ({ device: "display", memberId: `d${i}` });

describe("PinGate (gap #2, FR-HH-08)", () => {
  it("stores only an Argon2id hash, peppered with the server key", async () => {
    const store = new InMemoryRepository();
    const gate = new PinGate(store, { pepper: pinPepper(Buffer.alloc(32, 7).toString("base64")) });
    await gate.setPin(HH, "2468");
    const hash = await store.getPinHash(HH);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toContain("2468");
    expect(await gate.verify(HH, display, "2468")).toMatchObject({ ttlMs: 300_000 });

    // The same hash without (or with another) server key is useless, e.g. after a database leak.
    const elsewhere = new PinGate(store, { pepper: pinPepper(Buffer.alloc(32, 9).toString("base64")) });
    expect(await elsewhere.verify(HH, display, "2468")).toBeNull();
    expect(await new PinGate(store).verify(HH, display, "2468")).toBeNull();
  });

  it("accepts only 4 to 8 digits", async () => {
    const gate = new PinGate(new InMemoryRepository());
    for (const bad of ["123", "123456789", "12a4", " 1234", ""])
      await expect(gate.setPin(HH, bad)).rejects.toThrow(/4.8 digits/);
    await gate.setPin(HH, "12345678");
  });

  it("reports an unset PIN and keeps an existing one when ensuring the initial PIN", async () => {
    const store = new InMemoryRepository();
    const gate = new PinGate(store);
    expect(await gate.verify(HH, display, "1234")).toBe("unset");
    await gate.ensurePin(HH, "1234");
    await gate.setPin(HH, "9753");
    await gate.ensurePin(HH, "1234"); // a restart with KINBOARD_PIN must not undo a changed PIN
    expect(await gate.verify(HH, display, "9753")).toMatchObject({ ttlMs: 300_000 });
  });

  it("locks the whole household after 20 failures within an hour, even across devices", async () => {
    let clock = 1_000_000;
    const gate = new PinGate(new InMemoryRepository(), { now: () => clock });
    await gate.setPin(HH, "2468");
    for (let i = 0; i < 20; i++) expect(await gate.verify(HH, device(i), "0000")).toBeNull();
    expect(await gate.verify(HH, device(99), "2468")).toBe("locked");
    clock += 15 * 60_000 + 1;
    expect(await gate.verify(HH, device(99), "2468")).toMatchObject({ ttlMs: 300_000 });
  });

  it("invalidates elevation tokens when the PIN changes", async () => {
    const gate = new PinGate(new InMemoryRepository());
    await gate.setPin(HH, "2468");
    const ok = await gate.verify(HH, display, "2468");
    if (!ok || typeof ok === "string") throw new Error("expected a token");
    expect(gate.isElevated(HH, display, ok.token)).toBe(true);
    await gate.setPin(HH, "9753");
    expect(gate.isElevated(HH, display, ok.token)).toBe(false);
  });
});
