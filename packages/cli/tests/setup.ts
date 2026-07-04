/**
 * Test setup utilities for Otto CLI E2E tests
 *
 * Critical rules from design doc:
 * 1. Port: Random port via 10000 + Math.floor(Math.random() * 50000) - NEVER 6868
 * 2. Protocol: WebSocket ONLY - daemon has no HTTP endpoints
 * 3. Temp dirs: Create temp directories for OTTO_HOME and agent --cwd
 * 4. Model: Always --provider claude with haiku model for agent tests
 * 5. Cleanup: Kill daemon and remove temp dirs after each test
 */

import { $, ProcessPromise, sleep } from "zx";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const TEST_ENV_DEFAULTS = {
  OTTO_LOCAL_SPEECH_AUTO_DOWNLOAD: process.env.OTTO_LOCAL_SPEECH_AUTO_DOWNLOAD ?? "0",
  OTTO_DICTATION_ENABLED: process.env.OTTO_DICTATION_ENABLED ?? "0",
  OTTO_VOICE_MODE_ENABLED: process.env.OTTO_VOICE_MODE_ENABLED ?? "0",
};

function killPidTree(pid: number, signal: NodeJS.Signals): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ESRCH") {
        return;
      }
    }
  }

  try {
    process.kill(pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") {
      throw error;
    }
  }
}

export interface TestContext {
  /** Random port for test daemon (never 6868) */
  port: number;
  /** Temp directory for OTTO_HOME */
  ottoHome: string;
  /** Temp directory for agent working directory */
  workDir: string;
  /** Running daemon process */
  daemon: ProcessPromise | null;
  /** Run a otto CLI command against the test daemon */
  otto: (args: string[]) => ProcessPromise;
  /** Clean up all resources */
  cleanup: () => Promise<void>;
}

/**
 * Generate a random port for test daemon
 * NEVER uses 6868 (user's running daemon)
 */
export function getRandomPort(): number {
  return 10000 + Math.floor(Math.random() * 50000);
}

/**
 * Create isolated temp directories for testing
 */
export async function createTempDirs(): Promise<{ ottoHome: string; workDir: string }> {
  const ottoHome = await mkdtemp(join(tmpdir(), "otto-test-home-"));
  const workDir = await mkdtemp(join(tmpdir(), "otto-test-work-"));
  return { ottoHome, workDir };
}

/**
 * Wait for daemon to be ready by testing WebSocket connection
 * Uses `otto agent ls` which connects via WebSocket
 */
async function probeDaemon(port: number): Promise<boolean> {
  try {
    const result = await $`OTTO_HOST=localhost:${port} otto agent ls`.nothrow();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function waitForDaemon(port: number, timeout = 30000): Promise<void> {
  const deadline = Date.now() + timeout;
  async function poll(): Promise<void> {
    if (await probeDaemon(port)) return;
    if (Date.now() >= deadline) {
      throw new Error(`Daemon failed to start on port ${port} within ${timeout}ms`);
    }
    await sleep(100);
    return poll();
  }
  return poll();
}

/**
 * Start an isolated test daemon
 */
export async function startDaemon(port: number, ottoHome: string): Promise<ProcessPromise> {
  $.verbose = false;
  const daemon =
    $`OTTO_HOME=${ottoHome} OTTO_LISTEN=127.0.0.1:${port} OTTO_RELAY_ENABLED=false OTTO_LOCAL_SPEECH_AUTO_DOWNLOAD=${TEST_ENV_DEFAULTS.OTTO_LOCAL_SPEECH_AUTO_DOWNLOAD} OTTO_DICTATION_ENABLED=${TEST_ENV_DEFAULTS.OTTO_DICTATION_ENABLED} OTTO_VOICE_MODE_ENABLED=${TEST_ENV_DEFAULTS.OTTO_VOICE_MODE_ENABLED} CI=true otto daemon start --foreground`.nothrow();
  return daemon;
}

/**
 * Create a full test context with daemon, temp dirs, and helpers
 */
export async function createTestContext(): Promise<TestContext> {
  const port = getRandomPort();
  const { ottoHome, workDir } = await createTempDirs();

  // Helper to run CLI commands against test daemon
  const otto = (args: string[]): ProcessPromise => {
    $.verbose = false;
    return $`OTTO_HOST=localhost:${port} OTTO_LOCAL_SPEECH_AUTO_DOWNLOAD=${TEST_ENV_DEFAULTS.OTTO_LOCAL_SPEECH_AUTO_DOWNLOAD} OTTO_DICTATION_ENABLED=${TEST_ENV_DEFAULTS.OTTO_DICTATION_ENABLED} OTTO_VOICE_MODE_ENABLED=${TEST_ENV_DEFAULTS.OTTO_VOICE_MODE_ENABLED} otto ${args}`.nothrow();
  };

  // Cleanup function
  const cleanup = async (): Promise<void> => {
    if (ctx.daemon) {
      if (typeof ctx.daemon.pid === "number") {
        killPidTree(ctx.daemon.pid, "SIGTERM");
        await sleep(250);
        killPidTree(ctx.daemon.pid, "SIGKILL");
      } else {
        ctx.daemon.kill();
      }
    }
    await rm(ottoHome, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  };

  const ctx: TestContext = {
    port,
    ottoHome,
    workDir,
    daemon: null,
    otto,
    cleanup,
  };

  return ctx;
}

/**
 * Create a test context and start the daemon
 * Use this for tests that need a running daemon
 */
export async function createTestContextWithDaemon(): Promise<TestContext> {
  const ctx = await createTestContext();
  ctx.daemon = await startDaemon(ctx.port, ctx.ottoHome);
  await waitForDaemon(ctx.port);
  return ctx;
}

/**
 * Register cleanup handlers for process exit
 */
export function registerCleanupHandlers(cleanup: () => Promise<void>): void {
  const handler = async () => {
    await cleanup();
    process.exit(0);
  };

  process.on("exit", () => {
    // Can't await in exit handler, but at least try to kill daemon
  });
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}
