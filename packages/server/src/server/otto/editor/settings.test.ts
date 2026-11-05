import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { EditorSettingsStore } from "./settings.js";

function fixture() {
  const base = path.resolve("../../.tmp/editor-settings-fixtures");
  mkdirSync(base, { recursive: true });
  return mkdtempSync(path.join(base, "home-"));
}
describe("host Code settings continuity", () => {
  it("clamps old unbounded numeric policy without rewriting the installed configuration", () => {
    const home = fixture();
    try {
      const legacy = JSON.stringify({
        daemon: {
          lsp: { maxRunningServers: 100, idleMinutes: 200, backgroundIdleMinutes: 300 },
          dotnetSolutionManagement: { enabled: true, maxRunningProbes: 30, idleMinutes: 400 },
        },
      });
      writeFileSync(path.join(home, "otto-config.json"), legacy);
      expect(new EditorSettingsStore(home).read().preferences).toMatchObject({
        maxRunningServers: 16,
        idleMinutes: 120,
        backgroundIdleMinutes: 120,
        solutionEnabled: true,
        solutionMaxProbes: 8,
        solutionIdleMinutes: 120,
      });
      expect(readFileSync(path.join(home, "otto-config.json"), "utf8")).toBe(legacy);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
  it("inherits 0.9 LSP policy without rewriting old settings or discarding unknown fields", () => {
    const home = fixture();
    try {
      const legacy = JSON.stringify({
        daemon: {
          lsp: { enabled: false, languages: { python: false, future: true }, maxRunningServers: 6 },
          brain: { enabled: true },
        },
      });
      writeFileSync(path.join(home, "otto-config.json"), legacy);
      const store = new EditorSettingsStore(home);
      const initial = store.read();
      expect(initial.preferences).toMatchObject({
        enabled: false,
        maxRunningServers: 6,
        languages: { python: false, future: true },
      });
      store.save(initial.revision, { enabled: true });
      expect(readFileSync(path.join(home, "otto-config.json"), "utf8")).toBe(legacy);
      const file = path.join(home, "editor", "settings.json");
      const document = JSON.parse(readFileSync(file, "utf8"));
      writeFileSync(file, JSON.stringify({ ...document, futureField: { retained: true } }));
      store.save(store.read().revision, { idleMinutes: 12 });
      expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
        futureField: { retained: true },
        languages: { future: true },
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
  it("refuses stale revisions and preserves malformed settings byte for byte", () => {
    const home = fixture();
    try {
      const store = new EditorSettingsStore(home),
        original = store.read();
      store.save(original.revision, { enabled: false });
      expect(() => store.save(original.revision, { enabled: true })).toThrow("changed");
      const file = path.join(home, "editor", "settings.json");
      writeFileSync(file, "{corrupt");
      expect(() => store.save("anything", { enabled: true })).toThrow();
      expect(readFileSync(file, "utf8")).toBe("{corrupt");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
