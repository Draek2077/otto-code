import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { Options, Query } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import * as spawnUtils from "../../../../utils/spawn.js";
import type { McpServerConfig } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";
import type { ClaudeQueryInput } from "./query.js";

// Workspace access is a boundary a user relies on when deciding to run a graph
// unattended, so these tests assert on the options actually handed to the SDK —
// not on the mapping helper, which is tested separately. The question each one
// answers is "could this session still write?".

function createQueryMock(): Query {
  const events = [
    {
      type: "system",
      subtype: "init",
      session_id: "workspace-access-session",
      permissionMode: "default",
      model: "opus",
    },
    { type: "assistant", message: { content: "done" } },
    {
      type: "result",
      subtype: "success",
      usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
      total_cost_usd: 0,
    },
  ];
  let index = 0;
  return {
    next: vi.fn(async () =>
      index < events.length
        ? { done: false, value: events[index++] }
        : { done: true, value: undefined },
    ),
    return: vi.fn(async () => ({ done: true, value: undefined })),
    interrupt: vi.fn(async () => undefined),
    close: vi.fn(() => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    supportedModels: vi.fn(async () => [{ value: "opus", displayName: "Opus" }]),
    supportedCommands: vi.fn(async () => []),
    rewindFiles: vi.fn(async () => ({ canRewind: true })),
    [Symbol.asyncIterator]() {
      return this;
    },
  } as Query;
}

/** Run one turn and hand back the options Claude was actually launched with. */
async function captureOptions(config: {
  workspaceAccess?: string;
  modeId?: string;
  mcpServers?: Record<string, McpServerConfig>;
}): Promise<Options> {
  let captured: Options | undefined;
  const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
    captured = options;
    return createQueryMock();
  });
  vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(
    Object.assign(new EventEmitter(), { stderr: new EventEmitter() }) as ChildProcess,
  );
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    queryFactory,
    resolveBinary: async () => "/test/claude/bin",
  });
  const session = await client.createSession({
    provider: "claude",
    cwd: process.cwd(),
    ...config,
  });
  try {
    await session.run("do the thing");
  } finally {
    await session.close();
  }
  if (!captured) {
    throw new Error("Claude was never launched, so no options were captured");
  }
  return captured;
}

describe("Claude workspace access", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("no declared access leaves the tool surface untouched", async () => {
    const options = await captureOptions({});
    for (const tool of ["Write", "Edit", "Read", "Bash"]) {
      expect(options.disallowedTools ?? []).not.toContain(tool);
    }
  });

  test('"read" withholds every write tool but keeps reading and the shell', async () => {
    const options = await captureOptions({ workspaceAccess: "read" });
    const denied = options.disallowedTools ?? [];
    expect(denied).toContain("Write");
    expect(denied).toContain("Edit");
    expect(denied).toContain("MultiEdit");
    expect(denied).toContain("NotebookEdit");
    expect(denied).not.toContain("Read");
    expect(denied).not.toContain("Bash");
  });

  test('"none" withholds reading and the shell too', async () => {
    const options = await captureOptions({ workspaceAccess: "none" });
    const denied = options.disallowedTools ?? [];
    expect(denied).toContain("Write");
    expect(denied).toContain("Read");
    expect(denied).toContain("Grep");
    expect(denied).toContain("Bash");
  });

  test('"read" withholds the Otto terminal shell in its namespaced form too', async () => {
    // The daemon's MCP server already withholds these at catalog registration;
    // this asserts the second layer, which rides the session's own config.
    const options = await captureOptions({
      workspaceAccess: "read",
      mcpServers: { otto: { type: "http", url: "http://127.0.0.1:6788/mcp" } },
    });
    const denied = options.disallowedTools ?? [];
    expect(denied).toContain("mcp__otto__create_terminal");
    expect(denied).toContain("mcp__otto__send_terminal_keys");
    expect(denied).toContain("mcp__otto__browser_upload");
    // read bounds the shell surface only; the below-none catalog stays.
    expect(denied).not.toContain("mcp__otto__create_worktree");
    expect(denied).not.toContain("mcp__otto__create_artifact");
  });

  test('"none" withholds the Otto workspace mutators for every otto-ish server', async () => {
    const options = await captureOptions({
      workspaceAccess: "none",
      mcpServers: {
        otto: { type: "http", url: "http://127.0.0.1:6788/mcp" },
        otto_agent: { type: "http", url: "http://127.0.0.1:6788/mcp" },
      },
    });
    const denied = options.disallowedTools ?? [];
    for (const server of ["otto", "otto_agent"]) {
      expect(denied).toContain(`mcp__${server}__create_terminal`);
      expect(denied).toContain(`mcp__${server}__create_worktree`);
      expect(denied).toContain(`mcp__${server}__update_artifact`);
    }
    // Observation of daemon state survives even at none.
    expect(denied).not.toContain("mcp__otto__list_artifacts");
    expect(denied).not.toContain("mcp__otto__preview_logs");
  });

  test("the dontAsk allowlist cannot hand back a tool the level denied", async () => {
    // dontAsk pre-approves Edit/Write so unattended coding schedules can work.
    // A node that declared "read" must not get them back through that door —
    // this is the interaction most likely to silently defeat the boundary.
    const options = await captureOptions({ workspaceAccess: "read", modeId: "dontAsk" });
    expect(options.disallowedTools ?? []).toContain("Edit");
    expect(options.allowedTools ?? []).not.toContain("Edit");
    expect(options.allowedTools ?? []).not.toContain("Write");
  });

  test('capabilities advertise "none" enforcement, so the spawn gate admits none-nodes here', () => {
    // Pinned because the gate reads these flags: dropping one would make
    // orchestration refuse levels the tests above prove are enforced.
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory: () => createQueryMock(),
      resolveBinary: async () => "/test/claude/bin",
    });
    expect(client.capabilities.supportsWorkspaceAccess).toBe(true);
    expect(client.capabilities.supportsWorkspaceAccessNone).toBe(true);
  });
});
