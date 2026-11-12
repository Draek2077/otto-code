import path from "node:path";
import { tmpdir } from "node:os";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { GitFetchSettingsStore } from "./settings.js";

const roots: string[] = [];
function prepare() {
  const home = mkdtempSync(path.join(tmpdir(), "otto-git-policy-"));
  roots.push(home);
  const file = path.join(home, "workspace-git", "settings.json");
  return {
    home,
    file,
    legacy: path.join(home, "otto-config.json"),
    store: new GitFetchSettingsStore(home),
  };
}
afterEach(() => {
  for (const home of roots.splice(0)) rmSync(home, { recursive: true, force: true });
});

test("reading defaults or saving no change creates no settings file", () => {
  const f = prepare(),
    initial = f.store.read();
  expect(initial.preferences).toEqual({ enabled: true, intervalSeconds: 180 });
  expect(f.store.save(initial.revision, {})).toEqual(initial);
  expect(existsSync(path.dirname(f.file))).toBe(false);
});

test("inherits the 0.9 opt-out and interval without rewriting any legacy data", () => {
  const f = prepare();
  const original =
    '{"daemon":{"gitFetch":{"enabled":false,"intervalSeconds":900,"future":"kept"}},"other":{"sentinel":"keep-exact-bytes"}}\n';
  writeFileSync(f.legacy, original);
  const initial = f.store.read();
  expect(initial.preferences).toEqual({ enabled: false, intervalSeconds: 900 });
  expect(existsSync(f.file)).toBe(false);
  const saved = f.store.save(initial.revision, { intervalSeconds: 600 });
  expect(saved.preferences).toEqual({ enabled: false, intervalSeconds: 600 });
  expect(readFileSync(f.legacy, "utf8")).toBe(original);
  writeFileSync(f.legacy, "corrupted after explicit replacement");
  expect(f.store.read()).toEqual(saved);
});

test("a save preserves all unknown owned fields, including inert prototype-looking JSON keys", () => {
  const f = prepare();
  mkdirSync(path.dirname(f.file));
  writeFileSync(
    f.file,
    '{"version":1,"enabled":true,"intervalSeconds":180,"future":{"keep":7},"__proto__":{"retained":true}}',
  );
  const initial = f.store.read();
  f.store.save(initial.revision, { enabled: false });
  const raw = JSON.parse(readFileSync(f.file, "utf8"));
  expect(raw.future).toEqual({ keep: 7 });
  expect(Object.hasOwn(raw, "__proto__")).toBe(true);
  expect(Reflect.get(raw, "__proto__")).toEqual({ retained: true });
  expect(f.store.read().preferences).toEqual({ enabled: false, intervalSeconds: 180 });
});

test("stale writers cannot replace a peer's policy or unknown fields", () => {
  const f = prepare(),
    initial = f.store.read();
  const accepted = f.store.save(initial.revision, { enabled: false });
  const bytes = readFileSync(f.file, "utf8");
  expect(() => f.store.save(initial.revision, { intervalSeconds: 60 })).toThrow(
    "Reload before saving",
  );
  expect(readFileSync(f.file, "utf8")).toBe(bytes);
  expect(f.store.read()).toEqual(accepted);
});

test("a changed inherited policy also conflicts before creating a replacement", () => {
  const f = prepare();
  writeFileSync(f.legacy, '{"daemon":{"gitFetch":{"enabled":false}}}');
  const initial = f.store.read();
  const changed = '{"daemon":{"gitFetch":{"enabled":false,"intervalSeconds":300}}}';
  writeFileSync(f.legacy, changed);
  expect(() => f.store.save(initial.revision, { enabled: true })).toThrow("Reload before saving");
  expect(existsSync(f.file)).toBe(false);
  expect(readFileSync(f.legacy, "utf8")).toBe(changed);
});

test.each([
  ["malformed", "{broken"],
  ["future version", '{"version":2,"enabled":false,"intervalSeconds":60}'],
  ["invalid interval", '{"version":1,"enabled":false,"intervalSeconds":1}'],
  ["oversized", "x".repeat(2 * 1024 * 1024 + 1)],
])("refuses %s settings without changing their bytes", (_label, original) => {
  const f = prepare();
  mkdirSync(path.dirname(f.file));
  writeFileSync(f.file, original);
  expect(() => f.store.read()).toThrow("Existing files were left unchanged");
  expect(() => f.store.save("untrusted-revision", { enabled: true })).toThrow();
  expect(readFileSync(f.file, "utf8")).toBe(original);
});

test("rejects invalid patches before writing a settings directory", () => {
  const f = prepare(),
    initial = f.store.read();
  expect(() => f.store.save(initial.revision, { intervalSeconds: 1 })).toThrow();
  expect(() => f.store.save(initial.revision, { unknown: true })).toThrow();
  expect(existsSync(path.dirname(f.file))).toBe(false);
});

test("a file in place of the settings directory is preserved", () => {
  const f = prepare();
  writeFileSync(path.dirname(f.file), "leave-me-alone");
  expect(() => f.store.read()).toThrow("Existing files were left unchanged");
  expect(readFileSync(path.dirname(f.file), "utf8")).toBe("leave-me-alone");
});
