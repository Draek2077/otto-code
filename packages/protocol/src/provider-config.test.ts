import { describe, expect, test } from "vitest";

import {
  normalizeOttoToolGroups,
  ottoToolGroupForName,
  ProviderOverrideSchema,
  resolveStoredOttoToolGroups,
  serializeOttoToolGroups,
  type OttoToolGroup,
} from "./provider-config.js";

describe("ProviderOverrideSchema MCP fields", () => {
  test("parses overrides without the MCP fields (old configs stay valid)", () => {
    const parsed = ProviderOverrideSchema.parse({
      extends: "openai-compatible",
      label: "LM Studio",
      env: { OPENAI_BASE_URL: "http://localhost:1234" },
    });
    expect(parsed.mcpServers).toBeUndefined();
    expect(parsed.mcpToolPermissions).toBeUndefined();
  });

  test("parses stdio, http, and sse MCP server entries", () => {
    const parsed = ProviderOverrideSchema.parse({
      extends: "openai-compatible",
      label: "LM Studio",
      mcpServers: {
        files: { type: "stdio", command: "npx", args: ["-y", "some-mcp"], env: { KEY: "v" } },
        remote: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "t" } },
        stream: { type: "sse", url: "https://example.com/sse" },
      },
      mcpToolPermissions: "trust-read-only",
    });
    expect(parsed.mcpServers?.files).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "some-mcp"],
      env: { KEY: "v" },
    });
    expect(parsed.mcpToolPermissions).toBe("trust-read-only");
  });

  test("rejects unknown mcpToolPermissions values and malformed server entries", () => {
    expect(
      ProviderOverrideSchema.safeParse({
        extends: "openai-compatible",
        label: "LM Studio",
        mcpToolPermissions: "yolo",
      }).success,
    ).toBe(false);
    expect(
      ProviderOverrideSchema.safeParse({
        extends: "openai-compatible",
        label: "LM Studio",
        mcpServers: { files: { type: "stdio" } },
      }).success,
    ).toBe(false);
  });
});

describe("ottoToolGroupForName", () => {
  test("maps artifact tools to the artifacts group, not the agents catch-all", () => {
    expect(ottoToolGroupForName("create_artifact")).toBe("artifacts");
  });

  test("keeps schedule and heartbeat tools in the schedules group", () => {
    expect(ottoToolGroupForName("create_schedule")).toBe("schedules");
    expect(ottoToolGroupForName("create_heartbeat")).toBe("schedules");
    expect(ottoToolGroupForName("list_schedules")).toBe("schedules");
  });

  // delete_heartbeat matched no rule and landed in the catch-all, so switching
  // Schedules off left an agent able to delete heartbeats it could not create.
  test("groups delete_heartbeat with the rest of the schedules family", () => {
    expect(ottoToolGroupForName("delete_heartbeat")).toBe("schedules");
  });

  test("falls back to agents for chat lifecycle tools", () => {
    expect(ottoToolGroupForName("create_chat")).toBe("agents");
    expect(ottoToolGroupForName("send_chat_prompt")).toBe("agents");
    expect(ottoToolGroupForName("wait_for_chats")).toBe("agents");
  });

  test("routes the categories split out of the agents catch-all", () => {
    expect(ottoToolGroupForName("start_orchestration")).toBe("orchestration");
    expect(ottoToolGroupForName("get_orchestration_status")).toBe("orchestration");
    expect(ottoToolGroupForName("record_project_charter")).toBe("knowledge");
    expect(ottoToolGroupForName("query_project_knowledge")).toBe("knowledge");
    expect(ottoToolGroupForName("migrate_legacy_project_findings")).toBe("knowledge");
    expect(ottoToolGroupForName("remember_lesson")).toBe("memory");
    expect(ottoToolGroupForName("respond_to_permission")).toBe("permissions");
    expect(ottoToolGroupForName("list_models")).toBe("providers");
    expect(ottoToolGroupForName("inspect_provider")).toBe("providers");
    expect(ottoToolGroupForName("suggest_task")).toBe("tasks");
    expect(ottoToolGroupForName("speak")).toBe("voice");
  });

  // "model" must not swallow set_chat_mode, and the workspace rule must not
  // swallow the knowledge family - both are one character away from colliding.
  test("does not misroute names that are near-misses for another rule", () => {
    expect(ottoToolGroupForName("set_chat_mode")).toBe("agents");
    expect(ottoToolGroupForName("list_agent_profiles")).toBe("agents");
    expect(ottoToolGroupForName("list_workspaces")).toBe("workspace");
  });
});

describe("Otto tool group selection storage", () => {
  test("drops group names it does not know instead of rejecting the list", () => {
    expect(normalizeOttoToolGroups(["agents", "from-the-future", "widgets"])).toEqual([
      "agents",
      "widgets",
    ]);
  });

  test("reads a non-array selection as 'all groups'", () => {
    expect(normalizeOttoToolGroups(undefined)).toBeUndefined();
    expect(normalizeOttoToolGroups(null)).toBeUndefined();
  });

  test("an empty selection stays empty rather than becoming 'all groups'", () => {
    expect(normalizeOttoToolGroups([])).toEqual([]);
  });

  // The whole point of the v2 key: a config written before the split says
  // nothing about knowledge or orchestration, and reading that as "disabled"
  // would silently strip 26 tools from anyone who had ever used a toggle.
  test("migrates a pre-split selection forward from the legacy key", () => {
    const resolved = resolveStoredOttoToolGroups({
      legacy: ["agents", "terminals", "workspace"],
    });
    expect(resolved).toContain("knowledge");
    expect(resolved).toContain("orchestration");
    expect(resolved).toContain("voice");
    expect(resolved).toContain("terminals");
    expect(resolved).not.toContain("artifacts");
  });

  test("a pre-split selection without agents does not gain the split categories", () => {
    const resolved = resolveStoredOttoToolGroups({ legacy: ["terminals", "workspace"] });
    expect(resolved).toEqual(["terminals", "workspace"]);
  });

  test("the v2 key wins over the legacy key it was written alongside", () => {
    const resolved = resolveStoredOttoToolGroups({
      v2: ["terminals"],
      legacy: ["agents", "terminals"],
    });
    expect(resolved).toEqual(["terminals"]);
  });

  test("round-trips a selection through both persisted shapes", () => {
    const selection: OttoToolGroup[] = ["terminals", "knowledge"];
    const serialized = serializeOttoToolGroups(selection);
    expect(serialized.toolGroupsV2).toEqual(["terminals", "knowledge"]);
    // The legacy projection has no name for "knowledge", so it stands in with
    // "agents" - an older daemon grants a superset, never a subset.
    expect(serialized.toolGroups).toEqual(["agents", "terminals"]);
    expect(resolveStoredOttoToolGroups({ v2: serialized.toolGroupsV2 })).toEqual(selection);
  });

  test("the legacy projection drops agents when every derived category is off", () => {
    expect(serializeOttoToolGroups(["terminals"]).toolGroups).toEqual(["terminals"]);
  });
});
