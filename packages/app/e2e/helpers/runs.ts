import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SeedDaemonClient } from "./seed-client";

/**
 * Deterministic seeding for orchestration Runs. There is no client RPC that
 * creates a run (runs are born from the conductor-only `start_run` tool), but
 * the daemon persists each run as `$OTTO_HOME/runs/{runId}.json` and the
 * RunService reloads that directory on startup (see
 * packages/server/src/server/orchestration/run-store.ts / run-service.ts
 * `init`). Specs therefore write a terminal run file into the isolated E2E
 * home and bounce the daemon with helpers/daemon-restart.ts to make it live.
 *
 * Only terminal statuses ("done" / "failed" / "canceled") survive a restart
 * unchanged — in-flight runs are marked failed by RunService.init.
 */
export interface SeededRunPhase {
  id: string;
  type: string;
  title: string;
  task: string;
  status: string;
  candidates?: Array<{ agentId: string }>;
  startedAt?: string;
  completedAt?: string;
}

export interface SeededRun {
  id: string;
  title: string;
  status: string;
  phases: SeededRunPhase[];
  cwd?: string;
  workspaceId?: string;
  agentCount?: number;
  createdAt: string;
  updatedAt: string;
}

function getE2EOttoHome(): string {
  const ottoHome = process.env.E2E_OTTO_HOME;
  if (!ottoHome) {
    throw new Error("E2E_OTTO_HOME is not set (expected from Playwright globalSetup).");
  }
  return ottoHome;
}

export function seededRunFilePath(runId: string): string {
  return path.join(getE2EOttoHome(), "runs", `${runId}.json`);
}

export async function writeSeededRunFile(run: SeededRun): Promise<void> {
  const filePath = seededRunFilePath(run.id);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

export async function removeSeededRunFile(runId: string): Promise<void> {
  await rm(seededRunFilePath(runId), { force: true });
}

/**
 * Typed view over the daemon client's orchestration RPCs (runs.get_snapshot /
 * runs.clear). The seed client interface doesn't declare these, so run specs
 * cast through this.
 */
export interface RunsSeedClient {
  getRunsSnapshot(): Promise<Array<{ id: string; status: string; title: string }>>;
  clearFinishedRuns(): Promise<string[]>;
}

export function asRunsSeedClient(client: SeedDaemonClient): RunsSeedClient {
  return client as unknown as RunsSeedClient;
}
