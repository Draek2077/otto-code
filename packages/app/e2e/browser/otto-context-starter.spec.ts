import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { test, expect } from "../support/helpers/otto-provider-settings";
import { seedWorkspace } from "../support/helpers/seed-client";
import { gotoAppShell } from "../support/helpers/app";
import { openWorkspaceContextMenu } from "../support/helpers/sidebar";
import { getServerId } from "../support/helpers/server-id";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });
const Completion = z.object({ messages: z.array(z.object({ content: z.string() })).length(1) });
for (const compact of [false, true]) {
  test(`Context starter review, create confirmation and conflict recovery (${compact ? "compact" : "wide"})`, async ({
    page,
    ottoProvider,
  }, testInfo) => {
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const workspace = await seedWorkspace({
      repoPrefix: "otto-context-starter-",
      title: "Starter fixture",
      git: false,
    });
    const file = path.join(workspace.repoPath, "AGENTS.md"),
      lock = `${file}.otto-context-lock`;
    await writeFile(
      path.join(workspace.repoPath, "README.md"),
      "# Starter fixture\nUse concise instructions.",
    );
    ottoProvider.replyWith((body) => {
      const request = Completion.parse(body);
      expect(body).not.toHaveProperty("tools");
      expect(request.messages[0]!.content).toContain("Use concise instructions.");
      return JSON.stringify({ text: "# Starter fixture\nUse concise instructions.\n" });
    });
    try {
      await ottoProvider.refreshCatalog();
      await gotoAppShell(page);
      if (compact) {
        await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
        await page
          .getByTestId(`sidebar-workspace-kebab-${getServerId()}:${workspace.workspaceId}`)
          .click();
      } else await openWorkspaceContextMenu(page, workspace.workspaceId);
      await page.getByText("Open Context Management", { exact: true }).click();
      const surface = page.getByTestId("otto-context-management").filter({ visible: true });
      const setup = surface.getByTestId("context-starter");
      await setup.getByRole("button", { name: "Load repository context", exact: true }).click();
      await setup.getByTestId("combined-model-selector").click();
      await page
        .getByTestId("model-search-all-input")
        .or(page.getByTestId("model-search-input"))
        .filter({ visible: true })
        .fill("fixture");
      await page.getByTestId("model-row-openai-compatible-fixture").click();
      await setup.getByRole("button", { name: "Generate starter draft", exact: true }).click();
      const draft = setup.getByTestId("context-starter-draft");
      await expect(draft).toHaveValue("# Starter fixture\nUse concise instructions.\n");
      await expect(readFile(file, "utf8")).rejects.toThrow();
      await draft.fill("# Reviewed starter\nKeep this reviewed instruction.\n");
      const create = setup.getByRole("button", {
        name: "Create reviewed instruction file",
        exact: true,
      });
      page.once("dialog", (dialog) => void dialog.dismiss());
      await create.click();
      await expect(draft).toHaveValue("# Reviewed starter\nKeep this reviewed instruction.\n");
      await expect(readFile(file, "utf8")).rejects.toThrow();
      await writeFile(lock, "another-writer");
      page.once("dialog", (dialog) => void dialog.accept());
      await create.click();
      await expect(
        surface.getByText("Another context writer owns this file's lock.", { exact: false }),
      ).toBeVisible();
      await expect(create).toBeDisabled();
      await expect(draft).toHaveValue("# Reviewed starter\nKeep this reviewed instruction.\n");
      expect(await readFile(lock, "utf8")).toBe("another-writer");
      await unlink(lock);
      await surface.getByRole("button", { name: "Refresh context", exact: true }).click();
      page.once("dialog", (dialog) => void dialog.accept());
      await create.click();
      await expect
        .poll(async () => {
          try {
            return await readFile(file, "utf8");
          } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
            throw error;
          }
        })
        .toBe("# Reviewed starter\nKeep this reviewed instruction.\n");
      await expect(setup).toBeHidden();
      await expect(surface.getByText("AGENTS.md", { exact: true }).first()).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`context-starter-${compact ? "compact" : "wide"}.png`),
      });
    } finally {
      await workspace.cleanup();
    }
  });
}
