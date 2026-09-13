import { ORCHESTRATION_QUERY_TOOLS_LABEL } from "@otto-code/protocol/agent-labels";
import { describe, expect, test, vi } from "vitest";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentManager } from "../agent-manager.js";
import type { AgentStorage } from "../agent-storage.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import { createOttoToolCatalog, type OttoToolHostDependencies } from "./otto-tools.js";

function catalog(options: Partial<OttoToolHostDependencies> = {}, workspaceAccess?: string) {
  return createOttoToolCatalog({
    agentManager: {
      getAgent: vi.fn(() => ({ cwd: process.cwd(), labels: {}, config: { workspaceAccess } })),
    } as unknown as AgentManager,
    agentStorage: {} as AgentStorage,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    callerAgentId: "caller",
    enableVoiceTools: true,
    logger: createTestLogger(),
    ...options,
  });
}

describe("provider restrictions intersect Otto catalog policy", () => {
  test("withholds and refuses explicitly denied tools including speak", async () => {
    const before = catalog();
    expect(before.getTool("speak")).toBeDefined();
    expect(before.getTool("create_terminal")).toBeDefined();
    const restricted = catalog({ ottoToolPolicy: { disabledTools: ["speak", "create_terminal"] } });
    expect(restricted.getTool("speak")).toBeUndefined();
    expect(restricted.getTool("create_terminal")).toBeUndefined();
    expect(restricted.getTool("list_chats")).toBeDefined();
    await expect(restricted.executeTool("speak", { text: "denied" })).rejects.toThrow("not found");
    await expect(restricted.executeTool("create_terminal", {})).rejects.toThrow("not found");
  });
  test("cannot restore host groups or workspace access by enabling the provider", () => {
    expect(
      catalog({ ottoToolPolicy: { enabled: true }, enabledOttoToolGroups: [] }).tools.size,
    ).toBe(0);
    const read = catalog({ ottoToolPolicy: { enabled: true } }, "read");
    expect(read.getTool("create_terminal")).toBeUndefined();
    expect(read.getTool("capture_terminal")).toBeDefined();
    expect(catalog({ ottoToolPolicy: { enabled: false } }).tools.size).toBe(0);
  });
  test("keeps a graph-defined lookup independent of built-in switches but honors its exact deny", async () => {
    const agentManager = {
      getAgent: vi.fn(() => ({
        cwd: process.cwd(),
        config: {},
        labels: {
          [ORCHESTRATION_QUERY_TOOLS_LABEL]: JSON.stringify([
            {
              name: "lookup",
              description: "Read node context",
              kind: "file-read",
              path: "README.md",
            },
          ]),
        },
      })),
    } as unknown as AgentManager;
    const granted = catalog({
      agentManager,
      enabledOttoToolGroups: [],
      ottoToolPolicy: { enabled: false },
    });
    expect(granted.getTool("query_lookup")).toBeDefined();
    const denied = catalog({ agentManager, ottoToolPolicy: { disabledTools: ["query_lookup"] } });
    expect(denied.getTool("query_lookup")).toBeUndefined();
    await expect(denied.executeTool("query_lookup", {})).rejects.toThrow("not found");
  });
  test("retains connector grants but enforces explicit provider denies before execution", async () => {
    const handler = vi.fn(async () => ({ content: [{ type: "text", text: "authorized" }] }));
    const connectorTools = [
      { name: "connector_read", description: "Read connector data", handler },
    ];
    const allowed = catalog({ ottoToolPolicy: { enabled: false }, connectorTools });
    await expect(allowed.executeTool("connector_read", {})).resolves.toMatchObject({
      content: [{ text: "authorized" }],
    });
    const denied = catalog({
      ottoToolPolicy: { enabled: false, disabledTools: ["connector_read"] },
      connectorTools,
    });
    expect(denied.getTool("connector_read")).toBeUndefined();
    await expect(denied.executeTool("connector_read", {})).rejects.toThrow("not found");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
