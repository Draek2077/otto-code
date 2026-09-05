#!/usr/bin/env node
// Real Electron regression: the mounted migration reads/deletes through the
// registered IPC handlers and imports through the real managed daemon. No bridge
// interception, manual helper invocation, or user skill directories are used.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { AGENT_PROVIDER_DEFINITIONS } from "@otto-code/protocol/provider-manifest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const mode = process.env.OTTO_SKILL_UPGRADE_MODE ?? "attached";
assert(["attached", "cold"].includes(mode), "Use attached or cold mode");
const artifacts = path.join(root, ".tmp", "agent-02", `electron-${mode}-${Date.now()}`);
const runtime = path.join(artifacts, "runtime");
const userHome = path.join(runtime, "user-home");
const daemonHome = path.join(runtime, "daemon-home");
const userData = path.join(runtime, "electron-user-data");
for (const directory of [
  artifacts,
  userHome,
  daemonHome,
  userData,
  path.join(userHome, "AppData", "Roaming"),
  path.join(userHome, "AppData", "Local"),
]) {
  fs.mkdirSync(directory, { recursive: true });
}
const legacyPath = path.join(userData, "skill-selection.json");
const selection = { mode: "custom", skills: ["otto"] };
const daemonLog = path.join(daemonHome, "daemon.log");
const children = [];
let browser;
let page;
let lastStatus;
let passed = false;
let stopping = false;
let childFailure;

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function readLog(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}
async function bounded(label, operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${label}; evidence: ${artifacts}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function until(label, predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!stopping && childFailure) throw childFailure;
    const value = await bounded(label, predicate, Math.max(1, deadline - Date.now()));
    if (value) return value;
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${label}; evidence: ${artifacts}`);
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  assert(![6788, 6868].includes(port));
  return port;
}
async function isPortClosed(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (closed) => {
      socket.destroy();
      resolve(closed);
    };
    socket.once("connect", () => finish(false));
    socket.once("error", () => finish(true));
    socket.setTimeout(500, () => finish(false));
  });
}
function spawnLogged(name, command, args, env) {
  const output = fs.createWriteStream(path.join(artifacts, `${name}.log`));
  const child = spawn(command, args, {
    cwd: root,
    env,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  child.once("close", (code, signal) => {
    output.end();
    if (!stopping)
      childFailure = new Error(
        `${name} exited unexpectedly (${signal ?? code}); evidence: ${artifacts}`,
      );
  });
  children.push(child);
  return child;
}
function installed() {
  return [".agents", ".claude", ".codex"].map((provider) =>
    fs.readdirSync(path.join(userHome, provider, "skills")).sort(),
  );
}
function assertOnlySelected() {
  assert.deepEqual(installed(), [["otto"], ["otto"], ["otto"]]);
}
async function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    // Work from the owned root's current descendants. taskkill /T can hang on
    // provider version subprocesses; native leaf-first termination is bounded.
    const script = `$tree = [System.Collections.Generic.List[object]]::new();
      $all = @(Get-CimInstance Win32_Process);
      $root = $all | Where-Object ProcessId -eq ${child.pid};
      if ($root) { $tree.Add($root) };
      for ($i = 0; $i -lt $tree.Count; $i++) {
        $parent = $tree[$i].ProcessId;
        foreach ($item in @($all | Where-Object ParentProcessId -eq $parent)) { $tree.Add($item) }
      };
      for ($i = $tree.Count - 1; $i -ge 0; $i--) {
        Stop-Process -Id $tree[$i].ProcessId -Force -ErrorAction SilentlyContinue
      }`;
    execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 10_000,
    });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  await until(
    "owned process exit",
    () => child.exitCode !== null || child.signalCode !== null,
    15_000,
  );
}

const [daemonPort, expoPort, cdpPort] = await Promise.all([freePort(), freePort(), freePort()]);
const listen = `127.0.0.1:${daemonPort}`;
writeJson(path.join(artifacts, "launch.json"), {
  mode,
  daemonPort,
  expoPort,
  cdpPort,
  userHome,
  daemonHome,
  userData,
  head: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  sourceBlobs: Object.fromEntries(
    [
      "packages/server/src/server/bootstrap.ts",
      "packages/server/src/server/orchestration-skills/startup.ts",
      "packages/app/src/app/_layout.tsx",
      "packages/app/src/agent-skills/legacy-migration.tsx",
      "packages/app/src/agent-skills/legacy-migration-controller.ts",
    ].map((file) => [
      file,
      execFileSync("git", ["hash-object", file], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
      }).trim(),
    ]),
  ),
});
const env = {
  ...process.env,
  HOME: userHome,
  USERPROFILE: userHome,
  APPDATA: path.join(userHome, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(userHome, "AppData", "Local"),
  OTTO_HOME: daemonHome,
  OTTO_LISTEN: listen,
  OTTO_HOST: listen,
  OTTO_DESKTOP_MANAGED: "1",
  OTTO_NODE_ENV: "development",
  OTTO_NODE_INSPECT: "0",
  OTTO_DICTATION_ENABLED: "0",
  OTTO_VOICE_MODE_ENABLED: "0",
  OTTO_LOCAL_SPEECH_AUTO_DOWNLOAD: "0",
  OTTO_CORS_ORIGINS: "*",
  OTTO_WEB_UI_ENABLED: "false",
  EXPO_PUBLIC_LOCAL_DAEMON: "",
  EXPO_PORT: String(expoPort),
  EXPO_DEV_URL: `http://localhost:${expoPort}`,
  OTTO_ELECTRON_USER_DATA_DIR: userData,
  OTTO_ELECTRON_REMOTE_DEBUGGING_PORT: String(cdpPort),
  OTTO_FORCE_GPU: "1",
  OTTO_ELECTRON_FLAGS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${cdpPort}`,
  EXPO_NO_TELEMETRY: "1",
  BROWSER: "none",
  FORCE_COLOR: "0",
};
if (process.platform === "win32") {
  // Stopped-daemon CLI status also probes provider --version binaries. Keep
  // unrelated user installations out of this fixture, including that CLI path.
  const gitPath = execFileSync("where.exe", ["git.exe"], { encoding: "utf8", windowsHide: true })
    .trim()
    .split(/\r?\n/)[0];
  for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
  const windowsDir = process.env.SystemRoot ?? "C:\\Windows";
  env.PATH = [
    path.dirname(process.execPath),
    path.dirname(gitPath),
    path.join(windowsDir, "System32"),
    windowsDir,
    path.join(windowsDir, "System32", "Wbem"),
    path.join(windowsDir, "System32", "WindowsPowerShell", "v1.0"),
  ].join(path.delimiter);
}
writeJson(path.join(artifacts, "subprocess-tools.json"), {
  pathEntries: (env.PATH ?? env.Path ?? "").split(path.delimiter),
  desktopCli: path.join(root, "packages/cli/dist/index.js"),
  statusArgs: ["daemon", "status", "--json"],
});
// Verify the actual subprocess API used by skill paths, before starting anything.
const resolvedHome = execFileSync(
  process.execPath,
  ["-e", "process.stdout.write(require('node:os').homedir())"],
  { env, encoding: "utf8", windowsHide: true },
);
assert.equal(path.resolve(resolvedHome), path.resolve(userHome));
writeJson(path.join(daemonHome, "config.json"), {
  version: 1,
  daemon: {
    listen,
    relay: { enabled: false },
    mcp: { enabled: false, injectIntoAgents: false },
    agentProfiles: [],
    cors: { allowedOrigins: ["*"] },
  },
  // Skill migration has no provider dependency. Disable catalogs through the real
  // persisted config so installed provider binaries cannot launch discovery jobs.
  agents: {
    agentTeams: { teams: [] },
    providers: Object.fromEntries(
      AGENT_PROVIDER_DEFINITIONS.map(({ id }) => [id, { enabled: false }]),
    ),
  },
});
writeJson(path.join(userData, "desktop-settings.json"), {
  version: 1,
  settings: {
    daemon: { manageBuiltInDaemon: true, keepRunningAfterQuit: true },
    tray: { showIcon: false, minimizeOnClose: false },
    quit: { warnBeforeQuit: false },
  },
  migrations: { legacyRendererSettingsImported: true, daemonStopOnQuitDefaultApplied: true },
});
for (const provider of [".agents", ".claude", ".codex"]) {
  const skill = path.join(userHome, provider, "skills", "otto");
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), "OLD SELECTED SKILL\n");
}
// A real filesystem read failure holds migration until the fixture is repaired.
// This reaches the real IPC handler and verifies its scheduled retry path.
if (mode === "attached") fs.mkdirSync(legacyPath);
else writeJson(legacyPath, { version: 1, selection });

try {
  if (mode === "attached") {
    spawnLogged(
      "daemon",
      process.execPath,
      [path.join(root, "packages/server/dist/scripts/supervisor-entrypoint.js")],
      env,
    );
    await until("deferred automatic maintenance", () =>
      readLog(daemonLog).includes("Waiting for desktop skill selection"),
    );
    await until("daemon availability before renderer", async () => {
      try {
        return (await fetch(`http://${listen}/api/health`)).ok;
      } catch {
        return false;
      }
    });
    assertOnlySelected();
    assert.equal(
      readJson(path.join(daemonHome, "config.json")).agents?.skills?.selection,
      undefined,
    );
  }
  const runnerArgs = [process.execPath, path.join(root, "packages/desktop/scripts/dev-runner.mjs")];
  if (process.platform === "linux") {
    spawnLogged(
      "desktop",
      "xvfb-run",
      ["-a", "--server-args=-screen 0 1280x800x24", ...runnerArgs, "--no-sandbox"],
      env,
    );
  } else {
    spawnLogged("desktop", runnerArgs[0], runnerArgs.slice(1), env);
  }
  await until("Electron CDP", async () => {
    try {
      return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok;
    } catch {
      return false;
    }
  });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  page = await until("real app renderer", () =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().includes(`localhost:${expoPort}`)),
  );
  await until("registered desktop status IPC", async () => {
    try {
      const status = await page.evaluate(() => window.ottoDesktop?.invoke("desktop_daemon_status"));
      if (status?.status !== "running" || !status.desktopManaged || !status.pid || !status.serverId)
        return false;
      assert.equal(path.resolve(status.home), path.resolve(daemonHome));
      lastStatus = status;
      return true;
    } catch (error) {
      if (error.code === "ERR_ASSERTION") throw error;
      return false;
    }
  });
  if (mode === "attached") {
    await until("real legacy read IPC failure", () =>
      readLog(path.join(artifacts, "desktop.log")).includes(
        "Legacy selection migration failed; will retry",
      ),
    );
    assertOnlySelected();
    assert.equal(
      readJson(path.join(daemonHome, "config.json")).agents?.skills?.selection,
      undefined,
    );
    fs.rmdirSync(legacyPath);
    writeJson(legacyPath, { version: 1, selection });
  }
  await until("mounted migration durable import and source removal", () => {
    const actual = readJson(path.join(daemonHome, "config.json")).agents?.skills?.selection;
    return JSON.stringify(actual) === JSON.stringify(selection) && !fs.existsSync(legacyPath);
  });
  await until(
    "selected skill refresh",
    () =>
      fs.readFileSync(path.join(userHome, ".agents", "skills", "otto", "SKILL.md"), "utf8") !==
      "OLD SELECTED SKILL\n",
  );
  assertOnlySelected();
  const firstPid = lastStatus.pid;
  await page.reload();
  await until("reattached renderer", async () => {
    try {
      const status = await page.evaluate(() => window.ottoDesktop?.invoke("start_desktop_daemon"));
      assert.equal(status.pid, firstPid);
      assert.equal(path.resolve(status.home), path.resolve(daemonHome));
      return status.status === "running";
    } catch (error) {
      if (error.code === "ERR_ASSERTION") throw error;
      return false;
    }
  });
  assert.deepEqual(
    readJson(path.join(daemonHome, "config.json")).agents.skills.selection,
    selection,
  );
  assertOnlySelected();
  await page.screenshot({ path: path.join(artifacts, "migration-complete.png") });
  writeJson(path.join(artifacts, "result.json"), {
    mode,
    passed: true,
    serverId: lastStatus.serverId,
    pid: firstPid,
    selection,
    installed: installed(),
    sourceRemoved: !fs.existsSync(legacyPath),
    osHome: resolvedHome,
    daemonHome,
    userData,
  });
  passed = true;
  console.log(`PASS ${mode} desktop skill upgrade; evidence: ${artifacts}`);
} finally {
  stopping = true;
  // Stop only the daemon whose returned home was verified against this fixture.
  if (page && lastStatus) {
    await bounded(
      "fixture daemon shutdown IPC",
      () =>
        page.evaluate(() => window.ottoDesktop.invoke("stop_desktop_daemon", { reason: "quit" })),
      20_000,
    ).catch(() => undefined);
  }
  await bounded("browser disconnect", async () => browser?.close(), 10_000).catch(() => undefined);
  for (const child of children.toReversed()) await stopChild(child);
  if (fs.existsSync(daemonLog)) fs.copyFileSync(daemonLog, path.join(artifacts, "daemon.log"));
  await until(
    "fixture ports closed",
    async () =>
      (await Promise.all([daemonPort, expoPort, cdpPort].map(isPortClosed))).every(Boolean),
    15_000,
  );
  const resolvedRuntime = path.resolve(runtime);
  assert(resolvedRuntime.startsWith(`${path.resolve(artifacts)}${path.sep}`));
  if (passed)
    fs.rmSync(resolvedRuntime, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  else console.error(`Failed fixture retained for inspection: ${runtime}`);
}
