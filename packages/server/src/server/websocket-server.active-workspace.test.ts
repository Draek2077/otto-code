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
import type { Session } from "./session.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
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

interface FakeSocket {
  id: string;
}

/**
 * Only the one call this test is about. The rest of the service is untouched here:
 * what matters is whether the daemon ever tells it that nobody is attached.
 */
function createWorkspaceGitServiceSpy() {
  return {
    setActiveWorkspace: vi.fn(),
    // Read by the runtime-metrics flush on shutdown.
    getMetrics: vi.fn(() => ({
      workspaceTargetCount: 0,
      workspaceListenerCount: 0,
      repositoryTargetCount: 0,
      repositoryWorkspaceLinkCount: 0,
      workingTreeWatchTargetCount: 0,
      workingTreeWatchListenerCount: 0,
      workspaceObservationSetupInFlightCount: 0,
      workingTreeWatchSetupInFlightCount: 0,
      workspaceRefreshInFlightCount: 0,
      workspaceRefreshQueuedCount: 0,
      fetchInFlightCount: 0,
      snapshotUpdatedListenerCount: 0,
    })),
    dispose: vi.fn(),
  };
}

function createServer() {
  const agentManager = {
    subscribe: vi.fn(() => () => {}),
    setAgentAttentionCallback: vi.fn(),
    setAgentActivelyWatchedProbe: vi.fn(),
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
    "srv-active-workspace",
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

  const workspaceGitService = createWorkspaceGitServiceSpy();
  asInternals<{ workspaceGitService: WorkspaceGitService }>(server).workspaceGitService =
    workspaceGitService as unknown as WorkspaceGitService;

  return { server, workspaceGitService };
}

interface ServerInternals {
  sessions: Map<unknown, unknown>;
  detachSocket: (ws: unknown, details: { code?: number }) => Promise<void>;
}

/**
 * Attach a client the way the hello handshake would, minus the handshake. This test is about
 * what the *disconnect* path does, so seeding the session map is the honest shortcut.
 */
function attachClient(server: VoiceAssistantWebSocketServer, clientId: string): FakeSocket {
  const socket: FakeSocket = { id: clientId };
  asInternals<ServerInternals>(server).sessions.set(socket, {
    kind: "trusted",
    session: createStub<Session>({
      clearAgentTimelineSubscription: vi.fn(),
      cleanup: vi.fn(),
    }),
    clientId,
    appVersion: null,
    clientCapabilities: null,
    connectionLogger: createStub<pino.Logger>(createLogger()),
    sockets: new Set([socket]),
    externalDisconnectCleanupTimeout: null,
  });
  return socket;
}

async function disconnect(
  server: VoiceAssistantWebSocketServer,
  socket: FakeSocket,
): Promise<void> {
  await asInternals<ServerInternals>(server).detachSocket(socket, { code: 1000 });
}

// `setActiveWorkspace` is only ever called from a client focus signal, and it is sticky on
// purpose. Nothing ever passed null, so the workspace the last client happened to be looking
// at stayed "active" forever: a 60 s self-heal (~15-22 git spawns a minute) and a 180 s
// background `git fetch` running all night against a daemon with nobody attached.
describe("the daemon's active workspace when clients leave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("releases the active workspace when the last client disconnects", async () => {
    const { server, workspaceGitService } = createServer();
    const socket = attachClient(server, "only-client");

    await disconnect(server, socket);

    expect(workspaceGitService.setActiveWorkspace).toHaveBeenCalledWith(null);
    await server.close();
  });

  it("keeps the active workspace while another client is still attached", async () => {
    const { server, workspaceGitService } = createServer();
    const first = attachClient(server, "client-a");
    const second = attachClient(server, "client-b");

    await disconnect(server, first);

    expect(workspaceGitService.setActiveWorkspace).not.toHaveBeenCalled();

    await disconnect(server, second);

    expect(workspaceGitService.setActiveWorkspace).toHaveBeenCalledWith(null);
    await server.close();
  });
});
