import { createServer } from "node:http";
import { once } from "node:events";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { settingsRpc } from "@getpaseo/plugin";
import { test as base, expect, type Page } from "../fixtures";
import { connectDaemonClient } from "./daemon-client-loader";
import { gotoAppShell, openSettings } from "./app";

import {
  providerSettings,
  type ConnectionSettings,
} from "../../../../../plugins/otto-openai-compatible-provider/shared/settings.js";
import {
  credentialSave,
  credentialStatus,
} from "../../../../../plugins/otto-openai-compatible-provider/shared/credentials.js";

const pluginId = "otto-openai-compatible-provider";
const rpc = settingsRpc("connection");
type SettingsClient = Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">;

async function createProviderFixture() {
  const server = createServer((request, response) => {
    if (request.method === "GET") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "fixture" }] }));
    } else {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Done." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing endpoint");
  const client = await connectDaemonClient<SettingsClient>({
    clientIdPrefix: "otto-provider-settings",
  });
  const read = async () => {
    const state = rpc.read.output.parse(await client.invokePluginRpc(pluginId, rpc.read.name, {}));
    if (state.status !== "ready") throw Error(state.error);
    return { revision: state.revision, values: providerSettings.schema.parse(state.values) };
  };
  const initial = await read();
  const replace = async (values: ConnectionSettings) => {
    const state = await read();
    const result = rpc.write.output.parse(
      await client.invokePluginRpc(pluginId, rpc.write.name, { revision: state.revision, values }),
    );
    if (result.status !== "saved") throw Error(result.error);
  };
  const url = `http://127.0.0.1:${address.port}/v1`;
  await replace({ ...initial.values, baseUrl: url, model: "fixture", endpoints: [] });
  const target = async (profileId: string) => {
    const state = await read();
    const baseUrl =
      profileId === "primary"
        ? state.values.baseUrl
        : state.values.endpoints?.find((profile) => profile.id === profileId)?.baseUrl;
    if (!baseUrl) throw Error("Missing endpoint profile");
    return { profileId, baseUrl, settingsRevision: state.revision };
  };
  const saveKey = async (profileId: string, key: string | null) => {
    const binding = await target(profileId);
    const status = credentialStatus.output.parse(
      await client.invokePluginRpc(pluginId, credentialStatus.name, binding),
    );
    return client.invokePluginRpc(pluginId, credentialSave.name, {
      ...binding,
      revision: status.revision,
      key,
    });
  };
  return {
    url,
    read,
    saveKey,
    update: async (updates: Partial<ConnectionSettings>) =>
      replace({ ...(await read()).values, ...updates }),
    close: async () => {
      try {
        const state = await read();
        for (const profile of [
          { id: "primary", baseUrl: state.values.baseUrl },
          ...(state.values.endpoints ?? []),
        ]) {
          if (profile.baseUrl) await saveKey(profile.id, null);
        }
        await replace(initial.values);
      } finally {
        await client.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  };
}

export const test = base.extend<{
  ottoProvider: Awaited<ReturnType<typeof createProviderFixture>>;
}>({
  ottoProvider: async ({ e2eWorker }, provide) => {
    void e2eWorker;
    const fixture = await createProviderFixture();
    try {
      await provide(fixture);
    } finally {
      await fixture.close();
    }
  },
});
export { expect };

async function openHostSettings(page: Page, compact: boolean) {
  await gotoAppShell(page);
  if (compact) {
    await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
    await page.getByTestId("sidebar-settings").click();
    await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  } else await openSettings(page);
}

export async function openOttoProviderDetails(page: Page, compact = false) {
  await openHostSettings(page, compact);
  await page.getByTestId("settings-host-section-providers").click();
  await page
    .getByRole("button", { name: "OpenAI-compatible provider details", exact: true })
    .click();
  await expect(page.getByTestId("provider-settings-sheet")).toBeVisible();
}

export async function openOttoProviderSettings(page: Page, compact = false) {
  await openHostSettings(page, compact);
  await page.getByTestId("settings-host-section-plugins").click();
  await page.getByRole("button", { name: "Configure Otto provider", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "API base URL", exact: true })).toBeVisible();
}
