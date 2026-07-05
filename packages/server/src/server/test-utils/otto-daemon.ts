import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";

import pino from "pino";
import {
  createOttoDaemon,
  type OttoDaemonConfig,
  type OttoOpenAIConfig,
  type OttoSpeechConfig,
} from "../bootstrap.js";
import type { AgentClient, AgentProvider } from "../agent/agent-sdk-types.js";
import { createTestAgentClients } from "./fake-agent-client.js";
import type { PushNotificationSender } from "../push/notifications.js";

interface TestOttoDaemonOptions {
  downloadTokenTtlMs?: number;
  corsAllowedOrigins?: string[];
  listen?: string;
  logger?: Parameters<typeof createOttoDaemon>[1];
  mcpEnabled?: boolean;
  mcpDebug?: boolean;
  isDev?: boolean;
  relayEnabled?: boolean;
  relayEndpoint?: string;
  agentClients?: Partial<Record<AgentProvider, AgentClient>>;
  providerOverrides?: OttoDaemonConfig["providerOverrides"];
  ottoHomeRoot?: string;
  staticDir?: string;
  cleanup?: boolean;
  openai?: OttoOpenAIConfig;
  speech?: OttoSpeechConfig;
  voiceLlmProvider?: OttoDaemonConfig["voiceLlmProvider"];
  voiceLlmProviderExplicit?: boolean;
  voiceLlmModel?: string | null;
  dictationFinalTimeoutMs?: number;
  auth?: OttoDaemonConfig["auth"];
  pushNotificationSender?: PushNotificationSender;
  serviceProxy?: OttoDaemonConfig["serviceProxy"];
  webUi?: OttoDaemonConfig["webUi"];
  trustedProxies?: OttoDaemonConfig["trustedProxies"];
}

export interface TestOttoDaemon {
  config: OttoDaemonConfig;
  daemon: Awaited<ReturnType<typeof createOttoDaemon>>;
  port: number;
  ottoHome: string;
  staticDir: string;
  close: () => Promise<void>;
}

const TEST_DAEMON_START_TIMEOUT_MS = 20_000;

async function startDaemonWithTimeout(
  daemon: Awaited<ReturnType<typeof createOttoDaemon>>,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      const timeoutError = new Error(
        `Timed out starting test daemon after ${timeoutMs}ms`,
      ) as Error & { code?: string };
      timeoutError.code = "TEST_DAEMON_START_TIMEOUT";
      reject(timeoutError);
    }, timeoutMs);

    daemon.start().then(
      () => {
        clearTimeout(timeoutHandle);
        resolve();
        return;
      },
      (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      },
    );
  });
}

export async function createTestOttoDaemon(
  options: TestOttoDaemonOptions = {},
): Promise<TestOttoDaemon> {
  const maxAttempts = 8;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { config, ottoHomeRoot, ottoHome, staticDir } = await prepareTestDaemonConfig(options);
    const logger = options.logger ?? pino({ level: "silent" });
    const daemon = await createOttoDaemon(config, logger);
    try {
      await startDaemonWithTimeout(daemon, TEST_DAEMON_START_TIMEOUT_MS);
      const listenTarget = daemon.getListenTarget();
      if (!listenTarget || listenTarget.type !== "tcp") {
        throw new Error("Test daemon did not expose a bound TCP listen target");
      }

      const close = async (): Promise<void> => {
        await daemon.stop().catch(() => undefined);
        await daemon.agentManager.flush().catch(() => undefined);
        if (options.cleanup ?? true) {
          await new Promise((r) => setTimeout(r, 50));
          await Promise.all([
            rm(ottoHomeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
            rm(staticDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
          ]);
        }
      };

      return {
        config,
        daemon,
        port: listenTarget.port,
        ottoHome,
        staticDir,
        close,
      };
    } catch (error) {
      lastError = error;
      await daemon.stop().catch(() => undefined);
      await Promise.all([
        rm(ottoHomeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
        rm(staticDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
      ]);

      if (
        (!isAddressInUseError(error) && !isStartupTimeoutError(error)) ||
        attempt === maxAttempts - 1
      ) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Failed to start test daemon");
}

interface PreparedTestDaemonConfig {
  config: OttoDaemonConfig;
  ottoHomeRoot: string;
  ottoHome: string;
  staticDir: string;
}

async function prepareTestDaemonConfig(
  options: TestOttoDaemonOptions,
): Promise<PreparedTestDaemonConfig> {
  const ottoHomeRoot =
    options.ottoHomeRoot ?? (await mkdtemp(path.join(os.tmpdir(), "otto-home-")));
  const ottoHome = path.join(ottoHomeRoot, ".otto");
  await mkdir(ottoHome, { recursive: true });
  const staticDir = options.staticDir ?? (await mkdtemp(path.join(os.tmpdir(), "otto-static-")));
  const listenHost = options.listen ?? "127.0.0.1";
  const config: OttoDaemonConfig = {
    listen: `${listenHost}:0`,
    ottoHome,
    corsAllowedOrigins: options.corsAllowedOrigins ?? [],
    hostnames: true,
    mcpEnabled: options.mcpEnabled ?? true,
    staticDir,
    mcpDebug: options.mcpDebug ?? false,
    isDev: options.isDev,
    agentClients: options.agentClients ?? createTestAgentClients(),
    providerOverrides: options.providerOverrides,
    agentStoragePath: path.join(ottoHome, "agents"),
    relayEnabled: options.relayEnabled ?? false,
    relayEndpoint: options.relayEndpoint ?? "relay.otto-code.me:443",
    appBaseUrl: "https://app.otto-code.me",
    auth: options.auth,
    pushNotificationSender: options.pushNotificationSender,
    serviceProxy: options.serviceProxy,
    webUi: options.webUi,
    trustedProxies: options.trustedProxies,
    openai: options.openai,
    speech: options.speech,
    voiceLlmProvider: options.voiceLlmProvider ?? null,
    voiceLlmProviderExplicit: options.voiceLlmProviderExplicit ?? false,
    voiceLlmModel: options.voiceLlmModel ?? null,
    dictationFinalTimeoutMs: options.dictationFinalTimeoutMs,
    downloadTokenTtlMs: options.downloadTokenTtlMs,
  };
  return { config, ottoHomeRoot, ottoHome, staticDir };
}

function isAddressInUseError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: string };
  return record.code === "EADDRINUSE";
}

function isStartupTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: string };
  return record.code === "TEST_DAEMON_START_TIMEOUT";
}
