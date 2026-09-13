import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { gotoWorkspace } from "../support/helpers/launcher";
import { moneyShot } from "../support/helpers/evidence";

test("adding an artifact discovers it on another client and keeps tab dismissal local", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120_000);
  const workspace = await seedWorkspace({ repoPrefix: "artifact-discovery-" });
  const artifactId = "shared-workspace-report";
  const directory = join(workspace.repoPath, ".otto", "artifacts");
  const filePath = join(directory, `${artifactId}.html`);
  const metadataPath = join(directory, `${artifactId}.json`);
  const now = new Date().toISOString();
  const metadata = JSON.stringify({
    id: artifactId,
    name: "Shared workspace report",
    description: "Discovery proof",
    projectId: workspace.repoPath,
    filePath,
    kind: "html",
    starred: false,
    status: "ready",
    createdAt: now,
    updatedAt: now,
    generationAgentId: null,
    generationProvider: "mock",
    generationModel: null,
    errorMessage: null,
  });
  let peerContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(
      filePath,
      "<!doctype html><html><head><title>Report</title></head><body><h1>Shared workspace report</h1></body></html>",
      "utf8",
    );
    await writeFile(metadataPath, metadata, "utf8");
    await gotoWorkspace(page, workspace.workspaceId);
    const storageState = await context.storageState();
    for (const origin of storageState.origins) {
      origin.localStorage = origin.localStorage.filter(
        (entry) => entry.name !== "@otto:client-id-v1",
      );
    }
    peerContext = await browser.newContext({ baseURL: new URL(page.url()).origin, storageState });
    const peer = await peerContext.newPage();
    await peer.route(/:(6868)\b/, (route) => route.abort());
    await peer.routeWebSocket(/:(6868)\b/, (socket) => socket.close());
    await gotoWorkspace(peer, workspace.workspaceId);
    const tabId = `workspace-tab-artifact_${artifactId}`;
    await expect(peer.getByTestId(tabId)).toHaveCount(0);

    // A failed attach must show an error without pretending a local tab synced.
    await page
      .getByTestId("workspace-new-tab-menu-trigger")
      .filter({ visible: true })
      .first()
      .click();
    await page.getByTestId("workspace-new-tab-menu-artifacts").click();
    const item = page.getByTestId(`workspace-open-artifact-${artifactId}`);
    await expect(item).toBeVisible();
    await rm(metadataPath);
    await item.click();
    await expect(page.getByText("Could not add artifact", { exact: true })).toBeVisible();
    await expect(page.getByTestId(tabId)).toHaveCount(0);
    await page.getByTestId("confirm-dialog-confirm").click();
    await writeFile(metadataPath, metadata, "utf8");

    await page
      .getByTestId("workspace-new-tab-menu-trigger")
      .filter({ visible: true })
      .first()
      .click();
    await page.getByTestId("workspace-new-tab-menu-artifacts").click();
    await item.click();
    await expect(page.getByTestId(tabId).filter({ visible: true }).first()).toBeVisible();
    const peerTab = peer.getByTestId(tabId).filter({ visible: true }).first();
    await expect(peerTab).toBeVisible();
    await expect(peerTab).toHaveAttribute("aria-selected", "false");
    await peerTab.click({ position: { x: 12, y: 13 } });
    await expect(
      peer
        .locator('iframe[title="artifact"]')
        .contentFrame()
        .getByRole("heading", { name: "Shared workspace report" }),
    ).toBeVisible();
    await moneyShot(
      peer,
      "The second client discovered and rendered the artifact added by the first client.",
    );
    await peerTab.click({ button: "right" });
    await peer.getByTestId(`workspace-tab-context-artifact_${artifactId}-close`).click();
    await expect(peer.getByTestId(tabId)).toHaveCount(0);
    await peer.reload();
    await expect(
      peer
        .getByTestId("workspace-tabs-rail")
        .or(peer.getByTestId("workspace-tabs-row"))
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expect(peer.getByTestId(tabId)).toHaveCount(0);
    await expect(page.getByTestId(tabId).filter({ visible: true }).first()).toBeVisible();
  } finally {
    await peerContext?.close().catch(() => undefined);
    await workspace.cleanup();
  }
});
