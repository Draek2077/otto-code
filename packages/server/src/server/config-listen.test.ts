import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";

const roots: string[] = [];

async function createOttoHome(config?: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "otto-config-listen-"));
  roots.push(root);
  const ottoHome = path.join(root, ".otto");
  await mkdir(ottoHome, { recursive: true });
  if (config) {
    await writeFile(path.join(ottoHome, "config.json"), JSON.stringify(config, null, 2));
  }
  return ottoHome;
}

describe("daemon listen address", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("defaults to 127.0.0.1 outside WSL", async () => {
    const ottoHome = await createOttoHome();
    const config = loadConfig(ottoHome, { env: {} });

    expect(config.listen).toBe("127.0.0.1:6868");
    expect(config.listenAutoWidenedForWsl).toBe(false);
  });

  test("defaults to 0.0.0.0 under WSL so the Windows host can reach it", async () => {
    const ottoHome = await createOttoHome();
    const config = loadConfig(ottoHome, { env: { WSL_DISTRO_NAME: "Ubuntu" } });

    expect(config.listen).toBe("0.0.0.0:6868");
    expect(config.listenAutoWidenedForWsl).toBe(true);
  });

  test("an explicit OTTO_LISTEN wins over WSL auto-detection", async () => {
    const ottoHome = await createOttoHome();
    const config = loadConfig(ottoHome, {
      env: { WSL_DISTRO_NAME: "Ubuntu", OTTO_LISTEN: "127.0.0.1:9999" },
    });

    expect(config.listen).toBe("127.0.0.1:9999");
    expect(config.listenAutoWidenedForWsl).toBe(false);
  });

  test("an explicit config.json listen wins over WSL auto-detection", async () => {
    const ottoHome = await createOttoHome({
      version: 1,
      daemon: { listen: "127.0.0.1:7777" },
    });
    const config = loadConfig(ottoHome, { env: { WSL_DISTRO_NAME: "Ubuntu" } });

    expect(config.listen).toBe("127.0.0.1:7777");
    expect(config.listenAutoWidenedForWsl).toBe(false);
  });
});
