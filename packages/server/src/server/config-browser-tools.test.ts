import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";

const roots: string[] = [];

async function createOttoHome(config: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "otto-config-browser-tools-"));
  roots.push(root);
  const ottoHome = path.join(root, ".otto");
  await mkdir(ottoHome, { recursive: true });
  await writeFile(path.join(ottoHome, "config.json"), JSON.stringify(config, null, 2));
  return ottoHome;
}

describe("daemon browser tools config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  // Browser tools drive real Otto tabs carrying logged-in sessions, so unlike
  // the Otto tools master they stay off until a human turns them on.
  test("defaults browser tools off when config is absent", async () => {
    const home = await createOttoHome({ version: 1 });

    expect(loadConfig(home, { env: {} }).browserToolsEnabled).toBe(false);
  });

  test("loads browser tools opt-in from persisted daemon config", async () => {
    const home = await createOttoHome({
      version: 1,
      daemon: { browserTools: { enabled: true } },
    });

    expect(loadConfig(home, { env: {} }).browserToolsEnabled).toBe(true);
  });
});
