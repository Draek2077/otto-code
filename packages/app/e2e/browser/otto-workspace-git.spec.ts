// OTTO(git-fetch): real host/RPC/UI and file-origin Git, without credentials or provider runs.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { test, expect } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { addConnectedHostAndReload } from "../support/helpers/hosts";
import { selectSettingsHost } from "../support/helpers/settings";
import { openCommandCenter } from "../support/helpers/command-center";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { seedWorkspace } from "../support/helpers/seed-client";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";
import { readGitFetchPolicy, saveGitFetchPolicy } from "@getpaseo/plugin/otto/workspace-git";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

for (const compact of [false, true]) {
  test(`Git fetch settings, conflict recovery and manual file-origin fetch (${compact ? "compact" : "wide"})`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(30_000);
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const host = await startIsolatedHostDaemon(`otto_git_fetch_${compact ? "compact" : "wide"}`);
    const client = await connectDaemonClient<
      Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">
    >({ clientIdPrefix: "git-fetch", port: host.port });
    const read = async () => {
      const result = readGitFetchPolicy.output.parse(
        await client.invokePluginRpc("otto-workspace-git", readGitFetchPolicy.name, {
          hostId: host.serverId,
        }),
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    };
    try {
      const initial = await read();
      const disabled = saveGitFetchPolicy.output.parse(
        await client.invokePluginRpc("otto-workspace-git", saveGitFetchPolicy.name, {
          hostId: host.serverId,
          expectedRevision: initial.revision,
          patch: { enabled: false },
        }),
      );
      expect(disabled.ok).toBe(true);
      const workspace = await seedWorkspace({
        port: host.port,
        repoPrefix: "otto-fetch-ui-",
        repo: { withRemote: true },
      });
      try {
        const git = (...args: string[]) =>
          execFileSync("git", args, {
            cwd: workspace.repoPath,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 15_000,
          }).trim();
        const origin = path.join(workspace.repoPath, "remote.git");
        await gotoAppShell(page);
        await addConnectedHostAndReload(page, {
          serverId: host.serverId,
          label: "Git fetch fixture",
          port: host.port,
        });
        if (compact) {
          await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
          await page.locator('[data-testid="sidebar-settings"]:visible').first().click();
        } else await openSettings(page);
        await selectSettingsHost(page, host.serverId);
        await page.getByTestId("settings-host-section-workspaces").click();
        const card = page.getByTestId("otto-git-fetch-settings");
        const automatic = card.getByRole("switch", { name: "Automatic Git fetch", exact: true });
        await expect(automatic).not.toBeChecked();
        await automatic.click();
        await card.getByRole("button", { name: "Save", exact: true }).click();
        await expect(card).toContainText("Git fetch settings saved.");
        expect((await read()).preferences.enabled).toBe(true);
        await automatic.click();
        await card.getByRole("button", { name: "Save", exact: true }).click();
        await expect(automatic).toBeEnabled();
        expect((await read()).preferences.enabled).toBe(false);

        await automatic.click();
        const peer = await read();
        const changed = saveGitFetchPolicy.output.parse(
          await client.invokePluginRpc("otto-workspace-git", saveGitFetchPolicy.name, {
            hostId: host.serverId,
            expectedRevision: peer.revision,
            patch: { intervalSeconds: 900 },
          }),
        );
        expect(changed.ok).toBe(true);
        await card.getByRole("button", { name: "Save", exact: true }).click();
        await expect(card).toContainText("Git fetch settings changed. Reload before saving.");
        await expect(automatic).toBeChecked();
        await expect(card.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
        page.once("dialog", (dialog) => dialog.accept());
        await card.getByRole("button", { name: "Reload", exact: true }).click();
        await expect(automatic).not.toBeChecked();
        await expect(
          card.getByRole("button", { name: "Fetch interval: 15 minutes", exact: true }),
        ).toBeVisible();
        await page.screenshot({ path: info.outputPath("git-fetch-settings.png") });

        const before = git("rev-parse", "origin/main");
        const next = git(
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          `--git-dir=${origin}`,
          "commit-tree",
          `${before}^{tree}`,
          "-p",
          before,
          "-m",
          "remote-only change",
        );
        git(`--git-dir=${origin}`, "update-ref", "refs/heads/main", next);
        expect(git("rev-parse", "origin/main")).toBe(before);
        // The shared fixture reseeds hosts on document navigation. Preserve this
        // disposable host for exactly the navigation into its real workspace.
        await page.evaluate(() => {
          const nonce = localStorage.getItem("@otto:e2e-seed-nonce");
          if (!nonce) throw new Error("The fixture host registry has no seed nonce.");
          localStorage.setItem("@otto:e2e-disable-default-seed-once", nonce);
        });
        await page.goto(buildHostWorkspaceRoute(host.serverId, workspace.workspaceId));
        const trigger = page
          .getByTestId("changes-overflow-menu")
          .or(page.getByTestId("changes-actions-menu-trigger"))
          .filter({ visible: true })
          .first();
        await trigger.click();
        const fetch = page.getByTestId("changes-menu-fetch").filter({ visible: true });
        await expect(fetch).toBeVisible();
        await fetch.click();
        await expect.poll(() => git("rev-parse", "origin/main")).toBe(next);
        await expect(fetch).toContainText("Fetched");
        expect((await read()).preferences.enabled).toBe(false);

        git("remote", "set-url", "origin", path.join(workspace.repoPath, "missing-origin.git"));
        await fetch.click();
        await expect(fetch).toContainText("Fetch failed; try again");
        await page.screenshot({ path: info.outputPath("git-fetch-error.png") });
        git("remote", "set-url", "origin", origin);
        await fetch.click();
        await expect(fetch).toContainText("Fetched");
        const commandNext = git(
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          `--git-dir=${origin}`,
          "commit-tree",
          `${next}^{tree}`,
          "-p",
          next,
          "-m",
          "command-center remote change",
        );
        git(`--git-dir=${origin}`, "update-ref", "refs/heads/main", commandNext);
        await page.keyboard.press("Escape");
        if (compact)
          await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
        const palette = await openCommandCenter(page);
        await palette.getByTestId("command-center-input").fill("fetch");
        const command = palette.getByRole("button", { name: /^Fetch(?:\s|$)/ });
        await expect(command).toBeVisible();
        await command.click();
        await expect(palette).not.toBeVisible();
        await expect.poll(() => git("rev-parse", "origin/main")).toBe(commandNext);
      } finally {
        await workspace.cleanup();
      }
    } finally {
      await client.close();
      await host.close();
    }
  });
}
