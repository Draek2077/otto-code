import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { acquirePidLock, getPidLockInfo, releasePidLock, updatePidLock } from "./pid-lock.js";

describe("pid-lock ownership", () => {
  test("writes and releases lock for explicit owner pid", async () => {
    const ottoHome = await mkdtemp(join(tmpdir(), "otto-pid-lock-owner-"));
    const ownerPid = process.pid + 10_000;

    try {
      await (
        acquirePidLock as unknown as (
          home: string,
          sockPath: string | null,
          options: { ownerPid: number },
        ) => Promise<void>
      )(ottoHome, null, { ownerPid });

      const lock = await getPidLockInfo(ottoHome);
      expect(lock?.pid).toBe(ownerPid);
      expect(lock?.listen).toBeNull();

      await (
        updatePidLock as unknown as (
          home: string,
          patch: { listen: string },
          options: { ownerPid: number },
        ) => Promise<void>
      )(ottoHome, { listen: "127.0.0.1:6868" }, { ownerPid });

      const updatedLock = await getPidLockInfo(ottoHome);
      expect(updatedLock?.listen).toBe("127.0.0.1:6868");

      await (
        releasePidLock as unknown as (home: string, options: { ownerPid: number }) => Promise<void>
      )(ottoHome, { ownerPid: ownerPid + 1 });
      const lockAfterWrongOwnerRelease = await getPidLockInfo(ottoHome);
      expect(lockAfterWrongOwnerRelease?.pid).toBe(ownerPid);

      await (
        releasePidLock as unknown as (home: string, options: { ownerPid: number }) => Promise<void>
      )(ottoHome, { ownerPid });
      const lockAfterOwnerRelease = await getPidLockInfo(ottoHome);
      expect(lockAfterOwnerRelease).toBeNull();
    } finally {
      await rm(ottoHome, { recursive: true, force: true });
    }
  });
});
