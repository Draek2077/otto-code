import { afterEach, beforeEach, describe, expect, test } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { migrateProfileStorePaths } from "./profile-store-paths.migration.js";

// COMPAT(profileStorePaths): added in v0.8.13, remove after 2027-02-22.
// These paths hold accrued lessons and spawn counts - real user data - so the
// migration is a rename and every case here is about not losing any of it.
describe("migrateProfileStorePaths", () => {
  let ottoHome: string;
  const logger = createTestLogger();

  beforeEach(() => {
    ottoHome = mkdtempSync(path.join(os.tmpdir(), "otto-profile-paths-"));
  });

  afterEach(() => {
    rmSync(ottoHome, { recursive: true, force: true });
  });

  async function writeMemory(dirName: string, contents: string): Promise<void> {
    const dir = path.join(ottoHome, dirName);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "p-sage.json"), contents, "utf8");
  }

  async function writeStats(fileName: string, contents: string): Promise<void> {
    await fs.mkdir(path.join(ottoHome, "stats"), { recursive: true });
    await fs.writeFile(path.join(ottoHome, "stats", fileName), contents, "utf8");
  }

  async function read(relative: string): Promise<string | null> {
    try {
      return await fs.readFile(path.join(ottoHome, relative), "utf8");
    } catch {
      return null;
    }
  }

  test("moves accrued lessons and spawn counts onto the profile paths", async () => {
    await writeMemory("personality-memory", '[{"text":"remember this"}]');
    await writeStats("personality-usage.json", '{"p-sage":3}');

    await migrateProfileStorePaths({ ottoHome, logger });

    expect(await read("profile-memory/p-sage.json")).toBe('[{"text":"remember this"}]');
    expect(await read("stats/profile-usage.json")).toBe('{"p-sage":3}');
    expect(await read("personality-memory/p-sage.json")).toBeNull();
    expect(await read("stats/personality-usage.json")).toBeNull();
  });

  test("is a no-op on a host that never had the old paths", async () => {
    await expect(migrateProfileStorePaths({ ottoHome, logger })).resolves.toBeUndefined();
    expect(await read("profile-memory/p-sage.json")).toBeNull();
  });

  test("keeps the current data when both paths exist", async () => {
    // The downgrade case: a newer daemon migrated, an older one recreated the
    // old path, a newer one starts again. The new path is the live one.
    await writeMemory("personality-memory", '{"stale":true}');
    await writeMemory("profile-memory", '{"current":true}');

    await migrateProfileStorePaths({ ottoHome, logger });

    expect(await read("profile-memory/p-sage.json")).toBe('{"current":true}');
    // The old path is left untouched rather than deleted: it is still the
    // user's data, and this migration never destroys any.
    expect(await read("personality-memory/p-sage.json")).toBe('{"stale":true}');
  });

  test("migrates each path independently", async () => {
    // Only the stats file is legacy; the memory directory is already current.
    await writeMemory("profile-memory", '{"current":true}');
    await writeStats("personality-usage.json", '{"p-sage":7}');

    await migrateProfileStorePaths({ ottoHome, logger });

    expect(await read("stats/profile-usage.json")).toBe('{"p-sage":7}');
    expect(await read("profile-memory/p-sage.json")).toBe('{"current":true}');
  });

  test("runs twice without changing the outcome", async () => {
    await writeMemory("personality-memory", '[{"text":"remember this"}]');

    await migrateProfileStorePaths({ ottoHome, logger });
    await migrateProfileStorePaths({ ottoHome, logger });

    expect(await read("profile-memory/p-sage.json")).toBe('[{"text":"remember this"}]');
  });
});
