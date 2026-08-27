import { describe, expect, it } from "vitest";
import { KANBAN_REMEDIATION_GITHUB_SCOPES } from "@otto-code/protocol/kanban";
import type { MutableDaemonConfig } from "@otto-code/protocol/messages";
import type { SessionOutboundMessage } from "@otto-code/protocol/messages";
import { KanbanSession } from "./kanban-session.js";
import { KanbanRemediationError } from "./kanban-remediation.js";
import type { KanbanRegistry } from "./kanban-registry.js";
import type { KanbanBoardListContext, KanbanProvider } from "./types.js";
import type { KanbanBoardRef } from "@otto-code/protocol/kanban";
import type { KanbanProjectTarget } from "./kanban-session.js";

const REMEDIATION = {
  reason: KANBAN_REMEDIATION_GITHUB_SCOPES,
  missingScopes: ["read:project"],
  steps: [
    {
      command: "gh",
      args: ["auth", "refresh", "-s", "read:project,project"],
      display: "gh auth refresh -s read:project,project",
    },
  ],
} as const;

/**
 * A provider that fails until its credential is re-read, which is what the gh
 * CLI actually does: `gh auth refresh` mints a *new* token, so the fix only
 * takes effect for a caller that reads the credential again.
 */
function makeScopeGatedProvider(): { provider: KanbanProvider; initializeCount: () => number } {
  let initializations = 0;
  const provider: KanbanProvider = {
    providerId: "github",
    async initialize() {
      initializations += 1;
    },
    async listBoards(): Promise<KanbanBoardRef[]> {
      if (initializations < 2) {
        throw new KanbanRemediationError("missing Projects access", { ...REMEDIATION });
      }
      return [{ providerId: "github", boardId: "PVT_1", title: "Engineering" }];
    },
    async getBoard() {
      throw new Error("not used");
    },
    async moveCard() {},
    async createCard() {
      throw new Error("not used");
    },
    async linkExternalTask() {
      throw new Error("not used");
    },
  };
  return { provider, initializeCount: () => initializations };
}

function makeSession(
  provider: KanbanProvider,
  target: KanbanProjectTarget = { adapter: "github", boardId: null },
) {
  const emitted: SessionOutboundMessage[] = [];
  const registry: KanbanRegistry = {
    listProviderIds: () => [provider.providerId],
    getProvider: (id) => (id === provider.providerId ? provider : null),
    initialize: async () => {
      await provider.initialize({});
    },
    dispose: () => {},
  };
  const session = new KanbanSession({
    emit: (message) => emitted.push(message),
    readConfig: () => ({}) as MutableDaemonConfig,
    resolveProjectTarget: async () => target,
    log: { info: () => {}, error: () => {} },
    createRegistry: () => registry,
  });
  return { session, emitted };
}

function boardsListPayload(message: SessionOutboundMessage | undefined) {
  if (!message || message.type !== "kanban.boards.list.response") {
    throw new Error(`expected a boards list response, got ${message?.type}`);
  }
  return message.payload;
}

describe("KanbanSession remediation", () => {
  it("forwards the provider's remediation to the wire", async () => {
    const { provider } = makeScopeGatedProvider();
    const { session, emitted } = makeSession(provider);

    await session.handleBoardsListRequest({
      type: "kanban.boards.list.request",
      providerId: "github",
      projectId: "project-1",
      requestId: "req-1",
    });

    const payload = boardsListPayload(emitted[0]);
    expect(payload.error).toBe("missing Projects access");
    expect(payload.remediation?.reason).toBe(KANBAN_REMEDIATION_GITHUB_SCOPES);
    expect(payload.remediation?.steps[0]?.display).toBe("gh auth refresh -s read:project,project");
  });

  it("re-reads the credential after a remediable failure, so the retry succeeds", async () => {
    const { provider, initializeCount } = makeScopeGatedProvider();
    const { session, emitted } = makeSession(provider);
    const request = {
      type: "kanban.boards.list.request",
      providerId: "github",
      projectId: "project-1",
      requestId: "req-1",
    } as const;

    await session.handleBoardsListRequest(request);
    expect(initializeCount()).toBe(1);

    // The user runs the command and hits refresh. Without dropping the cached
    // initialization the provider would still hold the pre-refresh token and
    // this second call would fail identically.
    await session.handleBoardsListRequest({ ...request, requestId: "req-2" });

    expect(initializeCount()).toBe(2);
    const payload = boardsListPayload(emitted[1]);
    expect(payload.error).toBeNull();
    expect(payload.boards).toHaveLength(1);
  });

  it("keeps the initialized provider when the failure is not remediable", async () => {
    let initializations = 0;
    const provider: KanbanProvider = {
      providerId: "github",
      async initialize() {
        initializations += 1;
      },
      async listBoards(): Promise<KanbanBoardRef[]> {
        throw new Error("GitHub is unreachable");
      },
      async getBoard() {
        throw new Error("not used");
      },
      async moveCard() {},
      async createCard() {
        throw new Error("not used");
      },
      async linkExternalTask() {
        throw new Error("not used");
      },
    };
    const { session, emitted } = makeSession(provider);
    const request = {
      type: "kanban.boards.list.request",
      providerId: "github",
      projectId: "project-1",
      requestId: "req-1",
    } as const;

    await session.handleBoardsListRequest(request);
    await session.handleBoardsListRequest({ ...request, requestId: "req-2" });

    expect(initializations).toBe(1);
    expect(boardsListPayload(emitted[1]).remediation).toBeNull();
  });
});

describe("KanbanSession configured target", () => {
  it("passes the explicit board and its owner to the provider", async () => {
    let context: KanbanBoardListContext | null = null;
    const provider: KanbanProvider = {
      providerId: "github",
      async initialize() {},
      async listBoards(input) {
        context = input;
        return [{ providerId: "github", boardId: "PVT_12", title: "Release" }];
      },
      async getBoard() {
        throw new Error("not used");
      },
      async moveCard() {},
      async createCard() {
        throw new Error("not used");
      },
      async linkExternalTask() {
        throw new Error("not used");
      },
    };
    const { session } = makeSession(provider, {
      adapter: "github",
      boardId: "12",
      boardOwner: "acme",
      owner: "widgets",
      repo: "otto",
    });

    await session.handleBoardsListRequest({
      type: "kanban.boards.list.request",
      providerId: "github",
      projectId: "project-1",
      requestId: "req-1",
    });

    expect(context).toEqual({
      owner: "widgets",
      repo: "otto",
      targetBoardId: "12",
      targetBoardOwner: "acme",
    });
  });
});
