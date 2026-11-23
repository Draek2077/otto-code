import { test, expect } from "../support/fixtures";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { installUsageReportsFixture } from "../support/helpers/usage-reports";
import { openUsageFromIcon } from "../support/helpers/usage-sidebar-item";

test("a provider prompt prediction fills an editable draft without sending it", async ({
  page,
}) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "otto-prediction-",
    title: "Prompt prediction",
  });
  let turns = 0;
  try {
    await page.routeWebSocket(daemonWsRoutePattern(), (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        socket.send(message);
        const frame = JSON.parse(message.toString());
        const payload = frame.message?.payload;
        if (payload?.agentId !== workspace.agentId || payload.event?.type !== "turn_completed")
          return;
        turns += 1;
        socket.send(
          JSON.stringify({
            ...frame,
            message: {
              type: "agent_stream",
              payload: {
                agentId: workspace.agentId,
                subscriptionId: payload.subscriptionId,
                timestamp: payload.timestamp,
                event: {
                  type: "prompt_suggestion",
                  provider: "claude",
                  suggestion: "Run the focused tests.",
                },
              },
            },
          }),
        );
      });
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAgentRoute(page, workspace);
    const input = page.getByRole("textbox", { name: "Message agent..." }).filter({ visible: true });
    const accept = page.getByTestId("composer-use-prompt-suggestion").filter({ visible: true });
    await expect(input).toBeVisible();
    await workspace.client.sendAgentMessage(workspace.agentId, "Show the first prediction.");
    await expect(accept).toBeVisible();
    await input.press("Tab");
    await expect(input).toHaveValue("Run the focused tests.");
    await expect(accept).toBeHidden();
    await expect(page.getByText("Run the focused tests.", { exact: true })).toBeHidden();
    await input.fill("My own draft");
    await workspace.client.sendAgentMessage(workspace.agentId, "Refresh the prediction.");
    await expect.poll(() => turns).toBe(2);
    await expect(accept).toBeHidden();
    await expect(input).toHaveValue("My own draft");
    await input.fill("");
    await expect(accept).toBeVisible();
    await accept.click();
    await expect(input).toHaveValue("Run the focused tests.");
    await expect(accept).toBeHidden();
  } finally {
    await page.close();
    await workspace.cleanup();
  }
});

test("Usage shows live host activity and opens the itemized log", async ({ page }) => {
  await installUsageReportsFixture(page, { lists: [[]] });
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "otto-activity-",
    title: "Activity receipt",
  });
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAgentRoute(page, workspace);
    await expect(
      page.getByRole("textbox", { name: "Message agent..." }).filter({ visible: true }),
    ).toBeVisible();
    await workspace.client.sendAgentMessage(workspace.agentId, "Record this message.");
    await openUsageFromIcon(page);
    const modal = page.getByTestId("usage-modal");
    await modal.getByRole("button", { name: "Activity", exact: true }).click();
    await expect(modal.getByText("Messages sent", { exact: true })).toBeVisible();
    await expect(modal.getByText("Chats created", { exact: true })).toBeVisible();
    await modal.getByRole("button", { name: "Log", exact: true }).click();
    await expect(modal.getByRole("button", { name: "Older", exact: true })).toBeVisible();
    await expect(modal.getByRole("button", { name: "Newer", exact: true })).toBeDisabled();
  } finally {
    await page.close();
    await workspace.cleanup();
  }
});
