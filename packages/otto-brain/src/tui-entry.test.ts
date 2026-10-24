import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureRoot } from "../test-fixtures.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function invoke(args: string[]) {
  const home = mkdtempSync(path.join(fixtureRoot(), "brain-tty-entry-"));
  roots.push(home);
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../bin/otto-brain", import.meta.url)), ...args],
    {
      env: { ...process.env, OTTO_HOME: home, PASEO_HOME: home },
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return { result, home };
}
describe("packed standalone terminal entry", () => {
  it("keeps help passive while registering the interactive entry", () => {
    const { result, home } = invoke(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ui");
    expect(readdirSync(home)).toEqual([]);
  });
  it.each([{ args: [] }, { args: ["ui"] }])(
    "validates both terminal streams before opening or starting a host",
    ({ args }) => {
      const { result, home } = invoke(args);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("interactive UI");
      expect(readdirSync(home)).toEqual([]);
    },
  );
});
