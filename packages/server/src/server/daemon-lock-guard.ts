import * as net from "node:net";
import { isLocked, type PidLockInfo } from "./pid-lock.js";

/**
 * User-facing guard for the "another Otto daemon already owns the single-instance
 * lock" conflict. This is the Otto daemon start path's concern: it reuses the
 * same lock authority ({@link isLocked} in pid-lock.ts) that already emits
 * "Another Otto daemon is already running (PID …)" so the detection, the message,
 * and the pause all agree with one another.
 *
 * It is deliberately NOT part of the preview subsystem. Preview stays agnostic of
 * how a configured dev server comes up; when preview_start spawns `npm run dev`,
 * the *child* runs this guard on its own start path and hands the parent a clean
 * port via the port probe. Non-Otto launch.json entries (no lock, no OTTO_HOME)
 * never touch this module.
 */

const DEFAULT_POLL_INTERVAL_MS = 1_000;
/** Progress print cadence - one line a few seconds, not one per poll. */
const STATUS_EVERY_POLLS = 5;

/**
 * A clear, actionable description of a live lock conflict: names the PID and the
 * start time (both come from the lock), and the listen address when the holder
 * recorded one. This is what a person reading a terminal needs to act on.
 */
export function describeDaemonConflict(lock: PidLockInfo): string {
  const parts = [
    `Another Otto daemon is already running (PID ${lock.pid}`,
    `started ${lock.startedAt}`,
    lock.listen ? `listening on ${lock.listen}` : null,
    `).`,
  ];
  return parts.filter((part) => part !== null).join(" ");
}

/**
 * True when no live process owns the lock for this OTTO_HOME - i.e. it is safe to
 * acquire. Reuses the same liveness check the lock acquisition path trusts, so a
 * stale (dead-PID) lock reads as clear rather than blocking.
 */
export async function isDaemonLockClear(ottoHome: string): Promise<boolean> {
  const { locked } = await isLocked(ottoHome);
  return !locked;
}

/**
 * Probe whether a TCP port is accepting connections on loopback. Used only to
 * re-verify the port is actually free after the lock clears; a still-bound port
 * (e.g. lingering TIME_WAIT) is reported but does not block indefinitely.
 */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    // net.connect succeeds only if something is LISTENING; a refused/error
    // connection means the port is free for a fresh bind.
    const socket = net.connect({ host: "127.0.0.1", port, timeout: 1_000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(true);
    });
  });
}

/**
 * Extract the numeric port from a lock's `listen` address (e.g. "127.0.0.1:6788")
 * for the post-clear port re-check. Returns null when absent or unparsable - the
 * re-check is best-effort and the lock release is the authoritative signal.
 */
export function portFromListen(listen: string | null): number | null {
  if (!listen) {
    return null;
  }
  const colon = listen.lastIndexOf(":");
  if (colon === -1) {
    return null;
  }
  const port = Number.parseInt(listen.slice(colon + 1), 10);
  return Number.isInteger(port) && port > 0 ? port : null;
}

export type DaemonConflictOutcome = { kind: "cleared" } | { kind: "interrupted"; reason: string };

export interface WaitDaemonConflictOptions {
  ottoHome: string;
  lock: PidLockInfo;
  /** Re-verify this port is free after the lock clears. Omit to skip the check. */
  port?: number;
  /**
   * Progress line printer (defaults to stderr). Called once with the conflict
   * description, then periodically while waiting.
   */
  write?: (line: string) => void;
  /** Poll cadence; defaults to 1s. */
  pollIntervalMs?: number;
  /**
   * Return true to abort the wait (e.g. the user pressed Ctrl-C). The wait
   * resolves with an `interrupted` outcome instead of blocking forever.
   */
  isInterrupted?: () => boolean;
  /**
   * Upper bound on how long to wait before giving up, so a daemon the user never
   * quits cannot hang the start forever. Defaults to 15 minutes. When exceeded the
   * wait resolves as interrupted with a timeout reason.
   */
  timeoutMs?: number;
}

/**
 * Pause the start path until the conflicting daemon is quit, then re-check the
 * port is free. Prints the conflict once, then a progress line every few seconds.
 *
 * This does NOT try to make two daemons coexist, and it never force-kills the
 * existing daemon - quitting it is the user's explicit action. If the caller is
 * non-interactive (no TTY) it should not call this; it should surface the
 * description and fail, matching the prior behavior.
 */
export async function waitForDaemonToQuit(
  options: WaitDaemonConflictOptions,
): Promise<DaemonConflictOutcome> {
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const started = Date.now();

  write(describeDaemonConflict(options.lock));
  write(
    "To start this daemon, quit the existing one (its own terminal, or `taskkill`/kill on " +
      `PID ${options.lock.pid}) and then this will continue automatically.`,
  );
  write("Waiting for the existing daemon to exit… (Ctrl-C to abort)");

  let polls = 0;
  for (;;) {
    if (options.isInterrupted?.()) {
      return { kind: "interrupted", reason: "aborted" };
    }
    if (Date.now() - started > timeoutMs) {
      return {
        kind: "interrupted",
        reason: `timed out after ${Math.round(timeoutMs / 1000)}s waiting for PID ${options.lock.pid}`,
      };
    }
    await sleep(pollMs);
    polls += 1;

    if (await isDaemonLockClear(options.ottoHome)) {
      // Lock is gone. If a port was given, give the holder a brief grace to fully
      // release it, then report (but do not block on) whether it is free.
      if (options.port !== undefined) {
        await sleep(pollMs);
        if (!(await isPortFree(options.port))) {
          write(
            `Port ${options.port} is still bound after the lock cleared; continuing - if the bind ` +
              "still fails, that port is held by a process other than the daemon.",
          );
        }
      }
      write("Existing daemon has exited - continuing.");
      return { kind: "cleared" };
    }

    if (polls % STATUS_EVERY_POLLS === 0) {
      write(`Still waiting… PID ${options.lock.pid} is still running.`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
