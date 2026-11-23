import { expect, it } from "vitest";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const schema = z.strictObject({
  entries: z.record(z.string(), z.strictObject({ enabled: z.boolean() })),
  tabs: z.array(z.strictObject({ id: z.string(), title: z.string() })),
});
function memory(initial: unknown) {
  const values = new Map([["panel-state", JSON.stringify(initial)]]);
  const backing = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: async (key: string) => {
      values.delete(key);
    },
  };
  return { values, storage: createValidatedPersistStorage(backing, schema) };
}

it("reads supported old preferences without rejecting their Otto fields or leaking those fields into runtime state", async () => {
  const original = {
    state: {
      entries: { first: { enabled: true, brain: { model: "local" } } },
      tabs: [],
      visualizer: { mode: "pip" },
    },
    version: 16,
  };
  const { values, storage } = memory(original);
  expect(await storage.getItem("panel-state")).toEqual({
    state: { entries: { first: { enabled: true } }, tabs: [] },
    version: 16,
  });
  expect(JSON.parse(values.get("panel-state")!)).toEqual(original);
});

it("retains nested Otto fields through setting changes without resurrecting removed entries or tabs", async () => {
  const { values, storage } = memory({
    state: {
      entries: { kept: { enabled: false, ottoOnly: 7 }, removed: { enabled: true, ottoOnly: 8 } },
      tabs: [
        { id: "kept", title: "old", ottoOnly: "metadata" },
        { id: "removed", title: "gone", ottoOnly: "deleted" },
      ],
      brain: { model: "local" },
    },
    version: 16,
  });
  await storage.setItem("panel-state", {
    state: { entries: { kept: { enabled: true } }, tabs: [{ id: "kept", title: "new" }] },
    version: 16,
  });
  expect(JSON.parse(values.get("panel-state")!)).toEqual({
    state: {
      entries: { kept: { enabled: true, ottoOnly: 7 } },
      tabs: [{ id: "kept", title: "new", ottoOnly: "metadata" }],
      brain: { model: "local" },
    },
    version: 16,
  });
  expect((await storage.getItem("panel-state"))?.state).toEqual({
    entries: { kept: { enabled: true } },
    tabs: [{ id: "kept", title: "new" }],
  });
});

it("still rejects invalid supported values", async () => {
  const { storage } = memory({
    state: { entries: { invalid: { enabled: "yes", ottoOnly: 1 } }, tabs: [] },
    version: 16,
  });
  expect(await storage.getItem("panel-state")).toBeNull();
});

it("preserves own properties safely without assigning object prototypes", async () => {
  const original = JSON.parse(
    '{"state":{"entries":{"kept":{"enabled":false,"__proto__":{"polluted":true}}},"tabs":[]},"version":16}',
  );
  const { values, storage } = memory(original);
  await storage.setItem("panel-state", {
    state: { entries: { kept: { enabled: true } }, tabs: [] },
    version: 16,
  });
  const written = JSON.parse(values.get("panel-state")!);
  expect(Object.hasOwn(written.state.entries.kept, "__proto__")).toBe(true);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});
