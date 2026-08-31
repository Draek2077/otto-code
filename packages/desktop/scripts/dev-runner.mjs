#!/usr/bin/env node
import { existsSync as fsExistsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  createElectronSpawnOptions,
  registerDevRunnerShutdownSignals,
  resolveChildKillTarget,
} from "./dev-runner-config.mjs";

import { resolveDevElectronArgs } from "./dev-runner-args.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const rootDir = path.resolve(desktopDir, "../..");
const appDir = path.resolve(desktopDir, "../app");
const require = createRequire(import.meta.url);
const electron = require("electron");

const expoPort = Number(process.env.EXPO_PORT);
if (!Number.isInteger(expoPort) || expoPort <= 0) {
  console.error("[dev] EXPO_PORT must be set before running desktop dev");
  process.exit(1);
}

const expoDevUrl = process.env.EXPO_DEV_URL || `http://localhost:${expoPort}`;
const electronArgs = resolveDevElectronArgs(process.platform, process.argv.slice(2));
const colorEnv = {
  FORCE_COLOR: process.env.FORCE_COLOR || "1",
  npm_config_color: process.env.npm_config_color || "always",
};
const devBuildLabel = execFileSync("git", ["branch", "--show-current"], {
  cwd: rootDir,
  encoding: "utf8",
}).trim();

const children = new Map();
let stopping = false;
let exitCode = 0;

function prefixStream(name, stream, target) {
  let buffered = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      target.write(line ? `[${name}] ${line}\n` : `[${name}]\n`);
    }
  });
  stream.on("end", () => {
    if (buffered) {
      target.write(`[${name}] ${buffered}\n`);
    }
  });
}

function spawnChild(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: {
      ...process.env,
      ...colorEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

  const managedChild = {
    process: child,
    detached: options.detached === true,
  };
  children.set(name, managedChild);
  prefixStream(name, child.stdout, process.stdout);
  prefixStream(name, child.stderr, process.stderr);

  child.on("error", (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
    exitCode = 1;
    stopAll("SIGTERM");
  });

  child.on("exit", (code, signal) => {
    children.delete(name);
    if (!stopping) {
      if (code !== 0) {
        exitCode = code ?? 1;
        console.error(`[${name}] exited with ${signal ?? code}`);
      }
      stopAll("SIGTERM");
    }
  });

  return child;
}

// Windows has no POSIX process groups, and `detached: true` there does NOT mean
// "new group" - it means "new console window", which is how Metro escaped into
// its own cmd.exe popup that outlived both this runner and the app. So dev
// children are spawned attached on Windows (output stays inline in the terminal
// that started dev), and the tree is torn down with `taskkill /T` instead of a
// group signal.
const isWindows = process.platform === "win32";
const terminated = new WeakSet();

function killChild({ process: child, detached }, signal) {
  if (!child.pid || child.killed || (isWindows && terminated.has(child))) {
    return;
  }

  if (isWindows) {
    terminated.add(child);
    // /T walks the tree (cmd.exe -> npx -> node), /F is the escalation the
    // POSIX side gets from the SIGKILL timer, so there is nothing to retry.
    try {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", () => {
        try {
          child.kill(signal);
        } catch {
          // Already gone.
        }
      });
    } catch {
      try {
        child.kill(signal);
      } catch {
        // Already gone.
      }
    }
    return;
  }

  try {
    process.kill(resolveChildKillTarget(child.pid, detached), signal);
  } catch {
    // The child may have exited between the liveness check and the signal.
  }
}

// The desktop app spawns the Otto daemon as a DETACHED grandchild
// (packages/desktop/src/daemon/daemon-manager.ts: `detached: true` + `unref()`),
// so it is not reachable by the process-group `kill(-pid)` stopAll() below.
// That is intentional for the packaged app (the daemon outlives the window), but
// in dev it means the daemon outlives this runner - the pre-`ba852fce8`
// `concurrently --kill-others` launch tore it down with the tree. We restore that
// guarantee by explicitly stopping the daemon on the way out, using the same
// `daemon stop` CLI the app itself uses for quit (daemon-manager.ts
// DESKTOP_DAEMON_STOP_CLI_ARGS), which walks the supervisor + worker + their
// children. Dev-only: the packaged app is never launched through this runner.
const CLI_STOP_ARGS = [
  "daemon",
  "stop",
  "--json",
  "--timeout",
  "10",
  "--force",
  "--kill-timeout",
  "10",
];

function resolveCliEntrypoint() {
  const cliRoot = path.join(rootDir, "packages", "cli");
  const distEntry = path.join(cliRoot, "dist", "index.js");
  if (fsExistsSync(distEntry)) {
    return { entry: distEntry, execArgv: [] };
  }
  return { entry: path.join(cliRoot, "src", "index.ts"), execArgv: ["--import", "tsx"] };
}

function runCli(args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let child;
    try {
      const { entry, execArgv } = resolveCliEntrypoint();
      child = spawn(process.execPath, [...execArgv, entry, ...args], {
        cwd: rootDir,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      console.error(`[daemon] ${error.message}`);
      done({ ok: false });
      return;
    }

    let output = "";
    child.stdout?.on("data", (chunk) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk) => (output += chunk.toString()));
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
      done({ ok: false, output });
    }, timeoutMs);
    timer.unref();
    child.on("error", () => {
      clearTimeout(timer);
      done({ ok: false, output });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ ok: code === 0, output });
    });
  });
}

// Stop the detached daemon the way the app does on quit (same `daemon stop`
// CLI, same args). Bounded so a wedged daemon can't hold the dev session open.
async function stopDaemon() {
  const result = await runCli(CLI_STOP_ARGS, 20_000);
  if (!result.ok) {
    console.warn("[daemon] daemon stop did not confirm clean; it may still be winding down");
  }
}

function stopAll(signal) {
  if (stopping) {
    return;
  }

  stopping = true;
  for (const child of children.values()) {
    killChild(child, signal);
  }

  const forceKill = setTimeout(() => {
    for (const child of children.values()) {
      killChild(child, "SIGKILL");
    }
  }, 2500);
  forceKill.unref();

  const finish = setInterval(() => {
    if (children.size !== 0) {
      return;
    }
    clearInterval(finish);
    // Kill the children first, then stop the detached daemon (it is a
    // grandchild that detached itself, so it survived the group kill above),
    // then exit. Stopping after the app is gone keeps the app's own
    // "daemon disappeared" handling from reacting mid-shutdown, and the
    // app's quit-time stop is a no-op once the daemon is already down.
    void stopDaemon().then(() => process.exit(exitCode));
  }, 50);
}

async function waitForPort(port, host = "127.0.0.1", timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await canConnect(port, host)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${host}:${port}`);
}

function canConnect(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

registerDevRunnerShutdownSignals({ signalSource: process, stop: stopAll });

// Bump Metro's Node heap to 8 GB. Long edit-while-live sessions grow Metro's
// in-memory module graph + transform cache until it walks into V8's ~4 GB default
// old-space ceiling and dies with "Ineffective mark-compacts near heap limit"
// (exit 134). Scoped to the Expo/Metro process only - Electron keeps its default.
const metroNodeOptions = [process.env.NODE_OPTIONS, "--max-old-space-size=8192"]
  .filter(Boolean)
  .join(" ");
// npx is a .cmd shim on Windows. spawn() without a shell only resolves real
// executables, so plain "npx" died with ENOENT and Metro never came up, taking
// the tab-bridge E2E down before Electron could be driven. Naming npx.cmd
// directly is not the fix either: Node refuses to spawn .cmd without a shell
// (EINVAL, CVE-2024-27980). A shell is the supported route, and every argument
// here is a literal this file controls, so there is nothing to escape.
//
// The shell must be named ("cmd.exe"), not `shell: true`: since Node 23.11 /
// 24 passing args with a bare `shell: true` emits DEP0190 (unescaped argument
// concatenation warning) on every launch. Naming the shell is exactly what
// DEP0190 tells you to do, and on Windows `shell: true` resolves to cmd.exe
// anyway, so behavior is identical.
spawnChild("metro", "npx", ["expo", "start", "--port", String(expoPort)], {
  cwd: appDir,
  // Attached on Windows: `detached` gives the child its own console window, and
  // Metro belongs inline in the dev terminal (and must die with it). On POSIX it
  // is what makes the process group that stopAll() signals.
  detached: !isWindows,
  ...(isWindows ? { shell: "cmd.exe", windowsHide: true } : {}),
  env: {
    ...process.env,
    ...colorEnv,
    BROWSER: "none",
    APP_VARIANT: "development",
    EXPO_PUBLIC_OTTO_DEV_BUILD_LABEL: devBuildLabel,
    OTTO_WEB_PLATFORM: "electron",
    NODE_OPTIONS: metroNodeOptions,
  },
});

try {
  await waitForPort(expoPort);
} catch (error) {
  console.error(`[dev] ${error.message}`);
  exitCode = 1;
  stopAll("SIGTERM");
}

if (!stopping) {
  spawnChild(
    "electron",
    electron,
    [...electronArgs, desktopDir],
    createElectronSpawnOptions({
      env: process.env,
      colorEnv,
      expoDevUrl,
      devBuildLabel,
    }),
  );
}
