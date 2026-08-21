import { randomUUID } from "node:crypto";
import { metroTest as test } from "../support/fixtures";
import { expectSessionsEmptyState, openSessions } from "../support/helpers/archive-tab";
import { gotoAppShell } from "../support/helpers/app";
import { buildCreateAgentPreferences, buildSeededHost } from "../support/helpers/daemon-registry";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { moneyShot } from "../support/helpers/evidence";
import { seedWorkspace } from "../support/helpers/seed-client";

// This spec pays a cold start no other spec does: it boots its own isolated
// daemon on top of the first Metro serve and the app's first hydration. Locally
// that is ~30-35s while warm specs finish in under 10s, and on a loaded CI
// runner it tips past the default 60s budget and times out mid-body. Give it
// headroom rather than letting an environment cost read as a product failure.
test.setTimeout(120_000);

test("Sessions shows an empty placeholder when the host has no history", async ({ page }) => {
  const serverId = `srv_sessions_empty_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const daemon = await startIsolatedHostDaemon(serverId);
  let workspace: Awaited<ReturnType<typeof seedWorkspace>> | null = null;

  try {
    workspace = await seedWorkspace({
      repoPrefix: "sessions-empty-",
      port: daemon.port,
    });
    const host = buildSeededHost({
      serverId,
      endpoint: `127.0.0.1:${daemon.port}`,
      nowIso: new Date().toISOString(),
    });
    await page.route(/:6868\b/, (route) => route.abort());
    await page.routeWebSocket(/:6868\b/, async (webSocket) => {
      await webSocket.close({ code: 1008, reason: "Blocked developer daemon during e2e." });
    });
    await page.addInitScript(
      ({ seededHost, preferences }) => {
        localStorage.setItem("@otto:e2e", "1");
        localStorage.setItem("@otto:daemon-registry", JSON.stringify([seededHost]));
        localStorage.setItem("@otto:create-agent-preferences", JSON.stringify(preferences));
      },
      { seededHost: host, preferences: buildCreateAgentPreferences() },
    );

    await gotoAppShell(page);
    await openSessions(page);
    await expectSessionsEmptyState(page);
    await moneyShot(page, "Sessions shows the empty placeholder, not a session list");
  } finally {
    await workspace?.cleanup();
    await daemon.close();
  }
});
