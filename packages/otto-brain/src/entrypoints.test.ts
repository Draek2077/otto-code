import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const roots: string[] = [];
function environment() {
  mkdirSync(fileURLToPath(new URL("../../../.tmp/", import.meta.url)), { recursive: true });
  const root = mkdtempSync(fileURLToPath(new URL("../../../.tmp/brain-entry-", import.meta.url)));
  roots.push(root);
  const home = path.join(root, "untouched-home");
  return { home, env: { ...process.env, OTTO_HOME: home } };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("imports public built entry points without touching a home or starting a host", () => {
  const { home, env } = environment();
  const urls = ["index", "config/index", "service/serve", "cli"].map(
    (name) => pathToFileURL(path.join(packageRoot, `dist/${name}.js`)).href,
  );
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `for (const url of ${JSON.stringify(urls)}) await import(url);`],
    { env, encoding: "utf8", timeout: 5000, windowsHide: true },
  );
  expect(child.stderr).toBe("");
  expect(child.status).toBe(0);
  expect(existsSync(home)).toBe(false);
});

it("standalone help succeeds without reading or creating user configuration", () => {
  const { home, env } = environment();
  const child = spawnSync(process.execPath, [path.join(packageRoot, "bin/otto-brain"), "--help"], {
    env,
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  expect(child.stderr).toBe("");
  expect(child.status).toBe(0);
  expect(child.stdout).toContain("Otto Brain standalone host");
  expect(existsSync(home)).toBe(false);
});
