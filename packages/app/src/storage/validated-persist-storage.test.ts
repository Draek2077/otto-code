import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { StateStorage } from "zustand/middleware";
import { createValidatedPersistStorage } from "./validated-persist-storage";
// OTTO(storage): preservation must not race the next store's hydration or writes.

class MemoryStorage implements StateStorage {
  readonly values = new Map<string, string>();

  getItem(name: string): string | null {
    return this.values.get(name) ?? null;
  }

  setItem(name: string, value: string): void {
    this.values.set(name, value);
  }

  removeItem(name: string): void {
    this.values.delete(name);
  }
}

const StateSchema = z.strictObject({ enabled: z.boolean() });

describe("createValidatedPersistStorage", () => {
  it("orders protected writes and hydration across store instances", async () => {
    const backing = new MemoryStorage();
    const name = "workspace-layout-state";
    backing.values.set(name, JSON.stringify({ state: { enabled: false, dormant: true } }));
    const source = createValidatedPersistStorage(backing, StateSchema);
    const restored = createValidatedPersistStorage(backing, StateSchema);
    const first = source.setItem(name, { state: { enabled: false } });
    const last = source.setItem(name, { state: { enabled: true } });
    await expect(restored.getItem(name)).resolves.toEqual({ state: { enabled: true } });
    await Promise.all([first, last]);
    expect(JSON.parse(backing.values.get(name)!)).toEqual({
      state: { enabled: true, dormant: true },
    });
    const removal = source.removeItem(name);
    await expect(restored.getItem(name)).resolves.toBeNull();
    await removal;
  });
  it.each([
    ["malformed JSON", "{"],
    ["invalid state", JSON.stringify({ state: { enabled: "yes" }, version: 1 })],
    ["unknown state fields", JSON.stringify({ state: { enabled: true, extra: true }, version: 1 })],
    [
      "unknown envelope fields",
      JSON.stringify({ state: { enabled: true }, version: 1, extra: true }),
    ],
  ])("clears %s", async (_label, stored) => {
    const backing = new MemoryStorage();
    backing.values.set("settings", stored);
    const storage = createValidatedPersistStorage(backing, StateSchema);

    await expect(storage.getItem("settings")).resolves.toBeNull();
    expect(backing.values.has("settings")).toBe(false);
  });

  it("returns schema-validated state", async () => {
    const backing = new MemoryStorage();
    backing.values.set("settings", JSON.stringify({ state: { enabled: true }, version: 1 }));
    const storage = createValidatedPersistStorage(backing, StateSchema);

    await expect(storage.getItem("settings")).resolves.toEqual({
      state: { enabled: true },
      version: 1,
    });
  });

  it("clears a value rejected by the schema before writing", async () => {
    const backing = new MemoryStorage();
    backing.values.set("settings", JSON.stringify({ state: { count: 1 } }));
    const storage = createValidatedPersistStorage(
      backing,
      z.strictObject({ count: z.number().finite() }),
    );

    await storage.setItem("settings", { state: { count: Number.NaN } });

    expect(backing.values.has("settings")).toBe(false);
  });
});
