/** Real isolated daemon; tracker responses stay inside the local-fixture gh adapter. */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { createRequire } from "node:module";
import { z } from "zod";
import path from "node:path";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  getProjectConfiguration,
  setProjectTarget,
  waitBoardChanges,
  type ProjectConfiguration,
} from "@getpaseo/plugin/otto/kanban";
import { test as base, expect, type Page } from "../fixtures";
import { connectDaemonClient } from "./daemon-client-loader";
import { seedWorkspace, type SeededWorkspace } from "./seed-client";
import { getServerId } from "./server-id";

type Client = Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">;
interface KanbanFixture {
  project: SeededWorkspace;
  read(): Promise<ProjectConfiguration>;
  write(target: ProjectConfiguration["target"]): Promise<ProjectConfiguration>;
  setProviderError(error: "scope" | "after-write" | null): Promise<void>;
  requests(): Promise<Array<{ operation: string; cursor: string }>>;
  changeProviderTitle(cardId: string, title: string): Promise<void>;
  changeCursor(cursor: string | null): Promise<string>;
}

export const test = base.extend<{ kanban: KanbanFixture; kanbanWithBoard: boolean }>({
  kanbanWithBoard: [false, { option: true }],
  kanban: async ({ e2eWorker, kanbanWithBoard }, provide) => {
    void e2eWorker;
    const project = await seedWorkspace({
      repoPrefix: "otto-kanban-",
      title: "Kanban fixture",
      git: kanbanWithBoard,
      repo: { originUrl: "https://github.com/paseo-e2e/local-fixture.git" },
    });
    let connection: Client | null = null;
    try {
      const client = await connectDaemonClient<Client>({ clientIdPrefix: "otto-kanban-ui" });
      connection = client;
      const directory = path.join(project.repoPath, ".tmp", "kanban-fixture");
      const setProviderError = async (error: "scope" | "after-write" | null) => {
        await mkdir(directory, { recursive: true });
        let state = {};
        try {
          state = JSON.parse(await readFile(path.join(directory, "state.json"), "utf8"));
        } catch (failure) {
          if (!(failure instanceof Error && "code" in failure && failure.code === "ENOENT"))
            throw failure;
        }
        await writeFile(path.join(directory, "state.json"), JSON.stringify({ ...state, error }));
      };
      const binding = { hostId: getServerId(), projectId: project.projectId };
      const read = async () => {
        const result = getProjectConfiguration.output.parse(
          await client.invokePluginRpc("otto-kanban", getProjectConfiguration.name, binding),
        );
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      };
      const fixture: KanbanFixture = {
        project,
        read,
        setProviderError,
        changeCursor: async (cursor) => {
          const result = waitBoardChanges.output.parse(
            await client.invokePluginRpc("otto-kanban", waitBoardChanges.name, {
              binding,
              leaseId: "browser-periodic-refresh-proof",
              cursor,
            }),
          );
          if (!result.ok) throw new Error(result.error.message);
          return result.value.cursor;
        },
        changeProviderTitle: async (cardId, title) => {
          const state = z
            .object({
              version: z.number().optional(),
              cards: z
                .array(z.object({ id: z.string(), title: z.string() }).passthrough())
                .optional(),
            })
            .passthrough()
            .parse(JSON.parse(await readFile(path.join(directory, "state.json"), "utf8")));
          const initialize: (record: Record<string, unknown>) => void = createRequire(
            path.join(__dirname, "otto-kanban-gh.cjs"),
          )("./otto-kanban-gh-board.cjs").initialize;
          initialize(state);
          const card = state.cards?.find((entry) => entry.id === cardId);
          if (!card) throw new Error("Synthetic provider card is missing");
          card.title = title;
          // Deliberately keep the project's provider change marker unchanged.
          // An underlying issue edit must still converge through full reads.
          const staged = path.join(directory, "external-state.next");
          await writeFile(staged, JSON.stringify(state));
          await rename(staged, path.join(directory, "state.json"));
        },
        requests: async () => {
          const text = await readFile(path.join(directory, "requests.jsonl"), "utf8");
          return text
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        },
        write: async (target) => {
          const result = setProjectTarget.output.parse(
            await client.invokePluginRpc("otto-kanban", setProjectTarget.name, {
              binding,
              expectedRevision: (await read()).settingsRevision,
              target,
            }),
          );
          if (!result.ok) throw new Error(result.error.message);
          return result.value;
        },
      };
      if (kanbanWithBoard) {
        await setProviderError(null);
        await fixture.write({ adapter: "github", boardId: "42", boardOwner: "paseo-e2e" });
      }
      await provide(fixture);
    } finally {
      try {
        await connection?.close();
      } finally {
        await project.cleanup();
      }
    }
  },
});
export { expect };

export async function openKanban(page: Page, compact: boolean): Promise<void> {
  if (compact) await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
  await page.locator('[data-testid="plugin-sidebar-otto-kanban-kanban"]:visible').first().click();
  await expect(page.getByRole("button", { name: "Project Settings", exact: true })).toBeVisible();
}
