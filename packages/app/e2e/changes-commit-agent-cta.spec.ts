import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "./fixtures";
import { connectDaemonConfigClient, gitOutput, openWorkspaceScreen } from "./helpers/git-changes";
import { seedWorkspace } from "./helpers/seed-client";

// The workspace header's primary "Commit" CTA authors its message with an AI
// agent: before running, the client resolves the writer agent the host would
// use (checkout.git.commit_agent) and confirms it with the user. To keep the
// resolution deterministic regardless of which provider CLIs exist on the
// machine, this spec seeds a Writer-role Agent Personality bound to the
// dev-only mock provider — role-matched personalities are always resolved
// ahead of the configured/substring/current-selection fallback chain.
//
// The flow is asserted up to the confirm dialog and then cancelled: confirming
// would hand off to the writer agent as an *internal* generation session,
// which the daemon deliberately excludes from agent listings (fetchAgents
// filters `internal` agents), and a failed mock generation would fall through
// the provider chain to real providers on machines that have them.

interface CleanupTask {
  run: () => Promise<void>;
}

const cleanupTasks: CleanupTask[] = [];

const ALPHA_BEFORE = "export const alpha = 1;\n";
const ALPHA_AFTER = "export const alpha = 2;\n";
const WRITER_PERSONALITY_NAME = "E2E Mock Writer";

test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0)) {
    await task.run();
  }
});

test("commit CTA confirms the writer agent before an AI commit", async ({ page }) => {
  // Seed a Writer personality on the mock provider so the resolved agent is
  // stable, restoring the original roster afterwards.
  const configClient = await connectDaemonConfigClient();
  cleanupTasks.push({ run: () => configClient.close().catch(() => undefined) });
  const { config } = await configClient.getDaemonConfig();
  const originalPersonalities = config.agentPersonalities?.personalities ?? [];
  const writerPersonality = {
    id: `e2e-writer-mock-${Date.now()}`,
    name: WRITER_PERSONALITY_NAME,
    provider: "mock",
    model: "ten-second-stream",
    roles: ["writer"],
  };
  await configClient.patchDaemonConfig({
    agentPersonalities: { personalities: [...originalPersonalities, writerPersonality] },
  });
  cleanupTasks.push({
    run: async () => {
      await configClient
        .patchDaemonConfig({ agentPersonalities: { personalities: originalPersonalities } })
        .catch(() => undefined);
    },
  });

  const workspace = await seedWorkspace({
    repoPrefix: "commit-agent-cta-",
    repo: { files: [{ path: "src/alpha.ts", content: ALPHA_BEFORE }] },
  });
  cleanupTasks.push({ run: () => workspace.cleanup() });

  // Dirty the tree out of band so the primary CTA is "Commit", and make the
  // write authoritative before asserting in the UI.
  await writeFile(path.join(workspace.repoPath, "src/alpha.ts"), ALPHA_AFTER);
  await workspace.client.checkoutRefresh(workspace.repoPath);

  await openWorkspaceScreen(page, workspace.workspaceId);

  const cta = page.getByTestId("changes-primary-cta");
  await expect(cta).toBeVisible({ timeout: 30_000 });
  await expect(cta).toHaveAttribute("aria-label", "Commit");
  await cta.click();

  // The confirm step names the seeded writer personality.
  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText("Commit with AI");
  // The dialog names whichever writer the daemon roster ranks first — the
  // seeded mock writer or a built-in default personality on a fresh daemon.
  // Either way the confirm step names a personality that will author the
  // message; we assert the structural claim, not a specific roster winner.
  await expect(dialog).toContainText(/personality \(.+\)/);
  await expect(dialog).toContainText("will write your commit message");

  // Cancel instead of committing (see header comment for why).
  await page.getByTestId("confirm-dialog-cancel").click();
  await expect(dialog).toHaveCount(0);

  // Cancelling ran no commit: still only the fixture commit, and alpha.ts is
  // still an uncommitted change. (The Changes view stages selected files, so
  // the porcelain index column varies — assert the change persists, not its
  // exact staged/unstaged state.)
  expect(gitOutput(workspace.repoPath, ["rev-list", "--count", "HEAD"])).toBe("1");
  expect(gitOutput(workspace.repoPath, ["status", "--porcelain"])).toContain("src/alpha.ts");
});
