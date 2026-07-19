import type { SeededWorkspace } from "./seed-client";

/**
 * Schedule RPC surface the safe-unattended specs drive out of band. The seed
 * client is the real DaemonClient, so these methods exist at runtime; the cast
 * mirrors how schedules-project-target.spec.ts types its schedule calls.
 */
export interface ScheduleRunRecord {
  id: string;
  status: "running" | "succeeded" | "failed";
  agentId: string | null;
  workspaceId?: string | null;
  output: string | null;
  error: string | null;
}

export interface StoredScheduleRecord {
  id: string;
  name: string | null;
  lastRunStatus?: "succeeded" | "failed" | null;
  runs: ScheduleRunRecord[];
}

interface UnattendedScheduleClient {
  scheduleCreate(options: {
    prompt: string;
    name?: string;
    cadence: { type: "every"; everyMs: number };
    target: {
      type: "new-agent";
      config: {
        provider: string;
        cwd: string;
        model?: string;
        modeId?: string;
        personality?: string;
        archiveOnFinish?: boolean;
        isolation?: "local" | "worktree";
      };
    };
  }): Promise<{ schedule: { id: string } | null; error: string | null }>;
  scheduleRunOnce(options: {
    id: string;
  }): Promise<{ schedule: StoredScheduleRecord | null; error: string | null }>;
  scheduleDelete(options: { id: string }): Promise<{ error: string | null }>;
}

function scheduleClient(workspace: SeededWorkspace): UnattendedScheduleClient {
  return workspace.client as unknown as UnattendedScheduleClient;
}

// A cadence that never fires on its own during a test run — manual run-once
// does not advance it (finishRun's `manual` branch), so the schedule only ever
// runs when the spec says so.
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface CreatedMockSchedule {
  scheduleId: string;
  cleanup(): Promise<void>;
}

/**
 * Creates a mock-provider new-agent schedule in the seeded workspace's repo.
 * Schedule runs are always unattended (`unattended: true` + internal agent in
 * packages/server/src/server/schedule/service.ts), which is the only wire-
 * reachable path to an unattended agent — `unattended` is not a create_agent
 * field. `personality` may name a nonexistent personality to force a failed
 * run deterministically (resolveSchedulePersonalityBrain throws after the
 * hidden run workspace exists, exercising promote-on-error).
 */
export async function createMockUnattendedSchedule(
  workspace: SeededWorkspace,
  options: { name: string; prompt: string; archiveOnFinish?: boolean; personality?: string },
): Promise<CreatedMockSchedule> {
  const client = scheduleClient(workspace);
  const created = await client.scheduleCreate({
    prompt: options.prompt,
    name: options.name,
    cadence: { type: "every", everyMs: ONE_YEAR_MS },
    target: {
      type: "new-agent",
      config: {
        provider: "mock",
        cwd: workspace.repoPath,
        model: "ten-second-stream",
        modeId: "load-test",
        isolation: "local",
        ...(options.archiveOnFinish !== undefined
          ? { archiveOnFinish: options.archiveOnFinish }
          : {}),
        ...(options.personality !== undefined ? { personality: options.personality } : {}),
      },
    },
  });
  if (!created.schedule) {
    throw new Error(created.error ?? `Failed to create schedule ${options.name}`);
  }
  const scheduleId = created.schedule.id;
  return {
    scheduleId,
    cleanup: async () => {
      await client.scheduleDelete({ id: scheduleId }).catch(() => undefined);
    },
  };
}

/**
 * Triggers a manual run and returns the settled run record. `schedule/run-once`
 * awaits the whole run daemon-side (ScheduleService.runOnce), so the returned
 * schedule already carries the finished run — no polling.
 */
export async function runScheduleOnce(
  workspace: SeededWorkspace,
  scheduleId: string,
): Promise<ScheduleRunRecord> {
  const result = await scheduleClient(workspace).scheduleRunOnce({ id: scheduleId });
  if (!result.schedule) {
    throw new Error(result.error ?? `schedule/run-once returned no schedule for ${scheduleId}`);
  }
  const run = result.schedule.runs.at(-1);
  if (!run) {
    throw new Error(`schedule ${scheduleId} has no runs after run-once`);
  }
  if (run.status === "running") {
    throw new Error(`schedule ${scheduleId} run ${run.id} still running after run-once resolved`);
  }
  return run;
}
