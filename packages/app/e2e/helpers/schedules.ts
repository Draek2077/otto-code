import { expect, type Page } from "@playwright/test";
import { escapeRegex } from "./regex";
import type { SeedDaemonClient } from "./seed-client";

/**
 * Typed view over the daemon client's schedule RPC surface (schedule/create,
 * schedule/list, schedule/inspect, schedule/run-once, schedule/delete). The
 * seed client interface doesn't declare these, so schedule specs cast through
 * this — mirroring the inline interfaces in schedules-edit-model-hydration.spec
 * but shared, and including the run-once/inspect surface the run-lifecycle
 * specs need.
 */
export interface ScheduleRunRecord {
  id: string;
  status: "running" | "succeeded" | "failed";
  agentId: string | null;
  /** Workspace backing this run — recorded as soon as the run's hidden workspace is created. */
  workspaceId?: string | null;
  output: string | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface InspectedSchedule {
  id: string;
  name: string | null;
  lastRunStatus?: "succeeded" | "failed" | null;
  lastRunError?: string | null;
  runs: ScheduleRunRecord[];
}

export interface ScheduleSummaryRecord {
  id: string;
  name: string | null;
  cadence?:
    | { type: "cron"; expression: string; timezone?: string }
    | { type: "every"; everyMs: number };
  target: {
    type: string;
    config?: {
      provider?: string;
      cwd?: string;
      model?: string;
      modeId?: string;
      personality?: string;
      archiveOnFinish?: boolean;
      isolation?: "local" | "worktree";
    };
  };
}

export interface ScheduleCreateInput {
  prompt: string;
  name?: string;
  cadence:
    | { type: "cron"; expression: string; timezone?: string }
    | { type: "every"; everyMs: number };
  target: {
    type: "new-agent";
    config: {
      provider: string;
      cwd: string;
      personality?: string;
      modeId?: string;
      model?: string;
      archiveOnFinish?: boolean;
      isolation?: "local" | "worktree";
      title?: string | null;
    };
  };
  runOnCreate: boolean;
}

export interface ScheduleSeedClient {
  scheduleCreate(input: ScheduleCreateInput): Promise<{
    schedule: { id: string } | null;
    error: string | null;
  }>;
  scheduleList(): Promise<{ schedules: ScheduleSummaryRecord[]; error: string | null }>;
  scheduleInspect(input: { id: string }): Promise<{
    schedule: InspectedSchedule | null;
    error: string | null;
  }>;
  /**
   * Fires the schedule immediately and resolves only after the run settles
   * (ScheduleService.runOnce awaits runSchedule), so the returned schedule
   * already carries the finished run.
   */
  scheduleRunOnce(input: { id: string }): Promise<{
    schedule: InspectedSchedule | null;
    error: string | null;
  }>;
  scheduleDelete(input: { id: string }): Promise<{ error: string | null }>;
}

export function asScheduleSeedClient(client: SeedDaemonClient): ScheduleSeedClient {
  return client as unknown as ScheduleSeedClient;
}

/** Create a schedule via the daemon, throwing on rejection, returning its id. */
export async function createSchedule(
  client: ScheduleSeedClient,
  input: ScheduleCreateInput,
): Promise<string> {
  const result = await client.scheduleCreate(input);
  if (!result.schedule) {
    throw new Error(result.error ?? "schedule/create returned no schedule");
  }
  return result.schedule.id;
}

/** Idempotent cleanup delete: swallow "already gone" failures. */
export async function deleteScheduleById(client: ScheduleSeedClient, id: string): Promise<void> {
  await client.scheduleDelete({ id }).catch(() => undefined);
}

/** Idempotent cleanup delete by name (for schedules created through the UI). */
export async function deleteScheduleByName(
  client: ScheduleSeedClient,
  name: string,
): Promise<void> {
  const list = await client.scheduleList().catch(() => null);
  const schedule = list?.schedules.find((candidate) => candidate.name === name);
  if (schedule) {
    await deleteScheduleById(client, schedule.id);
  }
}

/** The most recent run on an inspected schedule (runs are stored append-order). */
export function latestRun(schedule: InspectedSchedule): ScheduleRunRecord {
  const run = schedule.runs.at(-1);
  if (!run) {
    throw new Error(`Schedule ${schedule.id} has no runs`);
  }
  return run;
}

/**
 * Pick a model by its display label inside the schedule form's combined model
 * picker (same widget flow as schedules-project-target.spec.ts).
 */
export async function selectScheduleModelByLabel(
  page: Page,
  providerGroupLabel: string,
  modelLabel: string,
): Promise<void> {
  await page.getByRole("button", { name: /select model/i }).click();
  const popup = page.getByTestId("combobox-desktop-container");
  await expect(popup).toBeVisible({ timeout: 30_000 });
  // The combined "Agent Personality or Model" picker opens to personality +
  // provider groups; the model search input only exists inside a provider view,
  // so drill into the provider group first, then search and pick the model.
  await popup
    .getByText(new RegExp(`^${escapeRegex(providerGroupLabel)}$`, "i"))
    .first()
    .click();
  const searchInput = page.getByTestId("model-search-input").first();
  await expect(searchInput).toBeVisible({ timeout: 30_000 });
  await searchInput.fill(modelLabel);
  const option = popup.getByText(new RegExp(`^${escapeRegex(modelLabel)}$`, "i")).first();
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();
  await expect(popup).toHaveCount(0, { timeout: 30_000 });
}
