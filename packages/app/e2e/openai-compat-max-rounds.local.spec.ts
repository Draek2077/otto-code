import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";
import {
  buildLocalAiAgentRoute,
  LOCAL_AI_PROVIDER,
  LOCAL_AI_TURN_TIMEOUT_MS,
  seedLocalAiAgent,
} from "./helpers/local-ai";
import { asLocalAiFlowClient, waitForTimelineItem } from "./helpers/local-ai-flows";

/**
 * Tier-2: proves the provider-level `maxToolRounds` cap halts the daemon-owned
 * tool loop. The cap is provider-wide config (protocol provider-config.ts,
 * MAX_TOOL_ROUNDS_MIN = 1), not a per-agent feature, so the spec patches the
 * injected LM Studio provider down to 1 round via `set_daemon_config_request`
 * (deep-merged, hot-applied to new and live sessions through
 * updateProviderRegistry/applyMaxToolRounds) and restores the global-setup
 * value of 25 afterwards. With a 1-round cap, ANY response containing a tool
 * call exhausts the loop after executing that round, and the daemon emits the
 * timeline error item "Stopped after 1 tool rounds without a final answer."
 * (openai-compat-agent.ts runToolLoop) — a daemon-authored marker, not model
 * prose.
 */

const TARGET_FILE = "cap.txt";
const TARGET_CONTENT = "cap";
const GLOBAL_SETUP_MAX_TOOL_ROUNDS = 25;
const CAP_MESSAGE_PATTERN = /Stopped after 1 tool rounds without a final answer/;

const PROMPT =
  `Create a file named ${TARGET_FILE} in the current directory containing exactly ` +
  `"${TARGET_CONTENT}" (without the quotes) and nothing else. Use your write_file tool. ` +
  `Do not run shell commands. Do not explain anything.`;

test.describe("openai-compat max tool rounds cap", () => {
  test.setTimeout(360_000);

  test("a 1-round cap halts the loop and surfaces the cap message", async ({ page }) => {
    const seeded = await seedLocalAiAgent({
      repoPrefix: "local-ai-max-rounds",
      title: "Local AI max rounds cap",
      modeId: "bypassPermissions",
    });
    const { agentId, workspace } = seeded;
    const client = asLocalAiFlowClient(workspace.client);
    try {
      await client.patchDaemonConfig({
        providers: { [LOCAL_AI_PROVIDER]: { maxToolRounds: 1 } },
      });

      await page.goto(buildLocalAiAgentRoute(workspace.workspaceId, agentId));
      await client.sendAgentMessage(agentId, PROMPT);
      const finished = await client.waitForFinish(agentId, LOCAL_AI_TURN_TIMEOUT_MS);
      expect(finished.status).toBe("idle");

      // The cap marker the daemon emits when the loop is exhausted.
      await waitForTimelineItem({
        client,
        agentId,
        predicate: (item) =>
          item.type === "error" && CAP_MESSAGE_PATTERN.test(String(item["message"] ?? "")),
        label: "max-tool-rounds cap error item",
      });

      // Round 0's tool call still executed before the cap kicked in.
      expect(existsSync(path.join(workspace.repoPath, TARGET_FILE))).toBe(true);

      // The cap is visible in the chat as an error activity row.
      await expect(page.getByText(CAP_MESSAGE_PATTERN).first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await client
        .patchDaemonConfig({
          providers: { [LOCAL_AI_PROVIDER]: { maxToolRounds: GLOBAL_SETUP_MAX_TOOL_ROUNDS } },
        })
        .catch(() => undefined);
      await seeded.cleanup();
    }
  });
});
