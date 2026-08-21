import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";
import { createMockUnattendedSchedule, runScheduleOnce } from "../support/helpers/unattended";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

// Safe unattended runs (docs/safe-unattended.md): `unattended: true` is not a
// create_agent wire field - the only deterministic path to an unattended agent
// is an owning daemon service. Schedule runs create their agent
// `unattended: true` + `internal: true` in a HIDDEN workspace
// (packages/server/src/server/schedule/service.ts), so these specs drive a
// mock-provider schedule via `schedule/run-once` and observe the outcomes the
// architecture promises:
//   - the deny-responder (agent-manager onStreamPermissionRequested) answers a
//     gated tool immediately with deny, so the run completes instead of
//     stalling, silently (no prompt, no revealed workspace, no listed agent);
//   - promotion is gated on CONTENT: a run that fails before producing any
//     transcript archives its hidden workspace rather than leaving an empty
//     shell in the sidebar (docs/safe-unattended.md calls this
//     "promote-on-error-with-content", and names "personality unavailable" as
//     the archive case). The reveal half of that branch has no deterministic
//     mock trigger yet - the mock provider cannot stream content and then fail
//     - so it is covered structurally by the kept-success reveal in
//     schedule-hidden-runs-promote.spec.ts, which exercises the same
//     revealWorkspace path.
const TOOL_PERMISSION_PROMPT = "Emit synthetic tool permission.";

function sidebarWorkspaceRowTestId(workspaceId: string): string {
  return `sidebar-workspace-row-${getServerId()}:${workspaceId}`;
}

test.describe("Safe unattended deny responder", () => {
  test("auto-denies a gated tool so the run completes silently", async ({ page }) => {
    test.setTimeout(180_000);

    const workspace = await seedWorkspace({ repoPrefix: "unattended-deny-" });
    let deleteSchedule: (() => Promise<void>) | null = null;
    try {
      const schedule = await createMockUnattendedSchedule(workspace, {
        name: `Unattended deny ${Date.now()}`,
        prompt: TOOL_PERMISSION_PROMPT,
        archiveOnFinish: true,
      });
      deleteSchedule = schedule.cleanup;

      // The mock turn only completes after its pending tool permission is
      // answered - a succeeded run IS the proof the deny-responder answered
      // (an unanswered prompt fails the run with "waiting for permission").
      const run = await runScheduleOnce(workspace, schedule.scheduleId);
      expect(run.status).toBe("succeeded");
      // The mock surfaces the denial (behavior "deny", not a silent allow) in
      // its final output.
      expect(run.output ?? "").toContain("Synthetic tool denied");

      // Routine denials are silent: the internal agent is never listed.
      expect(run.agentId).not.toBeNull();
      const agents = await workspace.client.fetchAgents({ scope: "active" });
      expect(agents.entries.map((entry) => entry.agent.id)).not.toContain(run.agentId);

      // Clean run: the hidden run workspace was archived, never revealed. Only
      // the seeded workspace remains client-visible.
      expect(run.workspaceId ?? null).not.toBeNull();
      const workspaces = await workspace.client.fetchWorkspaces({
        filter: { projectId: workspace.projectId },
      });
      expect(workspaces.entries.map((entry) => entry.id)).toEqual([workspace.workspaceId]);

      // And nothing surfaces in the UI: no hidden-run sidebar row, no hanging
      // permission prompt anywhere.
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await expect(page.getByTestId(sidebarWorkspaceRowTestId(workspace.workspaceId))).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId(sidebarWorkspaceRowTestId(run.workspaceId ?? ""))).toHaveCount(
        0,
      );
      await expect(page.getByTestId("permission-request-question")).toHaveCount(0);
    } finally {
      await deleteSchedule?.();
      await workspace.cleanup();
    }
  });

  test("archives the hidden run workspace when the run fails without producing content", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const workspace = await seedWorkspace({ repoPrefix: "unattended-promote-" });
    let deleteSchedule: (() => Promise<void>) | null = null;
    try {
      const missingPersonality = `e2e-missing-personality-${Date.now()}`;
      const schedule = await createMockUnattendedSchedule(workspace, {
        name: `Unattended promote ${Date.now()}`,
        prompt: TOOL_PERMISSION_PROMPT,
        archiveOnFinish: true,
        // A personality binding that cannot resolve fails the run AFTER the
        // hidden run workspace exists (resolveSchedulePersonalityBrain) but
        // BEFORE the agent produces anything - the canonical content-less
        // failure, which archives rather than promotes.
        personality: missingPersonality,
      });
      deleteSchedule = schedule.cleanup;

      const run = await runScheduleOnce(workspace, schedule.scheduleId);
      expect(run.status).toBe("failed");
      expect(run.error ?? "").toContain(`Personality "${missingPersonality}" not found`);

      // The run produced nothing, so its hidden workspace is archived: it never
      // reaches the client-visible surface the sidebar reads.
      const runWorkspaceId = run.workspaceId ?? null;
      expect(runWorkspaceId).not.toBeNull();
      const workspaces = await workspace.client.fetchWorkspaces({
        filter: { projectId: workspace.projectId },
      });
      expect(workspaces.entries.map((entry) => entry.id)).toEqual([workspace.workspaceId]);

      // And no empty-shell row appears in the sidebar.
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await expect(page.getByTestId(sidebarWorkspaceRowTestId(workspace.workspaceId))).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId(sidebarWorkspaceRowTestId(runWorkspaceId ?? ""))).toHaveCount(
        0,
      );
    } finally {
      await deleteSchedule?.();
      await workspace.cleanup();
    }
  });
});
