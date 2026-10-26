import { expect, test, vi } from "vitest";
import type { ContextReport } from "@getpaseo/plugin/otto/context-management";
import {
  contextHealthWarning,
  contextModelWindow,
  ContextHealthPreferences,
  CONTEXT_WARNING_PREFERENCE,
  CONTEXT_WARNING_MUTE_MS,
} from "./health-model";

function report(patch: Partial<ContextReport> = {}): ContextReport {
  return {
    revision: "v1",
    workspaceId: "workspace",
    provider: "fixture",
    agentId: "agent",
    capturedAt: "now",
    windowTokens: 200000,
    categories: [],
    nodes: [],
    edges: [],
    findings: [],
    fixedTokens: 50000,
    workingRoom: 150000,
    sharePercent: 25,
    severity: "warn",
    preparedRequest: null,
    instructionState: "ready",
    ...patch,
  };
}
function fixture(raw: string | null = null, legacy: boolean | undefined = undefined) {
  const values = new Map<string, string>();
  if (raw !== null) values.set(CONTEXT_WARNING_PREFERENCE, raw);
  const setItem = vi.fn(async (key: string, value: string) => {
    values.set(key, value);
  });
  const model = new ContextHealthPreferences({
    getItem: async (key) => values.get(key) ?? null,
    setItem,
    legacyEnabled: async () => legacy,
  });
  return { model, values, setItem };
}
test("fixed weight is assessed against the known model window, not a viewing-window guess", () => {
  expect(contextHealthWarning(report(), null)).toBeNull();
  expect(contextHealthWarning(report(), 1000000)).toBeNull();
  expect(contextHealthWarning(report(), 200000)?.summary).toContain("25.0%");
});
test("live window wins over catalog metadata and invalid values remain unknown", () => {
  expect(contextModelWindow(200000, 100000)).toBe(200000);
  expect(contextModelWindow(null, 32768)).toBe(32768);
  expect(contextModelWindow(0, 32768)).toBe(32768);
  expect(contextModelWindow(Number.NaN, undefined)).toBeNull();
  expect(contextModelWindow(null, Number.POSITIVE_INFINITY)).toBeNull();
});
test("missing required context warns even when the provider window is unknown", () => {
  const warning = contextHealthWarning(report({ instructionState: "blocked" }), null);
  expect(warning?.severity).toBe("blocked");
  expect(warning?.summary).toContain("unknown");
  expect(warning?.summary).not.toContain("%");
});
test.each([0, 10000, 49999])(
  "small fixed estimates do not raise a composer warning",
  (fixedTokens) => {
    expect(contextHealthWarning(report({ fixedTokens }), 200000)).toBeNull();
  },
);
test("convention estimates are labeled, and only an actual blocked/full window gets the red state", () => {
  const convention = report({
    categories: [
      {
        category: "context_files",
        visibility: "convention",
        estimatedTokens: 50000,
        explanation: "native estimate",
      },
    ],
  });
  expect(contextHealthWarning(convention, 100000)).toMatchObject({
    severity: "warning",
    summary: expect.stringContaining("Provider convention estimate"),
  });
  expect(contextHealthWarning(convention, 50000)?.severity).toBe("blocked");
});
test("mute is shared by workspace across chats, expires and breaks through on severity or size change", () => {
  const { model } = fixture();
  const warning = contextHealthWarning(report(), 200000)!;
  model.mute("host", "workspace", warning, 100);
  expect(model.mutedUntil("host", "workspace", warning, 101, 0)).toBeNull();
  expect(model.mutedUntil("host", "workspace", warning, 101)).toBe(100 + CONTEXT_WARNING_MUTE_MS);
  expect(model.mutedUntil("host", "other", warning, 101)).toBeNull();
  expect(model.mutedUntil("other", "workspace", warning, 101)).toBeNull();
  expect(
    model.mutedUntil(
      "host",
      "workspace",
      contextHealthWarning(report({ fixedTokens: 60000 }), 200000)!,
      101,
    ),
  ).toBeNull();
  expect(
    model.mutedUntil(
      "host",
      "workspace",
      contextHealthWarning(report({ instructionState: "blocked" }), 200000)!,
      101,
    ),
  ).toBeNull();
  expect(model.mutedUntil("host", "workspace", warning, 100 + CONTEXT_WARNING_MUTE_MS)).toBeNull();
});
test("tuple workspace identities cannot collide at punctuation boundaries", () => {
  const { model } = fixture();
  const warning = contextHealthWarning(report(), 200000)!;
  model.mute("a:b", "c", warning, 0);
  expect(model.mutedUntil("a", "b:c", warning, 1)).toBeNull();
});
test.each([true, false])(
  "first read honors the explicit preserved 0.9 enabled choice without writing it",
  async (legacy) => {
    const { model, setItem } = fixture(null, legacy);
    await model.load();
    expect(model.getSnapshot().enabled).toBe(legacy);
    expect(setItem).not.toHaveBeenCalled();
  },
);
test("current preference wins over preserved settings and unknown fields survive a write", async () => {
  const { model, values } = fixture(
    JSON.stringify({ version: 1, enabled: true, unknown: { retained: 1 } }),
    false,
  );
  await model.load();
  expect(model.getSnapshot().enabled).toBe(true);
  await model.setEnabled(false);
  expect(JSON.parse(values.get(CONTEXT_WARNING_PREFERENCE)!)).toEqual({
    version: 1,
    enabled: false,
    unknown: { retained: 1 },
  });
});
test.each(["invalid", '{"version":2,"enabled":false}', '{"version":1,"enabled":"no"}'])(
  "unsupported preference bytes are preserved and write-blocked",
  async (raw) => {
    const { model, values, setItem } = fixture(raw);
    await model.load();
    await model.setEnabled(false);
    expect(model.getSnapshot().writable).toBe(false);
    expect(model.getSnapshot().error).toContain("preserved");
    expect(values.get(CONTEXT_WARNING_PREFERENCE)).toBe(raw);
    expect(setItem).not.toHaveBeenCalled();
  },
);
test("a failed setting write keeps the accepted value and permits only a new explicit attempt", async () => {
  const { model, setItem } = fixture();
  await model.load();
  setItem.mockRejectedValueOnce(Error("offline"));
  await model.setEnabled(false);
  expect(model.getSnapshot().enabled).toBe(true);
  expect(model.getSnapshot().error).toContain("previous choice");
  expect(setItem).toHaveBeenCalledTimes(1);
  await model.setEnabled(false);
  expect(model.getSnapshot().enabled).toBe(false);
});
test("the setting mutation lane rejects duplicate pending writes", async () => {
  const { model, setItem } = fixture();
  await model.load();
  let finish!: () => void;
  setItem.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const first = model.setEnabled(false);
  await model.setEnabled(false);
  expect(setItem).toHaveBeenCalledTimes(1);
  finish();
  await first;
  expect(model.getSnapshot().enabled).toBe(false);
});
test("explicit reload recovers supported preference data without automatic overwrite", async () => {
  const { model, values } = fixture("invalid");
  await model.load();
  values.set(CONTEXT_WARNING_PREFERENCE, '{"version":1,"enabled":false}');
  await model.load();
  expect(model.getSnapshot().writable).toBe(false);
  await model.reload();
  expect(model.getSnapshot()).toMatchObject({ enabled: false, writable: true, error: "" });
});
