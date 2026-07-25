import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server as HTTPServer } from "http";
import type pino from "pino";
import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import type { DownloadTokenStore } from "./file-download/token-store.js";
import type { DaemonConfigStore } from "./daemon-config-store.js";
import type { FileBackedChatService } from "./chat/chat-service.js";
import type { LoopService } from "./loop-service.js";
import type { ScheduleService } from "./schedule/service.js";
import type { CheckoutDiffManager } from "./checkout-diff-manager.js";
import type { LspService } from "./lsp/service.js";
import { asInternals, createStub } from "./test-utils/class-mocks.js";
import {
  createDaemonConfigStoreStub,
  createProviderSnapshotManagerStub,
} from "./test-utils/session-stubs.js";
import type { WorkspaceAutoName } from "./workspace-auto-name.js";

const wsModuleMock = vi.hoisted(() => {
  class MockWebSocketServer {
    on() {
      return this;
    }

    close() {
      // no-op
    }
  }

  return { MockWebSocketServer };
});

vi.mock("ws", () => ({
  WebSocketServer: wsModuleMock.MockWebSocketServer,
}));

vi.mock("./session.js", () => ({
  Session: function Session() {
    return {};
  },
}));

import { VoiceAssistantWebSocketServer } from "./websocket-server.js";

function createLogger() {
  const logger = {
    child: vi.fn(() => logger),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger;
}

/**
 * Stands in for the daemon-scoped pool. Only the lifecycle calls matter here — this test
 * exists because those had no production caller at all, not to re-check what they do.
 */
function createLspServiceSpy() {
  return {
    reapIdle: vi.fn(async () => {}),
    stopAll: vi.fn(async () => {}),
    setSettings: vi.fn(),
    onActivityChange: vi.fn(),
    onDiagnosticsChange: vi.fn(),
  };
}

function createServer() {
  const agentManager = {
    subscribe: vi.fn(() => () => {}),
    setAgentAttentionCallback: vi.fn(),
    getMetricsSnapshot: vi.fn(() => ({
      total: 0,
      byLifecycle: {},
      withActiveForegroundTurn: 0,
      timelineStats: { totalItems: 0, maxItemsPerAgent: 0 },
    })),
  };

  const server = new VoiceAssistantWebSocketServer(
    createStub<HTTPServer>({}),
    createStub<pino.Logger>(createLogger()),
    "srv-lsp-lifecycle",
    createStub<AgentManager>(agentManager),
    createStub<AgentStorage>({}),
    createStub<DownloadTokenStore>({}),
    "/tmp/otto-test",
    createStub<DaemonConfigStore>(createDaemonConfigStoreStub()),
    null,
    { allowedOrigins: new Set() },
    createStub<WorkspaceAutoName>({
      scheduleForWorktree: () => {},
      scheduleForDirectory: () => {},
    }),
    undefined,
    undefined,
    undefined,
    undefined,
    "1.2.3-test",
    undefined,
    undefined,
    undefined,
    createStub<FileBackedChatService>({}),
    createStub<LoopService>({}),
    createStub<ScheduleService>({}),
    createStub<CheckoutDiffManager>({
      subscribe: vi.fn(),
      scheduleRefreshForCwd: vi.fn(),
      getMetrics: vi.fn(() => ({
        checkoutDiffTargetCount: 0,
        checkoutDiffSubscriptionCount: 0,
        checkoutDiffWatcherCount: 0,
        checkoutDiffFallbackRefreshTargetCount: 0,
      })),
      dispose: vi.fn(),
    }),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    createProviderSnapshotManagerStub().manager,
  );

  // Swapped in after construction: the interval and the shutdown path both read the
  // field when they fire, so the real pool never has to spawn anything here.
  const lspService = createLspServiceSpy();
  asInternals<{ lspService: LspService }>(server).lspService = lspService as unknown as LspService;

  return { server, lspService };
}

// The pool deliberately holds no timers so its clock can be injected in unit tests. That
// makes the daemon the only thing that can drive expiry, and for a while nothing did:
// every language server stayed resident until the process exited.
describe("the daemon's language-server lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reaps idle language servers on an interval", async () => {
    const { server, lspService } = createServer();

    await vi.advanceTimersByTimeAsync(90_000);

    expect(lspService.reapIdle.mock.calls.length).toBeGreaterThanOrEqual(3);
    await server.close();
  });

  it("stops every language server on shutdown, and stops ticking", async () => {
    const { server, lspService } = createServer();

    await server.close();

    expect(lspService.stopAll).toHaveBeenCalledTimes(1);

    lspService.reapIdle.mockClear();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(lspService.reapIdle).not.toHaveBeenCalled();
  });
});
