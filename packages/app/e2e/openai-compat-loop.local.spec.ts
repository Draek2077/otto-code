import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";
import {
  buildLocalAiAgentRoute,
  LOCAL_AI_TURN_TIMEOUT_MS,
  seedLocalAiAgent,
} from "./helpers/local-ai";

/**
 * Tier-2 flagship: proves the openai-compat daemon-owned tool loop end to end
 * with real local inference — prompt in, native tool call out, file written to
 * the workspace, change visible in the UI. Asserts side effects only, never
 * model prose.
 */

const TARGET_FILE = "hello-e2e.txt";
const TARGET_CONTENT = "hello-e2e";

test("live agent loop: prompt → tool call → file on disk → change visible", async ({ page }) => {
  const prompt =
    `Create a file named ${TARGET_FILE} in the current directory containing exactly ` +
    `"${TARGET_CONTENT}" (without the quotes) and nothing else — no trailing newline is fine. ` +
    `Use your file tools. Do not run shell commands. Do not explain anything.`;

  const seeded = await seedLocalAiAgent({
    repoPrefix: "local-ai-loop",
    title: "Local AI loop smoke",
    initialPrompt: prompt,
    // Default mode is Always Ask, which would park this run on a write_file
    // permission prompt; the loop smoke wants an unattended straight-through run.
    modeId: "bypassPermissions",
  });

  try {
    const { agentId, workspace } = seeded;

    // Watch the run from the UI while the daemon drives the live model.
    await page.goto(buildLocalAiAgentRoute(workspace.workspaceId, agentId));
    await expect(page.getByText(TARGET_FILE).first()).toBeVisible({ timeout: 60_000 });

    const finished = await workspace.client.waitForFinish(agentId, LOCAL_AI_TURN_TIMEOUT_MS);
    expect(finished.final?.lastError ?? null).toBeNull();

    // The loop's observable side effect: the exact file, on disk.
    const targetPath = path.join(workspace.repoPath, TARGET_FILE);
    expect(existsSync(targetPath)).toBe(true);
    expect(readFileSync(targetPath, "utf8").trim()).toBe(TARGET_CONTENT);

    // And the daemon sees it as a working-tree change the UI can show.
    const refresh = await workspace.client.checkoutRefresh(workspace.repoPath);
    expect(refresh.success).toBe(true);
    await expect(page.getByText(TARGET_FILE).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    await seeded.cleanup();
  }
});
