import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { getE2EDaemonPort } from "./daemon-port";
import { gotoAppShell } from "./app";
import { getServerId } from "./server-id";
import { openWorkspaceContextMenu } from "./sidebar";

export async function callKnowledgeMcp(name: string, args: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:${getE2EDaemonPort()}/mcp/agents`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!response.ok) throw new Error(`Isolated Knowledge MCP request failed: ${response.status}`);
  const text = await response.text();
  const event = text.split("\n").find((line) => line.startsWith("data:"));
  const envelope = z
    .object({
      result: z.object({
        structuredContent: z.unknown(),
        content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
      }),
    })
    .parse(JSON.parse(event ? event.slice(5).trim() : text));
  expect(envelope.result.content).toHaveLength(1);
  expect(JSON.parse(envelope.result.content[0].text)).toEqual(envelope.result.structuredContent);
  return envelope.result.structuredContent;
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
  await input.page.getByText("Open Project Knowledge", { exact: true }).click();
  const surface = input.page.getByTestId("otto-knowledge-page").filter({ visible: true });
  await expect(surface).toBeVisible();
  return surface;
}
