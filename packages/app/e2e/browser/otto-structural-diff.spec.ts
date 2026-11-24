import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { buildSettingsSectionRoute } from "../../src/utils/host-routes";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test("Settings preview follows the saved diff default and can compare without changing it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 844 });
  await page.goto(buildSettingsSectionRoute("editor"));
  const saved = page.getByTestId("otto-diff-presentation");
  await expect(saved).toContainText("Line");
  await page.getByTestId("diff-preview-toggle").click();
  const preview = page.getByTestId("diff-preview");
  const oldDiff = preview.getByTestId("diff-preview-line");
  const newDiff = preview.getByTestId("diff-preview-structural");
  const before = preview.getByText("return palette.red;", { exact: false }).last();
  const after = preview.getByText("return palette.blue;", { exact: false }).last();

  await expect(oldDiff).toHaveAttribute("aria-selected", "true");
  await expectPreviewAlignment(before, after, "stacked");

  await selectStructural(page, saved);
  await expect(newDiff).toHaveAttribute("aria-selected", "true");
  await expectPreviewAlignment(before, after, "paired");

  await oldDiff.click();
  await expect(oldDiff).toHaveAttribute("aria-selected", "true");
  await expectPreviewAlignment(before, after, "stacked");
  await expect(saved).toContainText("Structural");

  await saved.click();
  await page.getByText("Line", { exact: true }).last().click();
  await expect(saved).toContainText("Line");
  await newDiff.click();
  await expectPreviewAlignment(before, after, "paired");
  await expect(saved).toContainText("Line");

  // The next saved-default change replaces the temporary comparison selection.
  await selectStructural(page, saved);
  await saved.click();
  await page.getByText("Line", { exact: true }).last().click();
  await expect(oldDiff).toHaveAttribute("aria-selected", "true");
  await expectPreviewAlignment(before, after, "stacked");
});

async function expectPreviewAlignment(
  before: Locator,
  after: Locator,
  layout: "stacked" | "paired",
) {
  await expect(before).toBeVisible();
  await expect(after).toBeVisible();
  await expect
    .poll(async () => {
      const [left, right] = await Promise.all([before.boundingBox(), after.boundingBox()]);
      if (!left || !right) return null;
      if (right.x > left.x && Math.abs(right.y - left.y) < 1) return "paired";
      return right.y > left.y ? "stacked" : null;
    })
    .toBe(layout);
}

async function selectStructural(page: Page, picker: Locator) {
  await picker.click();
  await page.getByText("Structural", { exact: true }).last().click();
  await expect(picker).toContainText("Structural");
}

test("Structural Changes paints formatting-only rows from the real Git comparison", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      if (this.canvas.dataset.testid === "git-diff-canvas" && text.includes("Formatting only")) {
        this.canvas.dataset.structuralPaint = text;
      }
      if (maxWidth === undefined) original.call(this, text, x, y);
      else original.call(this, text, x, y, maxWidth);
    };
  });
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "structural-working-",
    title: "Working source review",
    repo: {
      withRemote: true,
      files: [
        { path: ".gitignore", content: "/remote.git/\n" },
        { path: "source.ts", content: "export const object = { item: 1 };\n" },
      ],
    },
  });
  try {
    await writeFile(
      path.join(workspace.cwd, "source.ts"),
      "export const object = {\n  item: 1\n};\n",
    );
    await workspace.client.checkoutRefresh(workspace.cwd);
    await page.setViewportSize({ width: 1400, height: 900 });
    await openAgentRoute(page, workspace);
    const changes = page.getByTestId("composer-diff-stat-pill");
    await changes.click();
    await expect(page.getByTestId("changes-tree-panel")).toBeVisible();
    await changes.click();
    const canvas = page.getByTestId("working-diff-panel").getByTestId("git-diff-canvas");
    await expect(canvas).toBeVisible();
    await selectStructural(
      page,
      page.getByTestId("otto-diff-presentation").filter({ visible: true }),
    );
    await expect(canvas).toHaveAttribute("data-structural-paint", /Formatting only/);
  } finally {
    await page.close();
    await workspace.cleanup();
  }
});

test("Structural tool edits display captured before and after source", async ({ page }) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "structural-edit-card-",
    title: "Edit card review",
    model: "ten-second-stream",
  });
  const seen = new Set<string>();
  let exactCall: string | undefined;
  try {
    // Replay tool metadata through the same timeline frames as the provider uses.
    await page.routeWebSocket(daemonWsRoutePattern(), (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        const frame = JSON.parse(message.toString());
        const payload = frame.message?.payload;
        const item = payload?.event?.item;
        if (payload?.agentId === workspace.agentId && item?.type === "tool_call") {
          seen.add(item.callId);
          exactCall ??= item.callId;
          item.name = "Edit";
          item.detail =
            item.callId === exactCall
              ? {
                  type: "edit",
                  filePath: "source.ts",
                  oldString: "const total = 17;",
                  newString: "const total = 19;",
                }
              : {
                  type: "edit",
                  filePath: "source.ts",
                  unifiedDiff: "@@ -1 +1 @@\n-const total = 19;\n+const total = 21;",
                };
        }
        socket.send(JSON.stringify(frame));
      });
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAgentRoute(page, workspace);
    await workspace.client.sendAgentMessage(workspace.agentId, "Show this edit review.");
    await expect.poll(() => seen.size, { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
    await expect(page.getByRole("button", { name: /^Worked for / })).toBeVisible({
      timeout: 30_000,
    });
    const group = page
      .getByTestId("action-group-badge")
      .filter({ hasText: /^Edited 2 files/ })
      .first();
    const header = group.getByRole("button", { name: /^Edited 2 files/ }).first();
    await expect(group.getByTestId("action-group-members")).toHaveCount(0);
    // Use the same keyboard path as the grouped transcript journeys.
    await header.focus();
    await page.keyboard.press("Enter");
    await expect(group.getByTestId("action-group-members")).toBeVisible();
    await group.getByRole("button", { name: "Edit source.ts", exact: true }).first().click();
    const picker = page.getByTestId("otto-diff-presentation").filter({ visible: true }).last();
    await selectStructural(page, picker);
    await expect(page.getByText("const total = 17;", { exact: false }).last()).toBeVisible();
    await expect(page.getByText("const total = 19;", { exact: false }).last()).toBeVisible();
  } finally {
    await page.close();
    await workspace.cleanup();
  }
});
