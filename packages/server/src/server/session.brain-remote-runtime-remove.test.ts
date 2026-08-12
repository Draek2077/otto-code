// Regression: a runtime remove must land on whichever host owns the runtimes.
//
// The runtime list is served by the remote brain in brain.mode=remote, so the
// names the user sees are that host's. Before this test, the remove handler was
// the only brain mutation with no remote branch: it fell straight through to
// BrainOpsManager, which spawns `otto brain runtime remove <name>` against the
// LOCAL $OTTO_HOME/otto-brain/runtimes and rm -rf's the match. The invariant
// proven here is that with a remote brain configured, nothing on the remove path
// reaches the local ops manager at all.
import { describe, expect, test, vi } from "vitest";

import type { SessionOutboundMessage } from "@otto-code/protocol/messages";

import { Session, type SessionOptions } from "./session.js";
import { asInternals, createStub } from "./test-utils/class-mocks.js";
import { createProviderSnapshotManagerStub } from "./test-utils/session-stubs.js";
import { createNoopWorkspaceGitService } from "./test-utils/workspace-git-service-stub.js";

const REMOTE_JOB = {
  id: "brainjob_remote",
  kind: "runtime-remove",
  label: "runtime-remove b10355-win-cuda",
  target: "b10355-win-cuda",
  status: "running",
  percent: null,
  message: null,
  error: null,
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: null,
};

interface Harness {
  session: Session;
  emitted: SessionOutboundMessage[];
  hostJob: ReturnType<typeof vi.fn>;
  removeRuntime: ReturnType<typeof vi.fn>;
}

function createHarness(mode: "local" | "remote"): Harness {
  const emitted: SessionOutboundMessage[] = [];
  const logger = {
    child: () => logger,
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const hostJob = vi.fn(async () => ({ job: REMOTE_JOB }));
  const removeRuntime = vi.fn(() => LOCAL_JOB);

  const session = new Session({
    clientId: "brain-remote-test",
    scopes: ["*"],
    appVersion: null,
    onMessage: (message) => emitted.push(message),
    logger: createStub<SessionOptions["logger"]>(logger),
    downloadTokenStore: createStub<SessionOptions["downloadTokenStore"]>({}),
    pushTokenStore: createStub<SessionOptions["pushTokenStore"]>({}),
    ottoHome: "/tmp/otto-home-brain-remote-test",
    agentManager: createStub<SessionOptions["agentManager"]>({
      subscribe: () => () => {},
      listAgents: () => [],
    }),
    agentStorage: createStub<SessionOptions["agentStorage"]>({
      list: async () => [],
      get: async () => null,
    }),
    projectRegistry: createStub<SessionOptions["projectRegistry"]>({
      subscribeToMutations: () => () => {},
      list: async () => [],
      get: async () => null,
    }),
    workspaceRegistry: createStub<SessionOptions["workspaceRegistry"]>({
      subscribeToMutations: () => () => {},
      list: async () => [],
      get: async () => null,
    }),
    filesystem: { isDirectory: async () => true },
    chatService: createStub<SessionOptions["chatService"]>({}),
    scheduleService: createStub<SessionOptions["scheduleService"]>({}),
    loopService: createStub<SessionOptions["loopService"]>({}),
    checkoutDiffManager: createStub<SessionOptions["checkoutDiffManager"]>({
      scheduleRefreshForCwd: () => {},
    }),
    workspaceGitService: createNoopWorkspaceGitService({}),
    daemonConfigStore: createStub<SessionOptions["daemonConfigStore"]>({
      get: () => ({ mcp: { injectIntoAgents: false }, providers: {} }),
      onChange: () => () => {},
    }),
    mcpBaseUrl: null,
    stt: null,
    tts: null,
    providerSnapshotManager: createProviderSnapshotManagerStub().manager,
    terminalManager: null,
    // Every managed Brain job is host-owned in both modes. The ops manager is
    // retained only as an explicit unavailable fallback for an unhosted brain.
    brainManager: createStub<NonNullable<SessionOptions["brainManager"]>>({
      isRemote: () => mode === "remote",
      hostJob,
    }),
    brainOpsManager: createStub<NonNullable<SessionOptions["brainOpsManager"]>>({
      removeRuntime,
    }),
  });

  return { session, emitted, hostJob, removeRuntime };
}

async function requestRemove(session: Session, name: string): Promise<void> {
  await asInternals<{ handleMessage(m: unknown): Promise<unknown> }>(session).handleMessage({
    type: "brain.runtime.remove.request",
    name,
    requestId: "req-remove-1",
  });
}

function removeResponse(emitted: SessionOutboundMessage[]) {
  const message = emitted.find((m) => m.type === "brain.runtime.remove.response");
  if (!message || message.type !== "brain.runtime.remove.response") return null;
  return message.payload;
}

describe("brain runtime remove target selection", () => {
  test("a remote brain removes on the remote host and never touches local disk", async () => {
    const { session, emitted, hostJob, removeRuntime } = createHarness("remote");

    await requestRemove(session, "b10355-win-cuda");
    await vi.waitFor(() => expect(removeResponse(emitted)).not.toBeNull());

    expect(hostJob).toHaveBeenCalledTimes(1);
    expect(hostJob).toHaveBeenCalledWith("runtime-remove", { name: "b10355-win-cuda" });
    // The invariant: the local ops manager, which is the only path to
    // fs.rmSync on this machine's runtimes directory, is never reached.
    expect(removeRuntime).not.toHaveBeenCalled();

    expect(removeResponse(emitted)).toEqual({
      job: REMOTE_JOB,
      error: null,
      requestId: "req-remove-1",
    });
  });

  test("a local brain removes through its hosted service, never a daemon sidecar", async () => {
    const { session, emitted, hostJob, removeRuntime } = createHarness("local");

    await requestRemove(session, "b10355-win-cuda");
    await vi.waitFor(() => expect(removeResponse(emitted)).not.toBeNull());

    expect(hostJob).toHaveBeenCalledWith("runtime-remove", { name: "b10355-win-cuda" });
    expect(removeRuntime).not.toHaveBeenCalled();
    expect(removeResponse(emitted)).toEqual({
      job: REMOTE_JOB,
      error: null,
      requestId: "req-remove-1",
    });
  });
});
