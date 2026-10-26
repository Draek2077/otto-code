import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PreviewStartGate } from "./start-gate.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const entry = { name: "web", runtimeExecutable: "npm", runtimeArgs: ["run", "dev"], port: 8200 };
async function fixture(value: unknown = { configurations: [entry] }) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "otto-preview-approval-"));
  roots.push(cwd);
  await mkdir(path.join(cwd, ".claude"));
  const file = path.join(cwd, ".claude", "launch.json");
  await writeFile(file, JSON.stringify(value));
  const gate = new PreviewStartGate(cwd);
  await gate.capture();
  return { gate, file };
}
test("pre-authored launch identity remains approved across destination changes", async () => {
  const f = await fixture();
  const before = await f.gate.resolve("web");
  expect(before.changed).toBe(false);
  expect(before.command).toBe('"npm" "run" "dev"');
  await writeFile(
    f.file,
    JSON.stringify({ configurations: [{ ...entry, url: "https://preview.example/app" }] }),
  );
  expect((await f.gate.resolve("web")).revision).toBe(before.revision);
  expect((await f.gate.resolve("web")).changed).toBe(false);
});
test("new or edited executable, arguments and environment cannot inherit approval", async () => {
  const f = await fixture();
  for (const changed of [
    { ...entry, runtimeExecutable: "python" },
    { ...entry, runtimeArgs: ["run", "other"] },
    { ...entry, env: { SCRIPT: "other" } },
    { ...entry, name: "new" },
  ]) {
    await writeFile(f.file, JSON.stringify({ configurations: [changed] }));
    const approval = await f.gate.resolve(changed.name);
    expect(approval.changed).toBe(true);
    await f.gate.capture();
    expect((await f.gate.resolve(changed.name)).changed).toBe(true);
  }
});
test("approval rebases only the exact reviewed command and refuses a concurrent edit", async () => {
  const f = await fixture();
  await writeFile(
    f.file,
    JSON.stringify({ configurations: [{ ...entry, runtimeArgs: ["run", "next"] }] }),
  );
  const approval = await f.gate.resolve("web");
  expect(approval.changed).toBe(true);
  await f.gate.accept(approval);
  expect((await f.gate.resolve("web")).changed).toBe(false);
  await writeFile(
    f.file,
    JSON.stringify({ configurations: [{ ...entry, runtimeArgs: ["run", "another"] }] }),
  );
  await expect(f.gate.accept(approval)).rejects.toThrow("changed during approval");
  expect((await f.gate.resolve("web")).changed).toBe(true);
});
test("malformed initial configuration grants nothing and keeps its bytes", async () => {
  const f = await fixture({ configurations: "invalid" });
  const original = await readFile(f.file);
  await expect(f.gate.resolve("web")).rejects.toThrow("Invalid launch");
  expect(await readFile(f.file)).toEqual(original);
  await writeFile(f.file, JSON.stringify({ configurations: [entry] }));
  expect((await f.gate.resolve("web")).changed).toBe(true);
});
