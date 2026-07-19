import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";
import { restartTestDaemon } from "./helpers/daemon-restart";
import {
  buildLocalAiAgentRoute,
  LOCAL_AI_TURN_TIMEOUT_MS,
  seedLocalAiAgent,
} from "./helpers/local-ai";
import {
  asLocalAiFlowClient,
  isToolCallItem,
  waitForTimelineItem,
  type LocalAiFlowClient,
} from "./helpers/local-ai-flows";
import { connectSeedClient } from "./helpers/seed-client";

/**
 * Tier-2: proves openai-compat history fidelity across a daemon restart. The
 * provider persists its conversation (including tool calls) and replays it on
 * resume, so after `restartTestDaemon()` — same OTTO_HOME, same port, same
 * global-setup environment — the rehydrated timeline must still carry the
 * user prompt and the executed tool call, and the reopened UI must render
 * both. Asserts on durable timeline structure and disk state — never on model
 * prose.
 */

const TARGET_FILE = "resume-proof.txt";
const TARGET_CONTENT = "resume-proof";

const PROMPT =
  `Create a file named ${TARGET_FILE} in the current directory containing exactly ` +
  `"${TARGET_CONTENT}" (without the quotes) and nothing else. Use your write_file tool. ` +
  `Do not run shell commands. Do not explain anything.`;

test.describe("openai-compat resume after daemon restart", () => {
  test.setTimeout(420_000);

  test("timeline still shows the prompt and tool call after restart", async ({ page }) => {
    const seeded = await seedLocalAiAgent({
      repoPrefix: "local-ai-resume",
      title: "Local AI resume",
      modeId: "bypassPermissions",
      initialPrompt: PROMPT,
    });
    let restartedClient: LocalAiFlowClient | null = null;
    try {
      const { agentId, workspace } = seeded;
      const client = asLocalAiFlowClient(workspace.client);
      const targetPath = path.join(workspace.repoPath, TARGET_FILE);

      // The tool-using turn completes and leaves its side effect on disk.
      const finished = await client.waitForFinish(agentId, LOCAL_AI_TURN_TIMEOUT_MS);
      expect(finished.status).toBe("idle");
      expect(finished.final?.lastError ?? null).toBeNull();
      await waitForTimelineItem({
        client,
        agentId,
        predicate: (item) => isToolCallItem(item, { name: "write_file", status: "completed" }),
        label: "completed write_file tool call before restart",
        timeoutMs: LOCAL_AI_TURN_TIMEOUT_MS,
      });
      expect(existsSync(targetPath)).toBe(true);
      expect(readFileSync(targetPath, "utf8").trim()).toBe(TARGET_CONTENT);

      // Same OTTO_HOME, same port — exercises the rehydration path.
      await restartTestDaemon();

      // The old client's socket died with the daemon; reconnect fresh.
      restartedClient = asLocalAiFlowClient(await connectSeedClient());

      // History fidelity: the rehydrated durable timeline still carries the
      // user prompt and the executed tool call.
      await waitForTimelineItem({
        client: restartedClient,
        agentId,
        predicate: (item) => item.type === "user_message" && item["text"] === PROMPT,
        label: "user prompt after restart",
        timeoutMs: 60_000,
      });
      await waitForTimelineItem({
        client: restartedClient,
        agentId,
        predicate: (item) => isToolCallItem(item, { name: "write_file", status: "completed" }),
        label: "completed write_file tool call after restart",
        timeoutMs: 60_000,
      });

      // The reopened chat renders the prompt row and a tool-call row.
      await page.goto(buildLocalAiAgentRoute(workspace.workspaceId, agentId));
      await expect(
        page.getByTestId("user-message").filter({ hasText: TARGET_FILE }).first(),
      ).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("tool-call-badge").first()).toBeVisible({ timeout: 30_000 });
    } finally {
      if (restartedClient) {
        // The seeded cleanup's client died with the old daemon; unregister the
        // project through the fresh connection before the generic cleanup.
        await restartedClient.removeProject(seeded.workspace.projectId).catch(() => undefined);
        await restartedClient.close().catch(() => undefined);
      }
      await seeded.cleanup();
    }
  });
});
