import { expect, test } from "vitest";
import {
  CONTEXT_LAYOUT_KEY,
  ContextLayoutPreferences,
  contextReadingWidth,
} from "./layout-preferences";
function fixture(initial: [string, string][] = []) {
  const values = new Map(initial);
  const writes: string[] = [];
  const storage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      writes.push(key);
      values.set(key, value);
    },
  };
  return { values, writes, storage, model: new ContextLayoutPreferences(storage) };
}
test("old Context width is restored without writing panel-state or unrelated preferences", async () => {
  const raw = JSON.stringify({
    state: { contextSidebarWidth: 410, unknownOttoSetting: "preserve" },
    version: 8,
  });
  const f = fixture([["panel-state", raw]]);
  await f.model.load();
  expect(f.model.getSnapshot()).toMatchObject({
    width: 410,
    summaryRatio: 0.5,
    loaded: true,
    error: "",
  });
  expect(f.writes).toEqual([]);
  await f.model.set({ summaryRatio: 0.65 });
  expect(f.writes).toEqual([CONTEXT_LAYOUT_KEY]);
  expect(f.values.get("panel-state")).toBe(raw);
  const restored = new ContextLayoutPreferences(f.storage);
  await restored.load();
  expect(restored.getSnapshot()).toMatchObject({ width: 410, summaryRatio: 0.65 });
});
test("new preferences preserve future fields and take priority over dormant 0.9 values", async () => {
  const f = fixture([
    [
      CONTEXT_LAYOUT_KEY,
      JSON.stringify({ version: 1, width: 450, summaryRatio: 0.6, future: "retain" }),
    ],
    ["panel-state", JSON.stringify({ state: { contextSidebarWidth: 300 } })],
  ]);
  await f.model.load();
  await f.model.set({ width: 500 });
  expect(JSON.parse(f.values.get(CONTEXT_LAYOUT_KEY)!)).toEqual({
    version: 1,
    width: 500,
    summaryRatio: 0.6,
    future: "retain",
  });
});
test("malformed or newer own data is preserved and cannot be silently replaced by a drag", async () => {
  const raw = '{"version":99,"width":410,"future":true}';
  const f = fixture([[CONTEXT_LAYOUT_KEY, raw]]);
  await f.model.load();
  await f.model.set({ width: 500 });
  expect(f.model.getSnapshot().error).toContain("Existing saved data was preserved");
  expect(f.values.get(CONTEXT_LAYOUT_KEY)).toBe(raw);
  expect(f.writes).toEqual([]);
});
test("a failed save remains visible and a new explicit adjustment can save again", async () => {
  const f = fixture();
  let denied = true;
  const model = new ContextLayoutPreferences({
    ...f.storage,
    setItem: async (key, value) => {
      if (denied) throw Error("fixture denial");
      await f.storage.setItem(key, value);
    },
  });
  await model.load();
  await model.set({ width: 420 });
  expect(model.getSnapshot()).toMatchObject({ width: 420 });
  expect(model.getSnapshot().error).toContain("could not be saved");
  denied = false;
  await model.set({ width: 430 });
  expect(model.getSnapshot().error).toBe("");
  expect(JSON.parse(f.values.get(CONTEXT_LAYOUT_KEY)!)).toMatchObject({ width: 430 });
});
test("narrow and hidden geometry is bounded without changing the saved desktop preference", async () => {
  const f = fixture([
    [CONTEXT_LAYOUT_KEY, JSON.stringify({ version: 1, width: 720, summaryRatio: 0.5 })],
  ]);
  await f.model.load();
  expect(contextReadingWidth(720, 0)).toBe(0);
  expect(contextReadingWidth(720, 600)).toBe(300);
  expect(contextReadingWidth(720, 1000)).toBe(640);
  expect(f.model.getSnapshot().width).toBe(720);
  expect(f.writes).toEqual([]);
});
