/** Isolated E2E daemon settings only; never starts a Brain host or model. */
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  BrainBootstrapSchema,
  BrainConnectionReadSchema,
  BrainOperationResultSchema,
} from "@getpaseo/protocol/otto/brain";
import { test as base, expect, type Page } from "../fixtures";
import { connectDaemonClient } from "./daemon-client-loader";
import { gotoAppShell, openSettings } from "./app";

type Client = Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">;
async function request(client: Client, method: string, input: unknown) {
  const response = BrainOperationResultSchema.parse(
    await client.invokePluginRpc("otto-brain", method, input),
  );
  if (!response.ok) throw new Error(response.error.message);
  return response.value;
}

export const test = base.extend<{ brain: { localRunning(): Promise<boolean> } }>({
  brain: async ({ e2eWorker }, provide) => {
    void e2eWorker;
    const client = await connectDaemonClient<Client>({ clientIdPrefix: "otto-brain-ui" });
    const read = async () =>
      BrainConnectionReadSchema.parse(await request(client, "brain.connection.read", {}));
    const original = await read();
    try {
      await request(client, "brain.connection.save", {
        expectedRevision: original.revision,
        patch: { enabled: false, autoStart: false, mode: "local" },
        credential: { action: "keep" },
      });
      await provide({
        localRunning: async () =>
          BrainBootstrapSchema.parse(await request(client, "brain.bootstrap", {})).localRunning,
      });
    } finally {
      try {
        await request(client, "brain.connection.save", {
          expectedRevision: (await read()).revision,
          patch: original.config,
          credential: { action: "keep" },
        });
      } finally {
        await client.close();
      }
    }
  },
});
export { expect };

export async function openBrainSettings(page: Page, compact: boolean) {
  await gotoAppShell(page);
  if (compact) {
    await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
    await page.locator('[data-testid="sidebar-settings"]:visible').first().click();
  } else await openSettings(page);
  await page.getByTestId("settings-host-section-plugins").click();
  await page.getByRole("button", { name: "Configure Brain", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Enable Brain", exact: true })).toBeVisible();
}
