import { expect, test } from "./fixtures";
import { allowPermission, denyPermission, waitForPermissionPrompt } from "./helpers/permissions";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";

// The mock provider's scripted "Emit synthetic tool permission." scenario
// (packages/server/src/server/agent/providers/mock-load-test-agent.ts): the
// turn starts, emits a kind:"tool" permission_requested for a shell command,
// and stays pending until the prompt is answered. Allow surfaces a completed
// tool call plus "Synthetic tool approved; run complete."; deny skips the tool
// and surfaces "Synthetic tool denied: <message>".
const TOOL_PERMISSION_PROMPT = "Emit synthetic tool permission.";
const TOOL_COMMAND = "npm run build";
const APPROVED_MARKER = "Synthetic tool approved; run complete.";
const DENIED_MARKER = /Synthetic tool denied: Denied by user/;

test.describe("Permission prompt roundtrip", () => {
  test("renders the tool info and continues the run after Approve", async ({ page }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "permission-approve-",
      title: "Permission approve e2e",
      initialPrompt: TOOL_PERMISSION_PROMPT,
    });

    try {
      await openAgentRoute(page, session);

      await waitForPermissionPrompt(page, 120_000);

      // Tool info: title (request.name/title), description, and the shell
      // command from the tool-call detail all render on the prompt.
      await expect(page.getByText("Bash", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Run a shell command", { exact: true }).first()).toBeVisible();
      await expect(page.getByText(TOOL_COMMAND).first()).toBeVisible();

      await allowPermission(page);

      // The prompt resolves and the run continues to completion: the mock emits
      // the approved tool call and its closing assistant message.
      await expect(page.getByTestId("permission-request-question")).toHaveCount(0, {
        timeout: 30_000,
      });
      await expect(page.getByText(APPROVED_MARKER).first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await session.cleanup();
    }
  });

  test("stops the tool and surfaces the denial after Deny", async ({ page }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "permission-deny-",
      title: "Permission deny e2e",
      initialPrompt: TOOL_PERMISSION_PROMPT,
    });

    try {
      await openAgentRoute(page, session);

      await waitForPermissionPrompt(page, 120_000);

      await denyPermission(page);

      // The prompt resolves without running the tool: the denial (including the
      // client's "Denied by user" message) is surfaced in the timeline and the
      // approved-path marker never appears.
      await expect(page.getByTestId("permission-request-question")).toHaveCount(0, {
        timeout: 30_000,
      });
      await expect(page.getByText(DENIED_MARKER).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(APPROVED_MARKER)).toHaveCount(0);
    } finally {
      await session.cleanup();
    }
  });
});
