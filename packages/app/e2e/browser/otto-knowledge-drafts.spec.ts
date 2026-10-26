import type { Page } from "@playwright/test";
import { mutateKnowledge, readKnowledgePage } from "@getpaseo/plugin/otto/project-knowledge";
import { test, expect } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { callKnowledgeMcp } from "../support/helpers/otto-knowledge";
import { gotoAppShell } from "../support/helpers/app";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });
async function openKnowledge(input: { page: Page; compact: boolean }) {
  if (input.compact)
    await input.page.getByRole("button", { name: "Open menu", exact: true }).first().click();
  await input.page
    .getByText("Knowledge", { exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(
    input.page.getByTestId("otto-knowledge-page").filter({ visible: true }),
  ).toBeVisible();
}
async function chooseProject(input: { page: Page; label: string }) {
  await input.page.getByRole("button", { name: /^Project:/ }).click();
  await input.page.getByRole("menuitem", { name: input.label, exact: true }).click();
}
for (const compact of [false, true]) {
  test(`Knowledge retains scoped drafts across project changes and route departure (${compact ? "compact" : "wide"})`, async ({
    page,
  }, testInfo) => {
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const first = await seedWorkspace({
      repoPrefix: "otto-knowledge-draft-a-",
      title: "First draft workspace",
      git: false,
    });
    try {
      const second = await seedWorkspace({
        repoPrefix: "otto-knowledge-draft-b-",
        title: "Other project",
        git: false,
      });
      try {
        const created = mutateKnowledge.output.parse(
          await callKnowledgeMcp("manage_project_knowledge", {
            workspaceId: first.workspaceId,
            command: {
              action: "create",
              kind: "requirement",
              id: "retained-edit",
              title: "Retained edit",
              statement: "Original saved truth.",
              tags: [],
            },
          }),
        );
        expect(created.ok).toBe(true);
        const origin = readKnowledgePage.output.parse(
          await callKnowledgeMcp("read_project_knowledge", {
            workspaceId: first.workspaceId,
            id: "retained-edit",
            includeInactive: true,
          }),
        );
        if (!origin.ok) throw new Error(origin.error.message);
        await gotoAppShell(page);
        await openKnowledge({ page, compact });
        await chooseProject({ page, label: first.projectDisplayName });
        const surface = page.getByTestId("otto-knowledge-page").filter({ visible: true });
        await surface
          .getByTestId("knowledge-record-retained-edit")
          .getByRole("button", { name: "Open", exact: true })
          .click();
        await surface.getByRole("button", { name: "Edit truth", exact: true }).click();
        const editor = surface.getByTestId("knowledge-editor");
        await editor
          .getByRole("textbox", { name: "Markdown", exact: true })
          .fill("My retained local edit.");
        await editor
          .getByRole("textbox", { name: "Reason", exact: true })
          .fill("Keep this reason with the originating revision");
        await chooseProject({ page, label: second.projectDisplayName });
        await expect(surface.getByTestId("knowledge-editor")).toHaveCount(0);
        await expect(surface.getByText("My retained local edit.", { exact: true })).toHaveCount(0);
        const peer = mutateKnowledge.output.parse(
          await callKnowledgeMcp("manage_project_knowledge", {
            workspaceId: first.workspaceId,
            command: {
              action: "truth",
              kind: "requirement",
              id: "retained-edit",
              expectedRevision: origin.value.revision,
              statement: "Newer peer truth.",
              reason: "An independent explicit writer",
            },
          }),
        );
        expect(peer.ok).toBe(true);
        await chooseProject({ page, label: first.projectDisplayName });
        await expect(editor.getByRole("textbox", { name: "Markdown", exact: true })).toHaveValue(
          "My retained local edit.",
        );
        await expect(editor.getByRole("textbox", { name: "Reason", exact: true })).toHaveValue(
          "Keep this reason with the originating revision",
        );
        await editor.getByRole("button", { name: "Save", exact: true }).click();
        await expect(
          editor.getByText("Knowledge changed. Your draft is retained; reload before saving.", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
        await expect(editor.getByTestId("knowledge-lock-recovery")).toHaveCount(0);
        await page.goBack();
        await expect(page).not.toHaveURL(/\/plugin\/otto-project-knowledge\//);
        await openKnowledge({ page, compact });
        await chooseProject({ page, label: first.projectDisplayName });
        await expect(editor.getByRole("textbox", { name: "Markdown", exact: true })).toHaveValue(
          "My retained local edit.",
        );
        await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
        page.once("dialog", (dialog) => void dialog.dismiss());
        await editor.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(editor.getByRole("textbox", { name: "Markdown", exact: true })).toHaveValue(
          "My retained local edit.",
        );
        const screenshot = testInfo.outputPath(
          `knowledge-retained-draft-${compact ? "compact" : "wide"}.png`,
        );
        await page.screenshot({ path: screenshot, fullPage: true });
        await testInfo.attach("Scoped retained draft refuses stale write", {
          path: screenshot,
          contentType: "image/png",
        });
        page.once("dialog", (dialog) => void dialog.dismiss());
        await editor.getByRole("button", { name: "Reload saved page", exact: true }).click();
        await expect(editor.getByRole("textbox", { name: "Markdown", exact: true })).toHaveValue(
          "My retained local edit.",
        );
        page.once("dialog", (dialog) => void dialog.accept());
        await editor.getByRole("button", { name: "Reload saved page", exact: true }).click();
        await expect(editor.getByRole("textbox", { name: "Markdown", exact: true })).toHaveValue(
          "Newer peer truth.",
        );
        await expect(editor.getByRole("textbox", { name: "Reason", exact: true })).toHaveValue("");
        await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
        await editor
          .getByRole("textbox", { name: "Markdown", exact: true })
          .fill("Explicitly discarded after reload");
        page.once("dialog", (dialog) => void dialog.accept());
        await editor.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(surface.getByTestId("knowledge-editor")).toHaveCount(0);
        const latest = readKnowledgePage.output.parse(
          await callKnowledgeMcp("read_project_knowledge", {
            workspaceId: first.workspaceId,
            id: "retained-edit",
            includeInactive: true,
          }),
        );
        expect(latest).toMatchObject({ ok: true, value: { statement: "Newer peer truth." } });
      } finally {
        await second.cleanup();
      }
    } finally {
      await first.cleanup();
    }
  });
}
