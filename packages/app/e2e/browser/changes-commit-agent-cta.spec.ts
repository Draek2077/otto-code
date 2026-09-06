import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "../support/fixtures";
import {
  connectDaemonConfigClient,
  gitOutput,
  openWorkspaceScreen,
} from "../support/helpers/git-changes";
import { seedWorkspace } from "../support/helpers/seed-client";

// The workspace header's primary "Commit" CTA authors its message with an AI
// agent: before running, the client resolves the writer agent the host would
// use (checkout.git.commit_agent) and confirms it with the user. To keep the
// resolution deterministic regardless of which provider CLIs exist on the
// machine, this spec seeds a Writer-role agent profile bound to the
// dev-only mock provider and enables profile preference.
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
const WRITER_PROFILE_NAME = "E2E Mock Writer";

test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0).toReversed()) {
    await task.run();
  }
});

test("commit CTA confirms the writer agent before an AI commit", async ({ page }) => {
  // Seed a Writer profile on the mock provider so the resolved agent is
  // stable, restoring the original roster afterwards.
  const configClient = await connectDaemonConfigClient();
  cleanupTasks.push({ run: () => configClient.close().catch(() => undefined) });
  const { config } = await configClient.getDaemonConfig();
  const originalProfiles = config.agentProfiles ?? [];
  const writerProfile = {
    id: `e2e-writer-mock-${Date.now()}`,
    name: WRITER_PROFILE_NAME,
    provider: "mock",
    model: "ten-second-stream",
    roles: ["writer"],
  };
  // Prefer the seeded profile over the built-in cheap model ladder.
  await configClient.patchDaemonConfig({
    agentProfiles: [...originalProfiles, writerProfile],
    metadataGeneration: { preferWriterPersonalities: true },
  });
  cleanupTasks.push({
    run: async () => {
      await configClient
        .patchDaemonConfig({
          agentProfiles: originalProfiles,
          metadataGeneration: config.metadataGeneration,
        })
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

  // The confirm step names the seeded writer profile.
  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText("Commit with AI");
  await expect(dialog).toContainText(`${WRITER_PROFILE_NAME} profile`);
  await expect(dialog).toContainText("will write your commit message");

  // Cancel instead of committing (see header comment for why).
  await page.getByTestId("confirm-dialog-cancel").click();
  await expect(dialog).toHaveCount(0);

  // Cancelling ran no commit: still only the fixture commit, and alpha.ts is
  // still an uncommitted change. (The Changes view stages selected files, so
  // the porcelain index column varies - assert the change persists, not its
  // exact staged/unstaged state.)
  expect(gitOutput(workspace.repoPath, ["rev-list", "--count", "HEAD"])).toBe("1");
  expect(gitOutput(workspace.repoPath, ["status", "--porcelain"])).toContain("src/alpha.ts");
});
