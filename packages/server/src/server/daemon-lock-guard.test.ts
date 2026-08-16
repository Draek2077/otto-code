import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as net from "node:net";
import { afterEach, describe, expect, test } from "vitest";

import {
  describeDaemonConflict,
  isDaemonLockClear,
  isPortFree,
  portFromListen,
  waitForDaemonToQuit,
} from "./daemon-lock-guard.js";
import { acquirePidLock, getPidLockInfo, releasePidLock, updatePidLock } from "./pid-lock.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function freshHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "otto-daemon-guard-"));
  homes.push(home);
  return home;
}

/** A lock owned by a live PID (this test process) that the guard must wait on. */
async function holdLiveLock(home: string, listen: string | null): Promise<void> {
  await acquirePidLock(home, null, { ownerPid: process.pid });
  if (listen) {
    await updatePidLock(home, { listen }, { ownerPid: process.pid });
  }
}

describe("describeDaemonConflict", () => {
  test("names the PID, start time, and listen address", () => {
    const message = describeDaemonConflict({
      pid: 37876,
      startedAt: "2026-08-15T20:19:00.364Z",
      hostname: "host",
      uid: 0,
      listen: "127.0.0.1:6788",
    });
    expect(message).toContain("PID 37876");
    expect(message).toContain("started 2026-08-15T20:19:00.364Z");
    expect(message).toContain("listening on 127.0.0.1:6788");
  });

  test("omits the listen clause when none was recorded", () => {
    const message = describeDaemonConflict({
      pid: 123,
      startedAt: "2026-01-01T00:00:00.000Z",
      hostname: "host",
      uid: 0,
      listen: null,
    });
    expect(message).toContain("PID 123");
    expect(message).not.toContain("listening on");
  });
});

describe("portFromListen", () => {
  test("parses host:port", () => {
    expect(portFromListen("127.0.0.1:6788")).toBe(6788);
    expect(portFromListen("0.0.0.0:8081")).toBe(8081);
  });

  test("returns null for absent or unparsable values", () => {
    expect(portFromListen(null)).toBeNull();
    expect(portFromListen("unix:/tmp/sock")).toBeNull();
    expect(portFromListen("not-a-port")).toBeNull();
  });
});

describe("isDaemonLockClear", () => {
  test("reports a live lock as held", async () => {
    const home = await freshHome();
    await holdLiveLock(home, null);
    await expect(isDaemonLockClear(home)).resolves.toBe(false);
  });

  test("reports a stale (dead-PID) lock as clear", async () => {
    const home = await freshHome();
    // Hand-write a lock owned by a PID that is (almost certainly) not running so
    // the liveness check reads it as abandoned, exactly as pid-lock.ts does.
    await writeFile(
      join(home, "otto.pid"),
      JSON.stringify({
        pid: 99999,
        startedAt: "2026-01-01T00:00:00.000Z",
        hostname: "h",
        uid: 0,
        listen: null,
      }),
      "utf8",
    );
    await expect(isDaemonLockClear(home)).resolves.toBe(true);
  });

  test("reports a home with no lock as clear", async () => {
    const home = await freshHome();
    await expect(isDaemonLockClear(home)).resolves.toBe(true);
  });
});

describe("isPortFree", () => {
  test("detects a bound port and a free port", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    await expect(isPortFree(port)).resolves.toBe(false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await expect(isPortFree(port)).resolves.toBe(true);
  });
});

describe("waitForDaemonToQuit", () => {
  test("waits while a live daemon holds the lock, then clears when it releases", async () => {
    const home = await freshHome();
    await holdLiveLock(home, "127.0.0.1:6788");
    const lock = (await getPidLockInfo(home))!;

    const lines: string[] = [];
    const wait = waitForDaemonToQuit({
      ottoHome: home,
      lock,
      write: (line) => lines.push(line),
      pollIntervalMs: 20,
      timeoutMs: 5_000,
    });

    // Let it print the initial conflict lines, then release the lock (as the user
    // quitting the daemon would).
    await sleep(80);
    await releasePidLock(home, { ownerPid: lock.pid });

    await expect(wait).resolves.toEqual({ kind: "cleared" });
    expect(lines[0]).toContain(`PID ${lock.pid}`);
    expect(lines.some((line) => line.includes("quit the existing one"))).toBe(true);
    expect(lines.at(-1)).toMatch(/continuing/i);
  });

  test("times out when the daemon is never quit", async () => {
    const home = await freshHome();
    await holdLiveLock(home, null);
    const lock = (await getPidLockInfo(home))!;
    const lines: string[] = [];
    const outcome = await waitForDaemonToQuit({
      ottoHome: home,
      lock,
      write: (line) => lines.push(line),
      pollIntervalMs: 10,
      timeoutMs: 100,
    });
    expect(outcome.kind).toBe("interrupted");
    expect(lines[0]).toContain(`PID ${lock.pid}`);
  });

  test("aborts immediately when isInterrupted reports a signal", async () => {
    const home = await freshHome();
    await holdLiveLock(home, null);
    const lock = (await getPidLockInfo(home))!;
    await expect(
      waitForDaemonToQuit({
        ottoHome: home,
        lock,
        write: () => {},
        pollIntervalMs: 10,
        isInterrupted: () => true,
      }),
    ).resolves.toEqual({ kind: "interrupted", reason: "aborted" });
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
