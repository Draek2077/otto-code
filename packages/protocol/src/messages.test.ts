import { describe, expect, test } from "vitest";
import {
  AgentSnapshotPayloadSchema,
  BrainRepoQuantSchema,
  FileExplorerRequestSchema,
  MutableDaemonConfigPatchSchema,
  MutableDaemonConfigSchema,
  OttoWorktreeArchiveRequestSchema,
  parseServerInfoStatusPayload,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("Brain Hugging Face bundle discovery compatibility", () => {
  test("accepts a detected projector on a quant row", () => {
    expect(
      BrainRepoQuantSchema.parse({
        quant: "Q4_K_M",
        size: "4.2 GB",
        projector: {
          file: "mmproj-model-f16.gguf",
          sizeBytes: 512_000_000,
          installed: true,
        },
      }),
    ).toMatchObject({
      projector: {
        file: "mmproj-model-f16.gguf",
        sizeBytes: 512_000_000,
        installed: true,
      },
    });
  });

  test("accepts explicit components on an arbitrary repository download", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "brain.models.add.request",
        repo: "publisher/vision-GGUF",
        quant: "Q4_K_M",
        components: ["vision-projector"],
        requestId: "request-1",
      }),
    ).toMatchObject({ components: ["vision-projector"] });
  });

  test("continues to accept quant rows from older Brain hosts", () => {
    expect(BrainRepoQuantSchema.parse({ quant: "Q4_K_M", size: "4.2 GB" }).projector).toBe(
      undefined,
    );
  });
});

describe("Brain runtime log verbosity capability", () => {
  test("remains optional for older daemons and accepts capable hosts", () => {
    const legacy = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server",
      features: {},
    });
    expect(legacy.features?.brainRuntimeLogVerbosity).toBeUndefined();

    const capable = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server",
      features: { brainRuntimeLogVerbosity: true },
    });
    expect(capable.features?.brainRuntimeLogVerbosity).toBe(true);
  });
});

describe("Workflow start confirmation capability", () => {
  test("remains unavailable rather than synthesized for an older daemon", () => {
    const legacy = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server",
      features: { workflowStartRpc: true },
    });
    expect(legacy.features?.workflowStartConfirmation).toBeUndefined();

    const capable = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server",
      features: { workflowStartConfirmation: true },
    });
    expect(capable.features?.workflowStartConfirmation).toBe(true);
  });
});

describe("Graph Check output-port capability", () => {
  test("remains absent on older hosts and additive on capable hosts", () => {
    const legacy = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server",
      features: { orchestrationGraphs: true },
    });
    expect(legacy.features?.graphCheckOutputPorts).toBeUndefined();

    const capable = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server",
      features: { orchestrationGraphs: true, graphCheckOutputPorts: true },
    });
    expect(capable.features?.graphCheckOutputPorts).toBe(true);
  });
});

function workspaceDescriptor(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    projectId: "remote:github.com/acme/app",
    projectDisplayName: "acme/app",
    projectRootPath: "/repo/app",
    workspaceDirectory: "/repo/app",
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: "app",
    status: "done",
    activityAt: null,
    diffStat: null,
    scripts: [],
    ...overrides,
  };
}

function fetchWorkspacesResponse(workspace: Record<string, unknown>) {
  return {
    type: "fetch_workspaces_response",
    payload: {
      requestId: "req-1",
      entries: [workspace],
      pageInfo: {
        nextCursor: null,
        prevCursor: null,
        hasMore: false,
      },
    },
  };
}

describe("project icon message security", () => {
  test("rejects URL sources at the daemon boundary", () => {
    const parsed = SessionInboundMessageSchema.safeParse({
      type: "project.icon.set.request",
      projectId: "project-1",
      source: { type: "url", url: "http://127.0.0.1/private" },
      requestId: "request-1",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("workspace descriptor message compatibility", () => {
  test("old-shaped fetch_workspaces_response without project still parses", () => {
    const parsed = SessionOutboundMessageSchema.parse(
      fetchWorkspacesResponse(workspaceDescriptor()),
    );

    expect(parsed.type).toBe("fetch_workspaces_response");
    if (parsed.type !== "fetch_workspaces_response") {
      throw new Error("Expected fetch_workspaces_response");
    }
    expect(parsed.payload.entries[0]?.project).toBeUndefined();
  });

  test("new-shaped fetch_workspaces_response with project placement parses", () => {
    const parsed = SessionOutboundMessageSchema.parse(
      fetchWorkspacesResponse(
        workspaceDescriptor({
          project: {
            projectKey: "remote:github.com/acme/app",
            projectName: "acme/app",
            checkout: {
              cwd: "/repo/app",
              isGit: true,
              currentBranch: "main",
              remoteUrl: "https://github.com/acme/app.git",
              worktreeRoot: "/repo/app",
              isOttoOwnedWorktree: false,
              mainRepoRoot: null,
            },
          },
        }),
      ),
    );

    expect(parsed.type).toBe("fetch_workspaces_response");
    if (parsed.type !== "fetch_workspaces_response") {
      throw new Error("Expected fetch_workspaces_response");
    }
    expect(parsed.payload.entries[0]?.project).toEqual({
      projectKey: "remote:github.com/acme/app",
      projectName: "acme/app",
      checkout: {
        cwd: "/repo/app",
        isGit: true,
        currentBranch: "main",
        remoteUrl: "https://github.com/acme/app.git",
        worktreeRoot: "/repo/app",
        isOttoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    });
  });

  test("adding project does not narrow existing descriptor fields", () => {
    const parsed = SessionOutboundMessageSchema.parse(
      fetchWorkspacesResponse(
        workspaceDescriptor({
          workspaceDirectory: undefined,
          projectKind: "non_git",
          workspaceKind: "directory",
          gitRuntime: null,
          githubRuntime: null,
          project: {
            projectKey: "/repo/local",
            projectName: "local",
            checkout: {
              cwd: "/repo/local",
              isGit: false,
              currentBranch: null,
              remoteUrl: null,
              worktreeRoot: null,
              isOttoOwnedWorktree: false,
              mainRepoRoot: null,
            },
          },
        }),
      ),
    );

    expect(parsed.type).toBe("fetch_workspaces_response");
    if (parsed.type !== "fetch_workspaces_response") {
      throw new Error("Expected fetch_workspaces_response");
    }
    expect(parsed.payload.entries[0]).toMatchObject({
      projectKind: "non_git",
      workspaceKind: "directory",
      workspaceDirectory: "/repo/app",
      gitRuntime: null,
      githubRuntime: null,
    });
  });
});

describe("agent context usage message contract", () => {
  test("accepts the get_usage request as a namespaced correlated RPC", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "agent.context.get_usage.request",
      agentId: "agent-1",
      requestId: "ctx-1",
    });

    expect(parsed).toEqual({
      type: "agent.context.get_usage.request",
      agentId: "agent-1",
      requestId: "ctx-1",
    });
  });

  test("accepts a category breakdown with deferred entries", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "agent.context.get_usage.response",
      payload: {
        requestId: "ctx-2",
        agentId: "agent-1",
        usage: {
          categories: [
            { name: "Messages", tokens: 105200 },
            { name: "System prompt", tokens: 4800 },
            { name: "MCP tools (deferred)", tokens: 108100, isDeferred: true },
          ],
          totalTokens: 137500,
          maxTokens: 1000000,
        },
      },
    });

    expect(parsed.type).toBe("agent.context.get_usage.response");
    if (parsed.type !== "agent.context.get_usage.response") {
      throw new Error("Expected agent.context.get_usage.response");
    }
    expect(parsed.payload.usage?.categories[0]?.name).toBe("Messages");
    expect(parsed.payload.usage?.categories[2]?.isDeferred).toBe(true);
  });

  test("accepts a null usage payload from providers without a breakdown", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "agent.context.get_usage.response",
      payload: {
        requestId: "ctx-3",
        agentId: "agent-1",
        usage: null,
      },
    });

    expect(parsed.type).toBe("agent.context.get_usage.response");
    if (parsed.type !== "agent.context.get_usage.response") {
      throw new Error("Expected agent.context.get_usage.response");
    }
    expect(parsed.payload.usage).toBeNull();
  });
});

describe("provider usage list message contract", () => {
  test("accepts the usage list request as a namespaced correlated RPC", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "provider.usage.list.request",
      requestId: "usage-1",
    });

    expect(parsed).toEqual({
      type: "provider.usage.list.request",
      requestId: "usage-1",
    });
  });

  test("accepts new providers and new usage windows as normalized data", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "provider.usage.list.response",
      payload: {
        requestId: "usage-2",
        fetchedAt: "2026-06-19T00:00:00.000Z",
        providers: [
          {
            providerId: "glm",
            displayName: "GLM coding plan",
            status: "available",
            planLabel: "GLM coding plan",
            fetchedAt: "2026-06-19T00:00:00.000Z",
            windows: [
              {
                id: "biweekly",
                label: "Biweekly",
                usedPct: 23,
                remainingPct: 77,
                resetsAt: "2026-07-03T00:00:00.000Z",
                tone: "ok",
              },
            ],
            balances: [
              {
                id: "credits",
                label: "Credits",
                remaining: 120,
                unit: "credits",
              },
            ],
            details: [{ id: "region", label: "Region", value: "US" }],
            error: null,
          },
        ],
      },
    });

    expect(parsed.type).toBe("provider.usage.list.response");
    if (parsed.type !== "provider.usage.list.response") {
      throw new Error("Expected provider.usage.list.response");
    }
    expect(parsed.payload.providers[0]?.providerId).toBe("glm");
    expect(parsed.payload.providers[0]?.windows[0]?.label).toBe("Biweekly");
  });

  test("keeps protocol numbers strict after API boundary normalization", () => {
    const parsed = SessionOutboundMessageSchema.safeParse({
      type: "provider.usage.list.response",
      payload: {
        requestId: "usage-3",
        fetchedAt: "2026-06-19T00:00:00.000Z",
        providers: [
          {
            providerId: "claude",
            displayName: "Claude",
            status: "available",
            planLabel: "Max 20x",
            windows: [
              {
                id: "session",
                label: "Session",
                usedPct: "7",
              },
            ],
          },
        ],
      },
    });

    expect(parsed.success).toBe(false);
  });
});

describe("diagnostics message contract", () => {
  test("accepts the diagnostics request as a simple namespaced RPC", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "diagnostics.request",
      requestId: "diag-1",
    });

    expect(parsed).toEqual({
      type: "diagnostics.request",
      requestId: "diag-1",
    });
  });

  test("accepts a copyable diagnostics response", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "diagnostics.response",
      payload: {
        requestId: "diag-2",
        diagnostic: "Otto diagnostics\n  Status: ok",
      },
    });

    expect(parsed.type).toBe("diagnostics.response");
    if (parsed.type !== "diagnostics.response") {
      throw new Error("Expected diagnostics.response");
    }
    expect(parsed.payload.diagnostic).toContain("Status: ok");
  });
});

describe("agent detach RPC", () => {
  test("parses the namespaced detach request", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "agent.detach.request",
      agentId: "child-agent",
      requestId: "req-detach",
    });

    expect(parsed).toEqual({
      type: "agent.detach.request",
      agentId: "child-agent",
      requestId: "req-detach",
    });
  });

  test("parses the namespaced detach response", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "agent.detach.response",
      payload: {
        requestId: "req-detach",
        agentId: "child-agent",
        accepted: true,
        error: null,
      },
    });

    expect(parsed.type).toBe("agent.detach.response");
  });

  test("parses the agentDetach server feature gate", () => {
    const parsed = parseServerInfoStatusPayload({
      status: "server_info",
      serverId: "srv-test",
      features: {
        agentDetach: true,
      },
    });

    if (!parsed) {
      throw new Error("Expected server info payload to parse");
    }
    expect(parsed.features?.agentDetach).toBe(true);
  });
});

describe("agent setting action responses", () => {
  test("parses optional provider notices on mode and thinking responses", () => {
    const mode = SessionOutboundMessageSchema.parse({
      type: "set_agent_mode_response",
      payload: {
        requestId: "req-mode",
        agentId: "agent-1",
        accepted: true,
        error: null,
        notice: {
          type: "info",
          message: "This change applies next turn.",
        },
      },
    });
    const thinking = SessionOutboundMessageSchema.parse({
      type: "set_agent_thinking_response",
      payload: {
        requestId: "req-thinking",
        agentId: "agent-1",
        accepted: true,
        error: null,
      },
    });

    expect(mode.type).toBe("set_agent_mode_response");
    if (mode.type !== "set_agent_mode_response") {
      throw new Error("Expected set_agent_mode_response");
    }
    expect(mode.payload.notice).toEqual({
      type: "info",
      message: "This change applies next turn.",
    });
    expect(thinking.type).toBe("set_agent_thinking_response");
    if (thinking.type !== "set_agent_thinking_response") {
      throw new Error("Expected set_agent_thinking_response");
    }
    expect(thinking.payload.notice).toBeUndefined();
  });
});

describe("file explorer request compatibility", () => {
  test("acceptBinary is optional for old clients and accepted for new clients", () => {
    expect(
      FileExplorerRequestSchema.parse({
        type: "file_explorer_request",
        cwd: "/repo/app",
        path: "image.png",
        mode: "file",
        requestId: "req-old",
      }),
    ).toEqual({
      type: "file_explorer_request",
      cwd: "/repo/app",
      path: "image.png",
      mode: "file",
      requestId: "req-old",
    });

    expect(
      FileExplorerRequestSchema.parse({
        type: "file_explorer_request",
        cwd: "/repo/app",
        path: "image.png",
        mode: "file",
        requestId: "req-new",
        acceptBinary: true,
      }),
    ).toMatchObject({
      type: "file_explorer_request",
      requestId: "req-new",
      acceptBinary: true,
    });
  });
});

describe("otto worktree archive request compatibility", () => {
  test("omitted scope defaults to workspace", () => {
    const parsed = OttoWorktreeArchiveRequestSchema.parse({
      type: "otto_worktree_archive_request",
      worktreePath: "/repo/app",
      requestId: "req-old-scope",
    });
    expect(parsed.scope).toBe("workspace");
  });

  test("scope worktree parses", () => {
    const parsed = OttoWorktreeArchiveRequestSchema.parse({
      type: "otto_worktree_archive_request",
      worktreePath: "/repo/app",
      scope: "worktree",
      requestId: "req-worktree-scope",
    });
    expect(parsed.scope).toBe("worktree");
  });

  test("unknown extra field is still accepted", () => {
    const parsed = OttoWorktreeArchiveRequestSchema.parse({
      type: "otto_worktree_archive_request",
      worktreePath: "/repo/app",
      requestId: "req-extra",
      extraField: "ignored",
    });
    expect(parsed).not.toHaveProperty("extraField");
    expect(parsed.scope).toBe("workspace");
  });
});

describe("daemon update messages", () => {
  test("daemon update progress is a scoped outbound message", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "daemon.update.progress",
      payload: {
        requestId: "update-1",
        phase: "installing",
      },
    });

    expect(parsed).toEqual({
      type: "daemon.update.progress",
      payload: {
        requestId: "update-1",
        phase: "installing",
      },
    });
  });
});

function agentSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-1",
    provider: "codex",
    cwd: "/repo/app",
    model: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastUserMessageAt: null,
    status: "idle",
    capabilities: {
      supportsStreaming: false,
      supportsSessionPersistence: false,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: false,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    ...overrides,
  };
}

describe("agent personalities compatibility", () => {
  test("agent snapshot without any personality fields still parses (pre-personality daemon)", () => {
    const parsed = AgentSnapshotPayloadSchema.parse(agentSnapshot());
    expect(parsed.personalityName).toBeUndefined();
    expect(parsed.personalityId).toBeUndefined();
    expect(parsed.personalitySpinner).toBeUndefined();
  });

  test("agent snapshot with personality identity fields parses and preserves them", () => {
    const parsed = AgentSnapshotPayloadSchema.parse(
      agentSnapshot({
        personalityName: "Vera",
        personalityId: "personality-vera",
        personalitySpinner: { glowA: "#f43f5e", glowB: "#fbbf24" },
      }),
    );
    expect(parsed.personalityName).toBe("Vera");
    expect(parsed.personalityId).toBe("personality-vera");
    expect(parsed.personalitySpinner).toEqual({ glowA: "#f43f5e", glowB: "#fbbf24" });
  });

  test("daemon config without agentPersonalities parses to the default empty roster", () => {
    const parsed = MutableDaemonConfigSchema.parse({ mcp: { injectIntoAgents: true } });
    expect(parsed.agentPersonalities).toEqual({ personalities: [] });
  });

  test("daemon config without model visibility policy defaults to all models visible", () => {
    const parsed = MutableDaemonConfigSchema.parse({ mcp: { injectIntoAgents: true } });
    expect(parsed.modelVisibilityOverrides).toEqual([]);

    const patch = MutableDaemonConfigPatchSchema.parse({ appendSystemPrompt: "x" });
    expect(patch).not.toHaveProperty("modelVisibilityOverrides");
  });

  test("a config patch without agentPersonalities cannot inject the default (roster-wipe guard)", () => {
    const parsed = MutableDaemonConfigPatchSchema.parse({ appendSystemPrompt: "x" });
    expect(parsed).not.toHaveProperty("agentPersonalities");
  });

  test("a single-field brain patch does not inject defaults for the other fields", () => {
    // Regression: MutableBrainConfigSchema.partial() kept every field's default,
    // so a one-field brain patch expanded to a full defaulted block and the
    // daemon's deep-merge reset the rest - turning sharing off, wiping the token,
    // and disabling the server. The patch must carry only what was sent.
    const parsed = MutableDaemonConfigPatchSchema.parse({ brain: { allowRemoteConfig: true } });
    expect(parsed.brain).toEqual({ allowRemoteConfig: true });
  });

  test("a nested brain patch preserves sibling keys (deep-partial, no defaults)", () => {
    const parsed = MutableDaemonConfigPatchSchema.parse({ brain: { listen: { host: "0.0.0.0" } } });
    expect(parsed.brain).toEqual({ listen: { host: "0.0.0.0" } });
    expect(parsed.brain?.listen).not.toHaveProperty("port");
  });

  test("brain runtime log verbosity defaults safely and patches independently", () => {
    const config = MutableDaemonConfigSchema.parse({ mcp: { injectIntoAgents: true } });
    expect(config.brain.runtime.logVerbosity).toBe(3);

    const patch = MutableDaemonConfigPatchSchema.parse({ brain: { runtime: { logVerbosity: 5 } } });
    expect(patch.brain).toEqual({ runtime: { logVerbosity: 5 } });
  });

  test("brain.remote.certFingerprint defaults to null and round-trips through a patch", () => {
    // An old daemon's config (no certFingerprint on disk) must parse with the
    // pin absent-but-well-formed, so remote HTTPS validates against the system
    // trust store by default.
    const parsed = MutableDaemonConfigSchema.parse({
      mcp: { injectIntoAgents: true },
      brain: { mode: "remote" },
    });
    expect(parsed.brain.remote.certFingerprint).toBeNull();

    const patch = MutableDaemonConfigPatchSchema.parse({
      brain: { remote: { certFingerprint: "AB:CD" } },
    });
    expect(patch.brain).toEqual({ remote: { certFingerprint: "AB:CD" } });
  });

  test("agent.personality.set request/response round-trip through the unions", () => {
    const request = SessionInboundMessageSchema.parse({
      type: "agent.personality.set.request",
      agentId: "agent-1",
      personalityId: null,
      requestId: "req-1",
    });
    expect(request.type).toBe("agent.personality.set.request");

    const response = SessionOutboundMessageSchema.parse({
      type: "agent.personality.set.response",
      payload: { requestId: "req-1", agentId: "agent-1", accepted: true, error: null },
    });
    expect(response.type).toBe("agent.personality.set.response");
  });

  test("fs.file.write_binary still parses the base64 request a pre-frames client sends", () => {
    // COMPAT(binaryWriteBase64): the payload moved onto file-transfer frames,
    // which means `size` and no `contentBase64`. A client from before that
    // sends the opposite pair, and a field we stopped sending is not a field we
    // stopped accepting - this is the "does a 6-month-old client still parse?"
    // half of the contract.
    const legacy = SessionInboundMessageSchema.parse({
      type: "fs.file.write_binary.request",
      cwd: "/repo",
      path: "docs/design.pdf",
      contentBase64: "JVBERi0=",
      overwrite: true,
      requestId: "req-legacy",
    });
    if (legacy.type !== "fs.file.write_binary.request") {
      throw new Error(`expected fs.file.write_binary.request, got ${legacy.type}`);
    }
    expect(legacy.contentBase64).toBe("JVBERi0=");
    expect(legacy.size).toBeUndefined();

    const framed = SessionInboundMessageSchema.parse({
      type: "fs.file.write_binary.request",
      cwd: "/repo",
      path: "docs/design.pdf",
      size: 5,
      requestId: "req-framed",
    });
    if (framed.type !== "fs.file.write_binary.request") {
      throw new Error(`expected fs.file.write_binary.request, got ${framed.type}`);
    }
    expect(framed.size).toBe(5);
    expect(framed.contentBase64).toBeUndefined();
  });
});
