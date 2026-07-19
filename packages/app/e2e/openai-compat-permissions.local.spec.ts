import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";
import {
  buildLocalAiAgentRoute,
  LOCAL_AI_TURN_TIMEOUT_MS,
  seedLocalAiAgent,
} from "./helpers/local-ai";
import {
  asLocalAiFlowClient,
  isToolCallItem,
  respondToPermissionsUntilFinish,
  waitForTimelineItem,
} from "./helpers/local-ai-flows";
import { waitForPermissionPrompt } from "./helpers/permissions";

/**
 * Tier-2: proves the daemon-owned permission gate on the openai-compat tool
 * loop. In "default" (Always Ask) mode the builtin write_file tool is
 * edit-kind, so the daemon parks the turn on a permission prompt before
 * executing it (openai-compat-agent.ts toolNeedsApproval). Denying must leave
 * no side effect on disk; approving must let the exact write land. Asserts on
 * the file and on daemon-emitted tool-call rows — never on model prose.
 */

const TARGET_FILE = "gated.txt";
const TARGET_CONTENT = "gated";

const PROMPT =
  `Create a file named ${TARGET_FILE} in the current directory containing exactly ` +
  `"${TARGET_CONTENT}" (without the quotes) and nothing else. Use your write_file tool. ` +
  `Do not run shell commands. If the user declines a tool call, stop immediately — ` +
  `do not retry and do not use any other tool. Do not explain anything.`;

test.describe("openai-compat permission gating (Always Ask)", () => {
  test.setTimeout(420_000);

  test("denying the gated tool stops it: no file lands on disk", async ({ page }) => {
    const seeded = await seedLocalAiAgent({
      repoPrefix: "local-ai-perm-deny",
      title: "Local AI permission deny",
      modeId: "default",
      initialPrompt: PROMPT,
    });
    try {
      const { agentId, workspace } = seeded;
      const client = asLocalAiFlowClient(workspace.client);
      const targetPath = path.join(workspace.repoPath, TARGET_FILE);

      await page.goto(buildLocalAiAgentRoute(workspace.workspaceId, agentId));
      await waitForPermissionPrompt(page, LOCAL_AI_TURN_TIMEOUT_MS);

      // Parked on the prompt means the tool has not executed yet.
      expect(existsSync(targetPath)).toBe(false);

      const finished = await respondToPermissionsUntilFinish({
        page,
        client,
        agentId,
        behavior: "deny",
        timeoutMs: LOCAL_AI_TURN_TIMEOUT_MS,
      });
      expect(finished.status).toBe("idle");

      // The observable contract of a denial: the file never appears.
      expect(existsSync(targetPath)).toBe(false);

      // The denied call is recorded as a failed write_file tool row.
      await waitForTimelineItem({
        client,
        agentId,
        predicate: (item) => isToolCallItem(item, { name: "write_file", status: "failed" }),
        label: "failed write_file tool call after denial",
      });
    } finally {
      await seeded.cleanup();
    }
  });

  test("approving the gated tool lets it proceed: file lands on disk", async ({ page }) => {
    const seeded = await seedLocalAiAgent({
      repoPrefix: "local-ai-perm-allow",
      title: "Local AI permission allow",
      modeId: "default",
      initialPrompt: PROMPT,
    });
    try {
      const { agentId, workspace } = seeded;
      const client = asLocalAiFlowClient(workspace.client);
      const targetPath = path.join(workspace.repoPath, TARGET_FILE);

      await page.goto(buildLocalAiAgentRoute(workspace.workspaceId, agentId));
      await waitForPermissionPrompt(page, LOCAL_AI_TURN_TIMEOUT_MS);
      expect(existsSync(targetPath)).toBe(false);

      const finished = await respondToPermissionsUntilFinish({
        page,
        client,
        agentId,
        behavior: "allow",
        timeoutMs: LOCAL_AI_TURN_TIMEOUT_MS,
      });
      expect(finished.status).toBe("idle");

      // Approval let the exact write land.
      expect(existsSync(targetPath)).toBe(true);
      expect(readFileSync(targetPath, "utf8").trim()).toBe(TARGET_CONTENT);

      await waitForTimelineItem({
        client,
        agentId,
        predicate: (item) => isToolCallItem(item, { name: "write_file", status: "completed" }),
        label: "completed write_file tool call after approval",
      });
    } finally {
      await seeded.cleanup();
    }
  });
});
