import { describe, expect, test, vi } from "vitest";
import { OTTO_TOOL_GROUPS, ottoToolGroupForName } from "@otto-code/protocol/provider-config";
import type { MutableDaemonConfig } from "@otto-code/protocol/messages";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { createOttoToolCatalog, type OttoToolHostDependencies } from "./otto-tools.js";

function host(overrides: Partial<OttoToolHostDependencies> = {}): OttoToolHostDependencies {
  return {
    agentManager: {
      getAgent: vi.fn(() => ({ id: "caller", cwd: "/project", config: {}, labels: {} })),
    } as unknown as OttoToolHostDependencies["agentManager"],
    agentStorage: {} as OttoToolHostDependencies["agentStorage"],
    providerSnapshotManager: {} as OttoToolHostDependencies["providerSnapshotManager"],
    callerAgentId: "caller",
    enableVoiceTools: true,
    readAgentProfiles: () => [],
    // Catalog construction must not invoke services; only execution does so.
    personalityMemory: {} as NonNullable<OttoToolHostDependencies["personalityMemory"]>,
    projectKnowledge: {} as NonNullable<OttoToolHostDependencies["projectKnowledge"]>,
    architecturalViews: {} as NonNullable<OttoToolHostDependencies["architecturalViews"]>,
    openArchitecturalView: vi.fn(),
    runService: {} as NonNullable<OttoToolHostDependencies["runService"]>,
    logger: createTestLogger(),
    ...overrides,
  };
}

describe("domain registrars share one Otto catalog boundary", () => {
  test("preserves the complete ordered chat-scoped tool surface", () => {
    expect([...createOttoToolCatalog(host()).tools.keys()]).toMatchSnapshot();
  });

  test.each(OTTO_TOOL_GROUPS)("%s cannot register tools outside its selected group", (group) => {
    const all = createOttoToolCatalog(host());
    const selected = createOttoToolCatalog(host({ enabledOttoToolGroups: [group] }));
    expect([...selected.tools.keys()]).toEqual(
      [...all.tools.keys()].filter((name) => ottoToolGroupForName(name) === group),
    );
  });

  test("an empty group selection withholds every built-in registrar", () => {
    expect(createOttoToolCatalog(host({ enabledOttoToolGroups: [] })).tools.size).toBe(0);
  });

  test("voice-only returns before registering ordinary tool groups", () => {
    expect([...createOttoToolCatalog(host({ voiceOnly: true })).tools.keys()]).toEqual([
      "read_architectural_view_draft",
      "update_architectural_view_draft",
      "show_architectural_view",
      "speak",
    ]);
  });

  test("optional groups are absent when their host services are not wired", () => {
    const catalog = createOttoToolCatalog(
      host({
        personalityMemory: undefined,
        projectKnowledge: undefined,
        architecturalViews: undefined,
        runService: undefined,
        readAgentProfiles: undefined,
      }),
    );
    for (const name of [
      "remember_lesson",
      "query_project_knowledge",
      "read_architectural_view_draft",
      "start_workflow",
      "list_agent_profiles",
    ]) {
      expect(catalog.getTool(name)).toBeUndefined();
    }
  });

  test("rejects invalid group input before reaching a service", async () => {
    const moveChatToWorkspace = vi.fn();
    const catalog = createOttoToolCatalog(host({ moveChatToWorkspace }));
    await expect(catalog.executeTool("move_chat_to_workspace", {})).rejects.toThrow();
    expect(moveChatToWorkspace).not.toHaveBeenCalled();
  });

  test("routes every Kanban tool into its own group before suggested tasks", () => {
    for (const name of [
      "kanban_list_boards",
      "kanban_get_board",
      "kanban_link_task",
      "kanban_update_card",
    ]) {
      expect(ottoToolGroupForName(name)).toBe("kanban");
    }
  });

  test("Kanban tools only mutate a board configured for the caller's project", async () => {
    const card = {
      id: "ISSUE-1",
      title: "Work",
      status: "To Do",
      assignees: [],
      rawProviderId: "ISSUE-1",
    };
    const getBoard = vi.fn(async () => ({
      board: {
        id: "board-1",
        title: "Board",
        columns: [{ id: "todo", name: "To Do", cards: [card] }],
      },
      fields: [],
      cardFields: {},
    }));
    const createCard = vi.fn(async () => card);
    const provider = {
      providerId: "jira",
      listBoards: vi.fn(async () => [{ providerId: "jira", boardId: "board-1", title: "Board" }]),
      getBoard,
      createCard,
    };
    const dispose = vi.fn();
    const catalog = createOttoToolCatalog(
      host({
        enabledOttoToolGroups: ["kanban"],
        readKanbanConfig: () => ({}) as MutableDaemonConfig,
        kanbanProjectRegistry: {
          list: async () =>
            [
              {
                projectId: "project-1",
                rootPath: "/project",
                kanban: { adapter: "jira", boardId: "board-1" },
              },
            ] as never,
        },
        kanbanWorkspaceRegistry: { get: async () => null, list: async () => [] },
        createKanbanRegistry: () => ({
          listProviderIds: () => ["jira"],
          getProvider: () => provider as never,
          initialize: async () => {},
          dispose,
        }),
      }),
    );
    expect([...catalog.tools.keys()]).toEqual([
      "kanban_list_boards",
      "kanban_get_board",
      "kanban_create_card",
      "kanban_link_task",
      "kanban_move_card",
      "kanban_update_card",
      "kanban_delete_card",
    ]);
    await expect(
      catalog.executeTool("kanban_create_card", { boardId: "other-board", title: "New" }),
    ).rejects.toThrow(/unavailable/);
    expect(createCard).not.toHaveBeenCalled();
    await catalog.executeTool("kanban_create_card", { title: "New" });
    expect(createCard).toHaveBeenCalledWith("board-1", null, { title: "New" });
    expect(getBoard).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
