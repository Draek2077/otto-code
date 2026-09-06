import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import dotenv from "dotenv";
import { readLocalAiEnv, preflightLocalAi } from "./helpers/local-ai-preflight";
import { killProcessTree } from "./helpers/spawn-node";

export interface WaitForServerOptions {
  host?: string;
  timeoutMs?: number;
  label: string;
  childProcess?: ChildProcess | null;
  getRecentOutput?: () => string;
}

type ServerProbe = (host: string, port: number) => Promise<void>;

// Every fixed port owned by a lane that is NOT this one. Tests and demos draw
// their daemon/Metro/relay ports dynamically (see getAvailablePort) precisely so
// that several runs can go at once - that is worth keeping, so isolation from
// the other lanes is enforced by subtraction here rather than by pinning a band.
// The installed app, the dev app, tests, and demos are all expected to be
// running simultaneously; see docs/development.md "Lanes".
const RESERVED_LOCAL_PORTS = new Set([
  // --- Installed-app lane ---
  // Its daemon over `~/.otto`.
  6868,
  // --- Dev lane (scripts/dev-home.{sh,ps1}) ---
  // Dev daemon.
  6788,
  // --- Agent lane (scripts/dev-agent.{sh,ps1}) ---
  // Daemon + Expo web an agent drives on its own.
  6799, 8095,
  // Root-checkout Expo (8081, `dev:app` and the `otto-dev` preview config), then
  // the desktop dev Expo band that packages/desktop/scripts/dev.{ps1,sh} probes
  // in order. Desktop dev starts at 8082 and never claims 8081.
  8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089,
  // The marketing site (`.claude/launch.json`): website. Deliberately outside
  // the 808x Expo band - see packages/website/vite.config.ts.
  4300,
  // Electron remote-debugging (CDP) for the desktop dev shell.
  9223,
  // --- Third-party ---
  // OpenCode's default local server port. Some provider probes can spawn it
  // during daemon startup, so the E2E daemon must not choose the same port.
  61680,
]);

function createLineBuffer(maxLines = 120): { add: (line: string) => void; dump: () => string } {
  const lines: string[] = [];
  return {
    add(line) {
      lines.push(line);
      if (lines.length > maxLines) lines.shift();
    },
    dump: () => lines.join("\n"),
  };
}

function formatRecentOutput(getRecentOutput?: () => string): string {
  const output = getRecentOutput?.().trim();
  return output ? `\nRecent output:\n${output}` : "";
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function getAvailableE2EPort(): Promise<number> {
  for (;;) {
    const port = await getAvailablePort();
    if (!RESERVED_LOCAL_PORTS.has(port)) return port;
  }
}

async function connectToServer(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = net.connect(port, host, () => {
      socket.end();
      resolve();
    });
    socket.setTimeout(1_000, () => {
      socket.destroy();
      reject(new Error(`Connection timed out to ${host}:${port}`));
    });
    socket.on("error", reject);
  });
}

async function waitForServer(
  port: number,
  options: WaitForServerOptions,
  probe: ServerProbe = connectToServer,
): Promise<void> {
  const { host = "127.0.0.1", timeoutMs = 15_000, label, childProcess, getRecentOutput } = options;
  const deadline = Date.now() + timeoutMs;
  let lastConnectionError: unknown = null;

  while (Date.now() < deadline) {
    if (childProcess?.exitCode !== null && childProcess?.exitCode !== undefined) {
      const signal = childProcess.signalCode ? `, signal ${childProcess.signalCode}` : "";
      throw new Error(
        `${label} exited before listening on ${host}:${port} (exit code ${childProcess.exitCode}${signal}).${formatRecentOutput(getRecentOutput)}`,
      );
    }
    try {
      await probe(host, port);
      return;
    } catch (error) {
      lastConnectionError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const reason =
    lastConnectionError instanceof Error
      ? ` Last connection error: ${lastConnectionError.message}`
      : "";
  throw new Error(
    `${label} did not start on ${host}:${port} within ${timeoutMs}ms.${reason}${formatRecentOutput(getRecentOutput)}`,
  );
}

async function probeMetro(host: string, port: number): Promise<void> {
  const response = await fetch(`http://${host}:${port}/status`, {
    signal: AbortSignal.timeout(1_000),
  });
  const body = (await response.text()).trim();
  if (response.status !== 200 || body !== "packager-status:running") {
    throw new Error(
      `Expected Metro status on ${host}:${port}, received HTTP ${response.status}: ${JSON.stringify(body.slice(0, 200))}`,
    );
  }
}

export async function waitForMetro(port: number, options: WaitForServerOptions): Promise<void> {
  await waitForServer(port, options, probeMetro);
}

export async function warmMetro(port: number): Promise<void> {
  const origin = `http://127.0.0.1:${port}`;
  const timeoutMs = process.env.E2E_METRO_COLD_START === "1" ? 300_000 : 120_000;
  const documentResponse = await fetch(origin, { signal: AbortSignal.timeout(timeoutMs) });
  if (!documentResponse.ok) {
    throw new Error(`Metro document warmup failed with HTTP ${documentResponse.status}`);
  }
  const document = await documentResponse.text();
  const scriptSources = [...document.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  if (scriptSources.length === 0) {
    throw new Error("Metro document warmup found no scripts to compile");
  }
  for (const source of scriptSources) {
    const scriptUrl = new URL(source, origin);
    if (scriptUrl.origin !== origin) continue;
    const response = await fetch(scriptUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      throw new Error(
        `Metro bundle warmup failed for ${scriptUrl.pathname}: HTTP ${response.status}`,
      );
    }
    await response.arrayBuffer();
  }
}

function startMetro(port: number, buffer: ReturnType<typeof createLineBuffer>): ChildProcess {
  const appDir = path.resolve(__dirname, "../..");
  // Run the Expo CLI's JS entry with the current Node binary instead of
  // spawning `npx` - `npx` is not directly spawnable on Windows (ENOENT).
  const expoCli = require.resolve("expo/bin/cli", { paths: [appDir] });
  const child = spawn(
    process.execPath,
    [expoCli, "start", "--web", "--port", String(port), "--max-workers", "2"],
    {
      cwd: appDir,
      env: {
        ...process.env,
        BROWSER: "none",
        // Share only the compilation cache across focused runs. Daemons and
        // browser fixtures keep their separate OS homes and temporary folders.
        ...(process.env.E2E_METRO_TEMP_DIR
          ? {
              TEMP: process.env.E2E_METRO_TEMP_DIR,
              TMP: process.env.E2E_METRO_TEMP_DIR,
              TMPDIR: process.env.E2E_METRO_TEMP_DIR,
            }
          : {}),
        ...(process.env.E2E_DESKTOP_RUNTIME === "1" ? { OTTO_WEB_PLATFORM: "electron" } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    },
  );
  const log = (chunk: Buffer, stream: "stdout" | "stderr") => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      buffer.add(`[${stream}] ${line}`);
      console[stream === "stdout" ? "log" : "error"](`[metro] ${line}`);
    }
  };
  child.stdout?.on("data", (chunk: Buffer) => log(chunk, "stdout"));
  child.stderr?.on("data", (chunk: Buffer) => log(chunk, "stderr"));
  return child;
}

async function loadHarnessEnvironment(repoRoot: string): Promise<void> {
  const envTestPath = path.join(repoRoot, ".env.test");
  if (existsSync(envTestPath)) dotenv.config({ path: envTestPath });
}

function summarizeOpenAiErrorBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return "empty response body";
  }
  if (trimmed.length <= 240) {
    return trimmed;
  }
  return `${trimmed.slice(0, 240)}...`;
}

async function isOpenAiApiKeyUsable(apiKey: string | undefined): Promise<boolean> {
  const key = apiKey?.trim();
  if (!key) {
    return false;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/models?limit=1", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });
    if (response.ok) {
      return true;
    }
    const body = await response.text();
    console.warn(
      `[e2e] OPENAI_API_KEY probe failed (${response.status}): ${summarizeOpenAiErrorBody(body)}`,
    );
    return false;
  } catch (error) {
    console.warn(
      `[e2e] OPENAI_API_KEY probe request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

async function logSpeechHarnessConfig(): Promise<void> {
  const openAiUsable = await isOpenAiApiKeyUsable(process.env.OPENAI_API_KEY);
  const defaultLocalModelsDir = path.join(
    process.env.HOME ?? "",
    ".otto",
    "models",
    "local-speech",
  );
  const hasDefaultLocalModelsDir =
    defaultLocalModelsDir.trim().length > 0 && existsSync(defaultLocalModelsDir);

  // Default app E2E does not cover speech flows. Keep speech disabled here so
  // unrelated tests never start background local-model downloads.
  if (!openAiUsable && !hasDefaultLocalModelsDir) {
    console.warn(
      "[e2e] Neither OPENAI_API_KEY nor local speech models found - app E2E keeps dictation/voice disabled. " +
        "Tests that require dictation should gate on OTTO_DICTATION_ENABLED.",
    );
    return;
  }

  const speechAssets = openAiUsable ? "OpenAI" : `local models at ${defaultLocalModelsDir}`;
  console.log(
    `[e2e] Speech assets available from ${speechAssets}; app E2E keeps dictation/voice disabled.`,
  );
}

export default async function globalSetup() {
  const repoRoot = path.resolve(__dirname, "../../../..");
  await loadHarnessEnvironment(repoRoot);
  await logSpeechHarnessConfig();

  // Fail the run here rather than once per *.local.spec.ts test: LM Studio being
  // down or the pinned model unloaded is a harness fault, not a product failure.
  const localAiConfig = readLocalAiEnv();
  if (localAiConfig) {
    await preflightLocalAi(localAiConfig);
  }

  const metroPort = await getAvailableE2EPort();
  const metroOutput = createLineBuffer();
  let metroProcess: ChildProcess | null = null;

  try {
    metroProcess = startMetro(metroPort, metroOutput);
    await waitForMetro(metroPort, {
      label: "Metro web server",
      timeoutMs: 120_000,
      childProcess: metroProcess,
      getRecentOutput: metroOutput.dump,
    });
    await warmMetro(metroPort);
    process.env.E2E_METRO_PORT = String(metroPort);
    console.log(`[e2e] Metro warmed on port ${metroPort}`);

    return async () => {
      await killProcessTree(metroProcess);
      console.log("[e2e] Metro stopped");
    };
  } catch (error) {
    await killProcessTree(metroProcess);
    throw error;
  }
}
