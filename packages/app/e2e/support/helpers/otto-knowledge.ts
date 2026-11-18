import type { Locator, Page } from "@playwright/test";
import { callAgentMcp } from "./agent-mcp";
import { gotoAppShell } from "./app";
import { getServerId } from "./server-id";
import { openWorkspaceContextMenu } from "./sidebar";
import { waitForOttoSurface } from "./otto-surfaces";

export async function callKnowledgeMcp(name: string, args: Record<string, unknown>) {
  return callAgentMcp(name, args, "json");
}

export async function openWorkspaceKnowledge(input: {
  page: Page;
  workspaceId: string;
  compact: boolean;
}) {
  await gotoAppShell(input.page);
  if (input.compact) {
    await input.page.getByRole("button", { name: "Open menu", exact: true }).first().click();
    await input.page
      .getByTestId(`sidebar-workspace-kebab-${getServerId()}:${input.workspaceId}`)
      .click();
  } else await openWorkspaceContextMenu(input.page, input.workspaceId);
  await input.page.getByText("Open Knowledge", { exact: true }).click();
  return waitForOttoSurface(input.page, "otto-knowledge-page");
}

export async function openKnowledgeMaintenance(surface: Locator) {
  const toggle = surface.getByRole("button", { name: "Storage and maintenance", exact: true });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}
