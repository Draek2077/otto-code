import { relative, resolve } from "node:path";
import { z } from "zod";
import { readKanbanProjectGitHubRemote } from "../../kanban/project-remote.js";
import { KanbanFieldValueInputSchema } from "@otto-code/protocol/kanban";
import type { MutableDaemonConfig } from "@otto-code/protocol/messages";
import type { ForgeConnectionStore } from "../../../services/git-hosting/connection-store.js";
import { ensureValidJson } from "../../json-utils.js";
import {
  createKanbanRegistry,
  type KanbanRegistryOptions,
  type KanbanRegistry,
} from "../../kanban/kanban-registry.js";
import type { KanbanBoardListContext, KanbanProvider } from "../../kanban/types.js";
import type {
  PersistedProjectRecord,
  ProjectRegistry,
  WorkspaceRegistry,
} from "../../workspace-registry.js";
import type { OttoToolContext } from "./otto-tool-context.js";
import type { OttoToolHostDependencies } from "./otto-tool-host-dependencies.js";
import type { RegisterOttoTool } from "./types.js";

type Dependencies = Pick<
  OttoToolContext,
  "resolveScopedCwd" | "resolveCallerAgent" | "callerAgentId"
> & {
  registerTool: RegisterOttoTool;
  readKanbanConfig?: () => MutableDaemonConfig;
  connections?: ForgeConnectionStore;
  projectRegistry?: Pick<ProjectRegistry, "list">;
  workspaceRegistry?: Pick<WorkspaceRegistry, "list" | "get">;
  createRegistry?: (options: KanbanRegistryOptions) => KanbanRegistry;
};

export function registerKanbanCatalogTools(
  registration: Dependencies,
  options: OttoToolHostDependencies,
): void {
  registerKanbanTools({
    ...registration,
    readKanbanConfig: options.readKanbanConfig,
    connections: options.kanbanConnections,
    projectRegistry: options.kanbanProjectRegistry,
    workspaceRegistry: options.kanbanWorkspaceRegistry,
    createRegistry: options.createKanbanRegistry,
  });
}

/** A Kanban tool can only address a board configured on the caller's project. */
async function resolveProject(deps: Dependencies): Promise<PersistedProjectRecord> {
  const projects = await deps.projectRegistry!.list();
  const agent = deps.resolveCallerAgent();
  const workspace = agent?.workspaceId
    ? await deps.workspaceRegistry?.get(agent.workspaceId)
    : null;
  const cwd = deps.resolveScopedCwd();
  const normalizedCwd = resolve(cwd).toLowerCase();
  const matchingWorkspace =
    workspace ??
    (await deps.workspaceRegistry?.list())?.find((entry) => {
      const path = resolve(entry.cwd).toLowerCase();
      return (
        normalizedCwd === path ||
        (!relative(path, normalizedCwd).startsWith("..") &&
          relative(path, normalizedCwd) !== normalizedCwd)
      );
    });
  const project = matchingWorkspace
    ? projects.find((entry) => entry.projectId === matchingWorkspace.projectId)
    : projects
        .filter((entry) => {
          const root = resolve(entry.rootPath).toLowerCase();
          const path = relative(root, normalizedCwd);
          return (
            path === "" || (path !== ".." && !path.startsWith(`..\\`) && !path.startsWith("../"))
          );
        })
        .sort((a, b) => b.rootPath.length - a.rootPath.length)[0];
  if (!project?.kanban)
    throw new Error("The current project has no Kanban board configured in Project Settings.");
  return project;
}

async function boardContext(project: PersistedProjectRecord): Promise<KanbanBoardListContext> {
  const target = project.kanban!;
  const context: KanbanBoardListContext = {
    ...(target.boardId ? { targetBoardId: target.boardId } : {}),
    ...(target.boardOwner ? { targetBoardOwner: target.boardOwner } : {}),
  };
  if (target.adapter === "github") {
    const remote = await readKanbanProjectGitHubRemote(project.rootPath);
    if (remote) {
      context.owner = remote.owner;
      context.repo = remote.repo;
      context.targetBoardOwner ??= remote.owner;
    }
  }
  return context;
}

async function withBoard<T>(
  deps: Dependencies,
  requestedBoardId: string | undefined,
  operation: (
    provider: KanbanProvider,
    boardId: string,
    context: KanbanBoardListContext,
  ) => Promise<T>,
): Promise<T> {
  const project = await resolveProject(deps);
  const registry = (deps.createRegistry ?? createKanbanRegistry)({
    readConfig: deps.readKanbanConfig!,
    projectId: project.projectId,
    ...(deps.connections ? { connections: deps.connections } : {}),
  });
  try {
    const provider = registry.getProvider(project.kanban!.adapter);
    if (!provider) throw new Error("The configured Kanban provider is unavailable.");
    await registry.initialize(provider.providerId);
    const context = await boardContext(project);
    const boards = await provider.listBoards(context);
    let selected = boards.length === 1 ? boards[0] : null;
    if (requestedBoardId)
      selected = boards.find((board) => board.boardId === requestedBoardId) ?? null;
    if (!selected) {
      throw new Error(
        boards.length > 1
          ? "Choose a boardId from kanban_list_boards."
          : "The configured board is unavailable to this project.",
      );
    }
    return await operation(provider, selected.boardId, context);
  } finally {
    registry.dispose();
  }
}

function boardHasCard(
  snapshot: Awaited<ReturnType<KanbanProvider["getBoard"]>>,
  cardId: string,
): boolean {
  return snapshot.board.columns.some((column) => column.cards.some((card) => card.id === cardId));
}

export function registerKanbanTools(deps: Dependencies): void {
  if (
    !deps.callerAgentId ||
    !deps.readKanbanConfig ||
    !deps.projectRegistry ||
    !deps.workspaceRegistry
  )
    return;
  const boardId = z
    .string()
    .optional()
    .describe("Board id from kanban_list_boards. Optional when the project has one board.");
  const result = (value: unknown) => ({ content: [], structuredContent: ensureValidJson(value) });

  deps.registerTool(
    "kanban_list_boards",
    {
      title: "List project Kanban boards",
      description:
        "List only the boards configured or discovered for the current project. Credentials remain on the host.",
      outputSchema: {
        boards: z.array(
          z.object({ providerId: z.string(), boardId: z.string(), title: z.string() }),
        ),
      },
    },
    async () => {
      const project = await resolveProject(deps);
      const registry = (deps.createRegistry ?? createKanbanRegistry)({
        readConfig: deps.readKanbanConfig!,
        projectId: project.projectId,
        ...(deps.connections ? { connections: deps.connections } : {}),
      });
      try {
        const provider = registry.getProvider(project.kanban!.adapter)!;
        await registry.initialize(provider.providerId);
        return result({ boards: await provider.listBoards(await boardContext(project)) });
      } finally {
        registry.dispose();
      }
    },
  );

  deps.registerTool(
    "kanban_get_board",
    {
      title: "Read project Kanban board",
      description:
        "Read the configured board, its cards, editable fields, and card values from the provider.",
      inputSchema: { boardId },
    },
    async ({ boardId: id }) =>
      result(await withBoard(deps, id, (provider, selected) => provider.getBoard(selected))),
  );

  deps.registerTool(
    "kanban_create_card",
    {
      title: "Create Kanban card",
      description:
        "Create a card on the current project's board. This changes the external provider.",
      inputSchema: {
        boardId,
        columnId: z.string().optional(),
        title: z.string().trim().min(1),
        body: z.string().optional(),
      },
    },
    async ({ boardId: id, columnId, title, body }) =>
      result(
        await withBoard(deps, id, async (provider, selected) => {
          await provider.getBoard(selected);
          return provider.createCard(selected, columnId ?? null, {
            title,
            ...(body ? { body } : {}),
          });
        }),
      ),
  );

  deps.registerTool(
    "kanban_link_task",
    {
      title: "Link issue or pull request to Kanban",
      description:
        "Add existing provider work to the configured board. A GitHub number resolves against the current project's remote.",
      inputSchema: { boardId, externalId: z.string().min(1), columnId: z.string().optional() },
    },
    async ({ boardId: id, externalId, columnId }) =>
      result(
        await withBoard(deps, id, async (provider, selected, context) => {
          await provider.getBoard(selected);
          return provider.linkExternalTask(
            selected,
            {
              externalId,
              ...(context.owner ? { owner: context.owner } : {}),
              ...(context.repo ? { repo: context.repo } : {}),
            },
            columnId ?? null,
          );
        }),
      ),
  );

  deps.registerTool(
    "kanban_move_card",
    {
      title: "Move Kanban card",
      description: "Move a card to a board column and return the provider's refreshed board.",
      inputSchema: { boardId, cardId: z.string().min(1), targetColumnId: z.string().min(1) },
    },
    async ({ boardId: id, cardId, targetColumnId }) =>
      result(
        await withBoard(deps, id, async (provider, selected) => {
          const snapshot = await provider.getBoard(selected);
          if (!boardHasCard(snapshot, cardId)) throw new Error("Card is not on this board.");
          await provider.moveCard(selected, cardId, targetColumnId);
          return provider.getBoard(selected);
        }),
      ),
  );

  deps.registerTool(
    "kanban_update_card",
    {
      title: "Update Kanban card field",
      description:
        "Write one editable field on a board card and return the provider's refreshed value.",
      inputSchema: {
        boardId,
        cardId: z.string().min(1),
        fieldId: z.string().min(1),
        value: KanbanFieldValueInputSchema,
      },
    },
    async ({ boardId: id, cardId, fieldId, value }) =>
      result(
        await withBoard(deps, id, async (provider, selected) => {
          const snapshot = await provider.getBoard(selected);
          const field = snapshot.fields.find((entry) => entry.id === fieldId);
          const card = boardHasCard(snapshot, cardId);
          if (
            !card ||
            !field ||
            !field.editable ||
            snapshot.cardFields[cardId]?.find((entry) => entry.fieldId === fieldId)?.editable ===
              false
          )
            throw new Error("This field is not editable on this card.");
          if (!provider.updateCardField) throw new Error("This provider cannot edit card fields.");
          return provider.updateCardField({ boardId: selected, cardId, fieldId, value });
        }),
      ),
  );

  deps.registerTool(
    "kanban_delete_card",
    {
      title: "Remove Kanban card",
      description:
        "Remove a card from its board. Linked issues remain in their repository; board-only drafts are deleted.",
      inputSchema: { boardId, cardId: z.string().min(1) },
    },
    async ({ boardId: id, cardId }) =>
      result(
        await withBoard(deps, id, async (provider, selected) => {
          const snapshot = await provider.getBoard(selected);
          if (!boardHasCard(snapshot, cardId)) throw new Error("Card is not on this board.");
          if (!provider.deleteCard) throw new Error("This provider cannot remove cards.");
          await provider.deleteCard(selected, cardId);
          return { removed: true, cardId };
        }),
      ),
  );
}
