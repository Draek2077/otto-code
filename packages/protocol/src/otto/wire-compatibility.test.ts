import { describe, expect, it } from "vitest";
import { WSInboundMessageSchema } from "../messages.js";
import { validateWSOutboundMessage } from "../validation/ws-outbound.js";
import {
  encodeOttoClientMessage,
  encodeOttoServerMessage,
  isLegacyOttoServerInfo,
  normalizeOttoClientMessage,
  normalizeOttoServerMessage,
  usesLegacyOttoRpcNames,
} from "./wire-compatibility.js";

const session = (message: unknown) => ({ type: "session", message });
const pageInfo = { nextCursor: null, prevCursor: null, hasMore: false };
const checkout = {
  cwd: "/repo",
  isGit: true,
  currentBranch: "main",
  remoteUrl: null,
  worktreeRoot: "/repo",
  isPaseoOwnedWorktree: false,
  mainRepoRoot: null,
};
const project = { projectKey: "/repo", projectName: "Repo", checkout };
const workspace = {
  id: "wks_1",
  projectId: "/repo",
  projectDisplayName: "Repo",
  projectRootPath: "/repo",
  workspaceDirectory: "/repo",
  projectKind: "git",
  workspaceKind: "local_checkout",
  name: "Repo",
  status: "done",
  activityAt: null,
  scripts: [],
  background: true,
  project,
  gitRuntime: { isPaseoOwnedWorktree: false },
};
const agent = {
  id: "agent-1",
  provider: "claude",
  cwd: "/repo",
  model: null,
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
  lastUserMessageAt: null,
  status: "idle",
  currentModeId: null,
  capabilities: {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: false,
    supportsMcpServers: true,
    supportsReasoningStream: false,
    supportsToolInvocations: true,
  },
  availableModes: [],
  pendingPermissions: [],
  persistence: null,
  title: null,
  labels: {},
};

describe("Otto 0.9 transport names", () => {
  it.each([
    {
      type: "fetch_agents_response",
      payload: { requestId: "r", entries: [{ agent, project }], pageInfo },
    },
    {
      type: "fetch_agent_history_response",
      payload: { requestId: "r", entries: [{ agent, project }], pageInfo },
    },
    { type: "fetch_agent_response", payload: { requestId: "r", agent, project, error: null } },
    { type: "agent_update", payload: { kind: "upsert", agent, project } },
    {
      type: "fetch_workspaces_response",
      payload: { requestId: "r", entries: [workspace], pageInfo },
    },
    { type: "workspace_update", payload: { kind: "upsert", workspace } },
    { type: "open_project_response", payload: { requestId: "r", workspace, error: null } },
    {
      type: "create_paseo_worktree_response",
      payload: { requestId: "r", workspace, error: null, setupTerminalId: null },
    },
    {
      type: "workspace.create.response",
      payload: { requestId: "r", workspace, error: null, setupTerminalId: null },
    },
  ])("keeps populated $type parseable and adds legacy checkout ownership", (message) => {
    const current = session(message);
    const encoded = encodeOttoServerMessage(current);
    expect(JSON.stringify(encoded)).toContain('"isOttoOwnedWorktree":false');
    expect(validateWSOutboundMessage(encoded).success).toBe(true);
    expect(normalizeOttoServerMessage(encoded)).toEqual(encoded);
    expect(current).toEqual(session(message));
  });

  it.each([
    { ...checkout, isGit: false, currentBranch: null, worktreeRoot: null },
    checkout,
    { ...checkout, isPaseoOwnedWorktree: true, mainRepoRoot: "/main" },
  ])("accepts a legacy-only checkout without weakening validation", (current) => {
    const { isPaseoOwnedWorktree, ...rest } = current;
    const legacyCheckout = { ...rest, isOttoOwnedWorktree: isPaseoOwnedWorktree };
    const response = (value: unknown) =>
      session({
        type: "fetch_agent_response",
        payload: {
          requestId: "r",
          agent,
          project: { ...project, checkout: value },
          error: null,
        },
      });
    expect(validateWSOutboundMessage(response(legacyCheckout)).success).toBe(false);
    const normalized = normalizeOttoServerMessage(response(legacyCheckout));
    expect(validateWSOutboundMessage(normalized).success).toBe(true);
    expect(
      validateWSOutboundMessage(
        normalizeOttoServerMessage(
          response({
            ...legacyCheckout,
            isOttoOwnedWorktree: "true",
          }),
        ),
      ).success,
    ).toBe(false);
    // A present malformed canonical field must not be repaired from the alias.
    expect(
      validateWSOutboundMessage(
        normalizeOttoServerMessage(
          response({
            ...legacyCheckout,
            isPaseoOwnedWorktree: "true",
          }),
        ),
      ).success,
    ).toBe(false);
  });

  it.each(["checkout_status_response", "checkout_status_update"])("bridges %s", (type) => {
    const payload = {
      cwd: "/repo",
      requestId: "r",
      isGit: true,
      isOttoOwnedWorktree: true,
      repoRoot: "/repo",
      mainRepoRoot: "/main",
      currentBranch: "main",
      isDirty: false,
      baseRef: "main",
      aheadBehind: null,
      aheadOfOrigin: null,
      behindOfOrigin: null,
      hasRemote: false,
      remoteUrl: null,
      error: null,
    };
    const decoded = normalizeOttoServerMessage(session({ type, payload }));
    expect(validateWSOutboundMessage(decoded).success).toBe(true);
    expect(encodeOttoServerMessage(decoded)).toMatchObject({
      message: {
        payload: {
          isPaseoOwnedWorktree: true,
          isOttoOwnedWorktree: true,
        },
      },
    });
  });

  it("uses canonical values when a saved legacy alias is stale", () => {
    const input = session({
      type: "checkout_status_response",
      payload: {
        isPaseoOwnedWorktree: false,
        isOttoOwnedWorktree: true,
      },
    });
    expect(normalizeOttoServerMessage(input)).toBe(input);
    expect(encodeOttoServerMessage(input)).toMatchObject({
      message: {
        payload: {
          isPaseoOwnedWorktree: false,
          isOttoOwnedWorktree: false,
        },
      },
    });
  });

  it("retains workspace visibility and stash ownership", () => {
    const oldWorkspace = {
      ...workspace,
      background: undefined,
      hidden: true,
      gitRuntime: { isOttoOwnedWorktree: true },
    };
    // JSON omits undefined keys on actual transport frames.
    const input = JSON.parse(
      JSON.stringify(
        session({
          type: "workspace_update",
          payload: {
            kind: "upsert",
            workspace: oldWorkspace,
          },
        }),
      ),
    );
    expect(normalizeOttoServerMessage(input)).toMatchObject({
      message: {
        payload: {
          workspace: {
            background: true,
            gitRuntime: { isPaseoOwnedWorktree: true },
          },
        },
      },
    });
    const stash = session({
      type: "stash_list_response",
      payload: {
        cwd: "/repo",
        requestId: "r",
        error: null,
        entries: [{ index: 0, message: "Saved", branch: "main", isOtto: true }],
      },
    });
    expect(validateWSOutboundMessage(normalizeOttoServerMessage(stash)).success).toBe(true);
    expect(encodeOttoServerMessage(normalizeOttoServerMessage(stash))).toEqual({
      ...stash,
      message: {
        ...stash.message,
        payload: {
          ...stash.message.payload,
          entries: [{ ...stash.message.payload.entries[0], isPaseo: true }],
        },
      },
    });
  });

  it.each([
    ["otto_worktree_list_request", "paseo_worktree_list_request", {}],
    ["otto_worktree_archive_request", "paseo_worktree_archive_request", {}],
    ["create_otto_worktree_request", "create_paseo_worktree_request", { cwd: "/repo" }],
  ])("preserves request correlation for %s", (oldType, newType, fields) => {
    const old = session({ type: oldType, ...fields, requestId: "r" });
    expect(usesLegacyOttoRpcNames(old)).toBe(true);
    const decoded = normalizeOttoClientMessage(old);
    expect(WSInboundMessageSchema.safeParse(decoded).success).toBe(true);
    expect(decoded).toEqual(session({ type: newType, ...fields, requestId: "r" }));
    expect(encodeOttoClientMessage(decoded, true)).toEqual(old);
    expect(encodeOttoClientMessage(decoded, false)).toBe(decoded);
    expect(
      WSInboundMessageSchema.safeParse(
        normalizeOttoClientMessage(
          session({
            type: oldType,
            ...fields,
            requestId: 123,
          }),
        ),
      ).success,
    ).toBe(false);
  });

  it.each([
    ["paseo_worktree_list_response", "otto_worktree_list_response", { worktrees: [] }],
    ["paseo_worktree_archive_response", "otto_worktree_archive_response", { success: true }],
    [
      "create_paseo_worktree_response",
      "create_otto_worktree_response",
      { workspace: null, setupTerminalId: null },
    ],
  ])("uses legacy %s response names only for legacy sockets", (type, oldType, rest) => {
    const response = session({ type, payload: { requestId: "r", error: null, ...rest } });
    expect(encodeOttoServerMessage(response)).toEqual(response);
    const legacy = encodeOttoServerMessage(response, true);
    expect(legacy).toEqual(session({ type: oldType, payload: response.message.payload }));
    const normalized = normalizeOttoServerMessage(legacy);
    expect(normalized).toEqual(response);
    expect(validateWSOutboundMessage(normalized).success).toBe(true);
  });

  it("recognizes an Otto 0.9 host without changing genuine Paseo hosts", () => {
    const old = { status: "server_info", version: "0.9.35", features: { brainControl: true } };
    expect(isLegacyOttoServerInfo(old)).toBe(true);
    expect(isLegacyOttoServerInfo({ ...old, features: {} })).toBe(false);
    expect(
      isLegacyOttoServerInfo({ ...old, features: { ...old.features, backgroundWorkspaces: true } }),
    ).toBe(false);
    expect(isLegacyOttoServerInfo({ ...old, version: "0.10.0" })).toBe(false);
  });

  it("does not rewrite arbitrary payloads, terminal cursor flags or unknown messages", () => {
    for (const type of ["plugin.rpc.invoke.response", "agent_stream", "terminal_state", "other"]) {
      const input = session({
        type,
        payload: { isOttoOwnedWorktree: true, hidden: true, project, entries: [{ isOtto: true }] },
      });
      expect(normalizeOttoServerMessage(input)).toBe(input);
      expect(encodeOttoServerMessage(input)).toBe(input);
    }
    for (const input of [null, [], "hello", { type: "pong" }, session(null)]) {
      expect(normalizeOttoServerMessage(input)).toBe(input);
    }
  });
});
