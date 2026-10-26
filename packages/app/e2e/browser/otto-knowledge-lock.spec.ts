import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  mutateKnowledge,
  readKnowledgePage,
  readKnowledgeCatalog,
  inspectKnowledgeWriteLock,
} from "@getpaseo/plugin/otto/project-knowledge";
import { test, expect } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { callKnowledgeMcp, openWorkspaceKnowledge } from "../support/helpers/otto-knowledge";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });
for (const compact of [false, true]) {
  test(`Knowledge explicit lock recovery retains draft and original bytes (${compact ? "compact" : "wide"})`, async ({
    page,
  }, testInfo) => {
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const project = await seedWorkspace({
      repoPrefix: "otto-knowledge-lock-",
      title: "Write lock fixture",
      git: false,
    });
    try {
      const created = mutateKnowledge.output.parse(
        await callKnowledgeMcp("manage_project_knowledge", {
          workspaceId: project.workspaceId,
          command: {
            action: "create",
            kind: "requirement",
            id: "lock-proof",
            title: "Write lock proof",
            statement: "Original retained body.",
            tags: [],
          },
        }),
      );
      expect(created.ok).toBe(true);
      const catalog = readKnowledgeCatalog.output.parse(
        await callKnowledgeMcp("list_project_knowledge", {
          workspaceId: project.workspaceId,
          includeInactive: true,
        }),
      );
      expect(catalog).toMatchObject({ ok: true, value: { settings: { location: "repository" } } });
      const directory = path.join(project.repoPath, ".otto/knowledge");
      const file = path.join(directory, "requirements/lock-proof.md");
      const bytes = await readFile(file);
      const lock = path.join(directory, ".write-lock");
      await mkdir(lock);
      const surface = await openWorkspaceKnowledge({
        page,
        workspaceId: project.workspaceId,
        compact,
      });
      await surface
        .getByTestId("knowledge-record-lock-proof")
        .getByRole("button", { name: "Open", exact: true })
        .click();
      await surface.getByRole("button", { name: "Edit truth", exact: true }).click();
      const editor = surface.getByTestId("knowledge-editor");
      await editor
        .getByRole("textbox", { name: "Markdown", exact: true })
        .fill("Retained local draft.");
      await editor
        .getByRole("textbox", { name: "Reason", exact: true })
        .fill("Explicit separate edit");
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      const recovery = editor.getByTestId("knowledge-lock-recovery");
      await expect(recovery).toBeVisible();
      await expect(editor.getByRole("textbox", { name: "Markdown", exact: true })).toHaveValue(
        "Retained local draft.",
      );
      await recovery.getByRole("button", { name: "Inspect write lock", exact: true }).click();
      const submit = recovery.getByRole("button", { name: "Recover verified lock", exact: true });
      await expect(submit).toBeDisabled();
      await recovery
        .getByRole("textbox", { name: "Recovery reason", exact: true })
        .fill("All fixture writers verified stopped");
      await recovery
        .getByRole("switch", {
          name: "I verified that all Knowledge writers using this store have stopped",
          exact: true,
        })
        .click();
      page.once("dialog", (dialog) => void dialog.dismiss());
      await submit.click();
      expect(await readdir(lock)).toEqual([]);
      expect(await readFile(file)).toEqual(bytes);
      page.once("dialog", (dialog) => void dialog.accept());
      await submit.click();
      await expect(recovery.getByText(/Lock retained as \.recovered-write-lock-/)).toBeVisible();
      await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      await expect(editor.getByRole("textbox", { name: "Markdown", exact: true })).toHaveValue(
        "Retained local draft.",
      );
      expect(await readFile(file)).toEqual(bytes);
      const retained = (await readdir(directory)).filter((name) =>
        name.startsWith(".recovered-write-lock-"),
      );
      expect(retained).toHaveLength(1);
      expect(
        JSON.parse(
          await readFile(path.join(directory, retained[0], ".recovery-claim.json"), "utf8"),
        ),
      ).toMatchObject({
        reason: "All fixture writers verified stopped",
        humanVerifiedNoActiveWriter: true,
      });
      const plan = inspectKnowledgeWriteLock.output.parse(
        await callKnowledgeMcp("inspect_project_knowledge_lock", {
          workspaceId: project.workspaceId,
        }),
      );
      expect(plan).toMatchObject({ ok: true, value: { state: "unlocked" } });
      const screenshot = testInfo.outputPath(`knowledge-lock-${compact ? "compact" : "wide"}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await testInfo.attach("Explicit recovery retains the blocked draft", {
        path: screenshot,
        contentType: "image/png",
      });
      page.once("dialog", (dialog) => void dialog.accept());
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await surface.getByRole("button", { name: "Edit truth", exact: true }).click();
      await editor
        .getByRole("textbox", { name: "Markdown", exact: true })
        .fill("A fresh explicit write after recovery.");
      await editor
        .getByRole("textbox", { name: "Reason", exact: true })
        .fill("Fresh edit against the current page");
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        surface.getByText("A fresh explicit write after recovery.", { exact: true }),
      ).toBeVisible();
      const record = readKnowledgePage.output.parse(
        await callKnowledgeMcp("read_project_knowledge", {
          workspaceId: project.workspaceId,
          id: "lock-proof",
          includeInactive: true,
        }),
      );
      expect(record).toMatchObject({
        ok: true,
        value: { statement: "A fresh explicit write after recovery.", status: "proposed" },
      });
    } finally {
      await project.cleanup();
    }
  });
}
