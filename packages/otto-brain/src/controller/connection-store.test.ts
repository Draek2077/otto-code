import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { fixtureRoot } from "../../test-fixtures.js";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { BrainConnectionStore, BrainConnectionError } from "./connection-store.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(document?: unknown) {
  const root = mkdtempSync(path.join(fixtureRoot(), "otto-brain-connection-"));
  roots.push(root);
  const file = path.join(root, "otto-config.json");
  if (document !== undefined) writeFileSync(file, JSON.stringify(document));
  const store = new BrainConnectionStore(file);
  return { root, file, store };
}
function save(
  store: BrainConnectionStore,
  patch: unknown,
  credential: unknown = { action: "keep" },
) {
  return store.save({ expectedRevision: store.read().revision, patch, credential });
}

test("reads absent settings without creating files or a default home", () => {
  const f = fixture();
  expect(f.store.read()).toMatchObject({
    version: 1,
    config: { enabled: false, autoStart: false, mode: "local" },
  });
  expect(existsSync(f.file)).toBe(false);
  expect(existsSync(`${f.file}.brain.lock`)).toBe(false);
});
test("preserves legacy owner fields, unknown fields and unrelated feature data", () => {
  const f = fixture({
    workflows: { enabled: true },
    brain: {
      enabled: true,
      listen: { port: 4567 },
      runtime: { path: "preserve" },
      remote: { authToken: "old-key", futureSecret: "private-unknown", host: "old-host" },
      future: 42,
    },
  });
  const saved = save(f.store, { remote: { host: "new-host" } });
  expect(saved.config.remote.host).toBe("new-host");
  expect(JSON.stringify(saved)).not.toContain("old-key");
  expect(JSON.stringify(saved)).not.toContain("private-unknown");
  expect(JSON.parse(readFileSync(f.file, "utf8"))).toMatchObject({
    workflows: { enabled: true },
    brain: {
      listen: { port: 4567 },
      runtime: { path: "preserve" },
      remote: { authToken: "old-key", futureSecret: "private-unknown" },
      future: 42,
    },
  });
});
test("autostart and enable remain independent saved intentions", () => {
  const f = fixture();
  expect(save(f.store, { autoStart: true }).config).toMatchObject({
    autoStart: true,
    enabled: false,
  });
});
test("credential replacement is write-only and removal is explicit", () => {
  const f = fixture();
  const saved = save(f.store, {}, { action: "replace", value: "one-time-key" });
  expect(saved.credential).toEqual({ stored: true, effectiveSource: "stored" });
  expect(JSON.stringify(saved)).not.toContain("one-time-key");
  expect(save(f.store, { enabled: true }).credential.stored).toBe(true);
  expect(save(f.store, {}, { action: "remove" }).credential.stored).toBe(false);
});
test.each(["", " ", "key\nsecond"])(
  "rejects invalid credential without changing original bytes (%j)",
  (value) => {
    const f = fixture({ brain: { remote: { authToken: "existing" } } });
    const original = readFileSync(f.file, "utf8");
    expect(() => save(f.store, {}, { action: "replace", value })).toThrow(BrainConnectionError);
    expect(readFileSync(f.file, "utf8")).toBe(original);
  },
);
test("rejects an old originating revision without overwriting a peer feature edit", () => {
  const f = fixture({ brain: {} });
  const revision = f.store.read().revision;
  writeFileSync(f.file, JSON.stringify({ brain: {}, peer: true }));
  expect(() =>
    f.store.save({
      expectedRevision: revision,
      patch: { enabled: true },
      credential: { action: "keep" },
    }),
  ).toThrow("changed; reload");
  expect(JSON.parse(readFileSync(f.file, "utf8"))).toEqual({ brain: {}, peer: true });
  expect(existsSync(`${f.file}.brain.lock`)).toBe(false);
});
test.each(["{broken", "[]", '{"brain":null}', '{"brain":{"enabled":"wrong"}}'])(
  "leaves malformed configuration intact (%s)",
  (text) => {
    const f = fixture();
    writeFileSync(f.file, text);
    expect(() => f.store.read()).toThrow(BrainConnectionError);
    expect(readFileSync(f.file, "utf8")).toBe(text);
  },
);
test("retains an interrupted writer claim and refuses to overwrite it", () => {
  const f = fixture({ brain: {} });
  const lock = `${f.file}.brain.lock`;
  writeFileSync(lock, "other writer");
  expect(() => save(f.store, { enabled: true })).toThrow("locked");
  expect(readFileSync(lock, "utf8")).toBe("other writer");
});
test.each([
  { host: "https://brain.example/path" },
  { host: "brain.example", secure: false, certFingerprint: "aa" },
  { host: "brain.example", secure: true, certFingerprint: "invalid" },
])("validates a Remote connection before mutation without contacting it (%j)", (remote) => {
  const f = fixture();
  expect(() => save(f.store, { mode: "remote", remote })).toThrow("valid Remote Brain");
  expect(existsSync(f.file)).toBe(false);
  expect(existsSync(`${f.file}.brain.lock`)).toBe(false);
});
test("saves a valid remote endpoint without applying enable or starting any connection", () => {
  const f = fixture();
  expect(
    save(f.store, { mode: "remote", remote: { host: "brain.example", secure: true } }).config,
  ).toMatchObject({
    enabled: false,
    mode: "remote",
    remote: { host: "brain.example", secure: true },
  });
});
