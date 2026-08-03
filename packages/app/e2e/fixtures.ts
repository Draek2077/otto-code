import { test as base, expect, type Page } from "@playwright/test";
import { startOutdatedDaemon, type OutdatedDaemon } from "./helpers/daemon-update";
import { getE2EDaemonPort } from "./helpers/daemon-port";
import { sweepDanglingProjects } from "./helpers/dangling-projects";
import { EVIDENCE_SEPARATOR, MONEY_SHOT_PREFIX } from "./helpers/evidence";
import { buildCreateAgentPreferences, buildSeededHost } from "./helpers/daemon-registry";
import {
  createProjectPickerFixture,
  removeProjectPickerFixture,
  type ProjectPickerFixture,
} from "./helpers/project-picker-fixture";
import { connectSeedClient } from "./helpers/seed-client";
import { createWithWorkspace, type WithWorkspace } from "./helpers/with-workspace";

const EXTRA_HOSTS_KEY = "@otto:e2e-extra-hosts";

interface TrackedProjectPickerFixture extends ProjectPickerFixture {
  rememberProjectId: (projectId: string) => void;
}

// Test setup is wired through an `auto: true` fixture rather than `test.beforeEach`.
// `test.beforeEach` declared at the top level of a non-test fixture file is unreliable
// across spec-file boundaries — Playwright sometimes skips it for the first test of a
// subsequent spec when multiple specs run in the same worker. Auto fixtures run
// reliably for every test that uses this `test` object.
const test = base.extend<{
  ottoE2ESetup: void;
  danglingProjectSweep: void;
  outdatedDaemon: OutdatedDaemon;
  desktopManagedOutdatedDaemon: OutdatedDaemon;
  projectPickerFixture: TrackedProjectPickerFixture;
  withWorkspace: WithWorkspace;
  /**
   * Seed `hasCompletedSetupWizard: true` so the first-run wizard can never
   * intercept a spec that just wants the app.
   *
   * A fresh browser context has no settings blob, so the app writes the
   * fresh-install defaults with the flag `false`, and the index route redirects
   * "/" -> "/setup" when a host is online at decision time. Specs used to pass
   * only because they won a race: "/" usually resolved before the seeded host's
   * WebSocket finished connecting, so the gate saw no host and fell through. On
   * a loaded CI runner that race flips and every spec that touches the app shell
   * dies on a "Welcome to Otto" screen — which reads as a broken sidebar or a
   * missing locator, not as the wizard.
   *
   * Opt out with `test.use({ seedSetupWizardComplete: false })` when the wizard
   * itself is the subject.
   */
  seedSetupWizardComplete: boolean;
}>({
  seedSetupWizardComplete: [true, { option: true }],
  baseURL: async ({}, provide) => {
    const metroPort = process.env.E2E_METRO_PORT;
    if (!metroPort) {
      throw new Error("E2E_METRO_PORT not set - globalSetup must run first");
    }
    await provide(`http://localhost:${metroPort}`);
  },
  ottoE2ESetup: [
    async ({ page, seedSetupWizardComplete }, provide, testInfo) => {
      const daemonPort = getE2EDaemonPort();
      const metroPort = process.env.E2E_METRO_PORT;
      if (!metroPort) {
        throw new Error(
          "E2E_METRO_PORT is not set. Ensure Playwright `globalSetup` starts Metro and exports E2E_METRO_PORT.",
        );
      }

      // Hard guardrail: never allow tests to hit the developer's default daemon.
      // This blocks both HTTP and WS attempts to :6868 (before any navigation).
      await page.route(/:(6868)\b/, (route) => route.abort());
      await page.routeWebSocket(/:(6868)\b/, async (ws) => {
        await ws.close({ code: 1008, reason: "Blocked connection to localhost:6868 during e2e." });
      });

      const entries: string[] = [];

      page.on("console", (message) => {
        entries.push(`[console:${message.type()}] ${message.text()}`);
      });

      page.on("pageerror", (error) => {
        entries.push(`[pageerror] ${error.message}`);
      });

      const nowIso = new Date().toISOString();
      const seedNonce = Math.random().toString(36).slice(2);
      const serverId = process.env.E2E_SERVER_ID;
      if (!serverId) {
        throw new Error("E2E_SERVER_ID is not set - expected from Playwright globalSetup.");
      }
      const testDaemon = buildSeededHost({
        serverId,
        endpoint: `127.0.0.1:${daemonPort}`,
        nowIso,
      });
      const createAgentPreferences = buildCreateAgentPreferences(testDaemon.serverId);

      await page.addInitScript(
        ({ daemon, preferences, seedNonce: nonce, extraHostsKey, seedWizardComplete }) => {
          // `addInitScript` runs on every navigation (including reloads). Some tests intentionally
          // override storage and reload; they can opt out of seeding for the *next* navigation by
          // setting this flag before the reload.
          const disableOnceKey = "@otto:e2e-disable-default-seed-once";
          const disableValue = localStorage.getItem(disableOnceKey);
          if (disableValue) {
            localStorage.removeItem(disableOnceKey);
            if (disableValue === nonce) {
              return;
            }
          }

          localStorage.setItem("@otto:e2e", "1");
          localStorage.setItem("@otto:e2e-seed-nonce", nonce);

          const rawExtraHosts = localStorage.getItem(extraHostsKey);
          const extraHosts = rawExtraHosts ? JSON.parse(rawExtraHosts) : [];

          // Hard-reset anything that could point to a developer's real daemon.
          localStorage.setItem("@otto:daemon-registry", JSON.stringify([daemon, ...extraHosts]));
          localStorage.removeItem("@otto:settings");
          localStorage.setItem("@otto:create-agent-preferences", JSON.stringify(preferences));

          // Merged, never replaced: a spec may have seeded its own appearance
          // preferences, and clobbering the blob here would drop them.
          if (seedWizardComplete) {
            const settingsKey = "@otto:app-settings";
            let settings: Record<string, unknown> = {};
            try {
              const raw = localStorage.getItem(settingsKey);
              if (raw) {
                settings = JSON.parse(raw) as Record<string, unknown>;
              }
            } catch {
              settings = {};
            }
            settings.hasCompletedSetupWizard = true;
            localStorage.setItem(settingsKey, JSON.stringify(settings));
          }
        },
        {
          daemon: testDaemon,
          preferences: createAgentPreferences,
          seedNonce,
          extraHostsKey: EXTRA_HOSTS_KEY,
          seedWizardComplete: seedSetupWizardComplete,
        },
      );

      await provide();

      // The console log is evidence for passing runs too — the QA report keeps
      // it beside each test so a human can audit a green result, not just a red
      // one. (It used to attach only on failure.)
      if (entries.length > 0) {
        await testInfo.attach("browser-console", {
          body: entries.join("\n"),
          contentType: "text/plain",
        });
      }

      // Fallback money shot: every passing test ships visual proof even if it
      // never called `moneyShot()` itself. An explicit call always wins — this
      // frame is captured at teardown, which is often past the interesting
      // state. See helpers/evidence.ts.
      const hasExplicitMoneyShot = testInfo.attachments.some((attachment) =>
        attachment.name.startsWith(MONEY_SHOT_PREFIX),
      );
      if (testInfo.status === testInfo.expectedStatus && !hasExplicitMoneyShot) {
        try {
          await testInfo.attach(`${MONEY_SHOT_PREFIX}${EVIDENCE_SEPARATOR}final frame (auto)`, {
            body: await page.screenshot(),
            contentType: "image/png",
          });
        } catch {
          // Page already closed by the test — nothing to prove, nothing to fail.
        }
      }
    },
    { auto: true },
  ],
  // Runs last, after the spec's own `afterEach`, so a spec that tears its
  // records down properly leaves nothing to find. See helpers/dangling-projects.ts
  // for why one leaked project can take out the rest of a shard. The annotation
  // names the offender in the report instead of silently patching over it.
  //
  // `OTTO_E2E_SKIP_PROJECT_SWEEP=1` turns it off, which is the control run when
  // you suspect the sweep itself of removing state a spec still needed.
  danglingProjectSweep: [
    async ({}, provide, testInfo) => {
      await provide();
      if (process.env.OTTO_E2E_SKIP_PROJECT_SWEEP === "1") {
        return;
      }
      try {
        const removed = await sweepDanglingProjects();
        if (removed.length > 0) {
          testInfo.annotations.push({
            type: "leaked-projects",
            description: `Removed daemon projects whose directory was already deleted: ${removed.join(", ")}. Remove the project record before deleting the directory.`,
          });
        }
      } catch {
        // The sweep is a safety net, never a source of failures: a daemon that
        // is down or restarting mid-teardown must not turn a passing test red.
      }
    },
    { auto: true },
  ],
  outdatedDaemon: async ({}, provide) => {
    const daemon = await startOutdatedDaemon();
    await provide(daemon);
    await daemon.close();
  },
  desktopManagedOutdatedDaemon: async ({}, provide) => {
    const daemon = await startOutdatedDaemon({ desktopManaged: true });
    await provide(daemon);
    await daemon.close();
  },
  projectPickerFixture: async ({}, provide) => {
    const resource = await createProjectPickerFixture();
    const { fixture } = resource;
    let projectId: string | null = null;
    try {
      await provide({
        ...fixture,
        rememberProjectId: (openedProjectId) => {
          projectId = openedProjectId;
        },
      });
    } finally {
      try {
        const client = await connectSeedClient();
        try {
          await removeProjectPickerFixture(client, fixture, projectId);
        } finally {
          await client.close();
        }
      } finally {
        await resource.removeDirectory();
      }
    }
  },
  withWorkspace: async ({ page }, provide) => {
    const handle = createWithWorkspace(page);
    await provide(handle.withWorkspace);
    await handle.cleanup();
  },
});

export { test, expect, type Page };
