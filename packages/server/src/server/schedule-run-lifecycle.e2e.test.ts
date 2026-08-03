import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { sep } from "node:path";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, test } from "vitest";

import { getFullAccessConfig } from "./daemon-e2e/agent-configs.js";
import {
  createDaemonTestContext,
  type DaemonClient,
  type DaemonTestContext,
} from "./test-utils/index.js";
import type { SessionOutboundMessage } from "./messages.js";
import { getOttoWorktreesRoot } from "../utils/worktree.js";
import { removeTempDir } from "../test-utils/remove-temp-dir.js";

type AgentUpdateMessage = Extract<SessionOutboundMessage, { type: "agent_update" }>;
type WorkspaceUpdateMessage = Extract<SessionOutboundMessage, { type: "workspace_update" }>;
type ScheduleCreateOptions = Parameters<DaemonClient["scheduleCreate"]>[0];
type ScheduleSummary = NonNullable<Awaited<ReturnType<DaemonClient["scheduleCreate"]>>["schedule"]>;
type ScheduleWithRuns = NonNullable<
  Awaited<ReturnType<DaemonClient["scheduleRunOnce"]>>["schedule"]
>;

let ctx: DaemonTestContext;
const tempRoots: string[] = [];

beforeEach(async () => {
  ctx = await createDaemonTestContext();
});

afterEach(async () => {
  await ctx.cleanup();
  for (const tempRoot of tempRoots.splice(0)) {
    removeTempDir(tempRoot);
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function createGitRepo(): string {
  const tempRoot = makeTempDir("schedule-run-worktree-");
  const repoDir = path.join(tempRoot, "repo");
  execFileSync("git", ["init", "-b", "main", repoDir], { stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@otto-code.local"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "Otto Test"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  writeFileSync(path.join(repoDir, "README.md"), "hello\n");
  execFileSync("git", ["add", "README.md"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  return repoDir;
}

async function createNewAgentSchedule(options: ScheduleCreateOptions): Promise<ScheduleSummary> {
  const response = await ctx.client.scheduleCreate(options);
  if (response.error || !response.schedule) {
    throw new Error(response.error ?? "schedule/create returned no schedule");
  }
  return response.schedule;
}

async function runScheduleOnce(scheduleId: string): Promise<ScheduleWithRuns> {
  const response = await ctx.client.scheduleRunOnce({ id: scheduleId });
  if (response.error || !response.schedule) {
    throw new Error(response.error ?? "schedule/run-once returned no schedule");
  }
  return response.schedule;
}

async function updateSchedule(
  options: Parameters<DaemonClient["scheduleUpdate"]>[0],
): Promise<ScheduleWithRuns> {
  const response = await ctx.client.scheduleUpdate(options);
  if (response.error || !response.schedule) {
    throw new Error(response.error ?? "schedule/update returned no schedule");
  }
  return response.schedule;
}

/**
 * The run record is the only handle these tests get on a scheduled run.
 *
 * Schedule-run agents are created `internal: true`, exactly like the artifact
 * generator, and every listing path in the session drops internal records
 * unconditionally — `fetchAgent` throws and `fetchAgents` omits them even with
 * `includeArchived`. There is no opt-in filter, by design: a clean scheduled
 * run is meant to be silent. So the run's own `workspaceId` is what identifies
 * what the run produced, and the workspace it opens is what the user actually
 * sees. Asserting through the agent list here was asserting a contract the
 * daemon deliberately does not offer.
 */
function requireCompletedRunWorkspaceId(schedule: ScheduleWithRuns): string {
  const run = schedule.runs[0];
  if (!run || run.status !== "succeeded" || !run.workspaceId) {
    throw new Error(
      `Expected one succeeded run with a workspace id: ${JSON.stringify(schedule.runs)}`,
    );
  }
  return run.workspaceId;
}

/** Worktree directories currently sitting under a repo's Otto worktrees root. */
function listWorktreeDirectories(worktreesRoot: string): string[] {
  if (!existsSync(worktreesRoot)) {
    return [];
  }
  return readdirSync(worktreesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

async function activeWorkspaceIds(): Promise<Set<string>> {
  const workspaces = await ctx.client.fetchWorkspaces();
  return new Set(workspaces.entries.map((entry) => entry.id));
}

function collectLifecycleUpdates(): {
  agentUpdates: AgentUpdateMessage[];
  workspaceUpdates: WorkspaceUpdateMessage[];
  stop: () => void;
} {
  const agentUpdates: AgentUpdateMessage[] = [];
  const workspaceUpdates: WorkspaceUpdateMessage[] = [];
  const stopAgentUpdates = ctx.client.on("agent_update", (message) => {
    agentUpdates.push(message);
  });
  const stopWorkspaceUpdates = ctx.client.on("workspace_update", (message) => {
    workspaceUpdates.push(message);
  });
  return {
    agentUpdates,
    workspaceUpdates,
    stop: () => {
      stopAgentUpdates();
      stopWorkspaceUpdates();
    },
  };
}

async function waitForWorkspaceUpsert(
  events: WorkspaceUpdateMessage[],
  workspaceId: string,
): Promise<void> {
  await expect
    .poll(
      () =>
        events.some(
          (message) =>
            message.payload.kind === "upsert" && message.payload.workspace.id === workspaceId,
        ),
      { timeout: 10_000, interval: 100 },
    )
    .toBe(true);
}

function workspaceWasRemoved(events: WorkspaceUpdateMessage[], workspaceId: string): boolean {
  return events.some(
    (message) => message.payload.kind === "remove" && message.payload.id === workspaceId,
  );
}

function workspaceWasUpserted(events: WorkspaceUpdateMessage[], workspaceId: string): boolean {
  return events.some(
    (message) => message.payload.kind === "upsert" && message.payload.workspace.id === workspaceId,
  );
}

test("archiveOnFinish=false local scheduled run emits upserts and remains active", async () => {
  const cwd = makeTempDir("schedule-run-local-");
  const schedule = await createNewAgentSchedule({
    prompt: "Say done.",
    cadence: { type: "every", everyMs: 60_000 },
    target: {
      type: "new-agent",
      config: {
        ...getFullAccessConfig("codex"),
        cwd,
        archiveOnFinish: false,
        isolation: "local",
      },
    },
    runOnCreate: false,
  });
  await ctx.client.fetchWorkspaces({ subscribe: { subscriptionId: "schedule-local-workspaces" } });
  const events = collectLifecycleUpdates();

  const ran = await runScheduleOnce(schedule.id);
  const workspaceId = requireCompletedRunWorkspaceId(ran);

  expect(workspaceId).toMatch(/^wks_/);
  await waitForWorkspaceUpsert(events.workspaceUpdates, workspaceId);
  // "Remains active" is a statement about the workspace: archiveOnFinish=false
  // means the run's workspace survives the run and stays listed.
  expect(workspaceWasRemoved(events.workspaceUpdates, workspaceId)).toBe(false);
  expect(await activeWorkspaceIds()).toContain(workspaceId);

  events.stop();
});

test("archiveOnFinish=true scheduled run leaves no workspace behind and stays silent", async () => {
  const cwd = makeTempDir("schedule-run-archive-");
  const schedule = await createNewAgentSchedule({
    prompt: "Say done.",
    cadence: { type: "every", everyMs: 60_000 },
    target: {
      type: "new-agent",
      config: {
        ...getFullAccessConfig("codex"),
        cwd,
        archiveOnFinish: true,
        isolation: "local",
      },
    },
    runOnCreate: false,
  });
  await ctx.client.fetchWorkspaces({
    subscribe: { subscriptionId: "schedule-archive-workspaces" },
  });
  const events = collectLifecycleUpdates();

  const ran = await runScheduleOnce(schedule.id);
  const workspaceId = requireCompletedRunWorkspaceId(ran);

  expect(workspaceId).toMatch(/^wks_/);
  // A run mints its workspace `hidden: true` and only reveals it if it
  // survives the run (see revealScheduleRunWorkspace). archiveOnFinish=true
  // disposes of it while still hidden, so the correct observable behavior is
  // NO churn: the client never saw the workspace appear, so it must never see
  // it appear or disappear. Asserting a `remove` here was asserting a
  // reveal-then-retract the design exists to avoid.
  expect(await activeWorkspaceIds()).not.toContain(workspaceId);
  expect(workspaceWasUpserted(events.workspaceUpdates, workspaceId)).toBe(false);
  expect(workspaceWasRemoved(events.workspaceUpdates, workspaceId)).toBe(false);

  events.stop();
});

test("worktree isolation creates a run worktree and archiveOnFinish removes it", async () => {
  const repoDir = createGitRepo();
  const expectedRoot = await getOttoWorktreesRoot(
    repoDir,
    realpathSync(ctx.daemon.ottoHome),
    ctx.daemon.config.worktreesRoot,
  );
  const schedule = await createNewAgentSchedule({
    prompt: "Say done.",
    cadence: { type: "every", everyMs: 60_000 },
    target: {
      type: "new-agent",
      config: {
        ...getFullAccessConfig("codex"),
        cwd: repoDir,
        archiveOnFinish: true,
        isolation: "worktree",
      },
    },
    runOnCreate: false,
  });
  await ctx.client.fetchWorkspaces({
    subscribe: { subscriptionId: "schedule-worktree-workspaces" },
  });
  const events = collectLifecycleUpdates();

  const ran = await runScheduleOnce(schedule.id);
  const workspaceId = requireCompletedRunWorkspaceId(ran);

  // The run's workspace is disposed of while still hidden, so there is no
  // record and no event to read its directory back from. The removal is
  // asserted where it is actually observable — on disk and in git. The
  // creation half of this property is covered by the update_schedule test,
  // which runs isolation "worktree" with archiveOnFinish=false and asserts the
  // directory exists under this same root.
  expect(workspaceWasUpserted(events.workspaceUpdates, workspaceId)).toBe(false);
  await expect
    .poll(() => listWorktreeDirectories(expectedRoot).length, {
      timeout: 10_000,
      interval: 100,
    })
    .toBe(0);
  const worktreeList = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: repoDir,
    encoding: "utf8",
  });
  expect(worktreeList).not.toContain(expectedRoot);

  events.stop();
});

test("update_schedule patches thinking, archive behavior, and isolation for the next run", async () => {
  const repoDir = createGitRepo();
  const expectedRoot = await getOttoWorktreesRoot(
    repoDir,
    realpathSync(ctx.daemon.ottoHome),
    ctx.daemon.config.worktreesRoot,
  );
  const schedule = await createNewAgentSchedule({
    prompt: "Say done.",
    cadence: { type: "every", everyMs: 60_000 },
    target: {
      type: "new-agent",
      config: {
        ...getFullAccessConfig("codex"),
        cwd: repoDir,
        archiveOnFinish: true,
        isolation: "local",
      },
    },
    runOnCreate: false,
  });

  const updated = await updateSchedule({
    id: schedule.id,
    newAgentConfig: {
      thinkingOptionId: "think-hard",
      archiveOnFinish: false,
      isolation: "worktree",
    },
  });

  // The patched thinking option is read back off the schedule itself. The run's
  // agent is internal and unlistable, so the schedule record is where "the next
  // run will use think-hard" is observable; isolation and archive behavior are
  // then proven by what the run actually produces below.
  expect(updated.target.type === "new-agent" ? updated.target.config.thinkingOptionId : null).toBe(
    "think-hard",
  );

  const ran = await runScheduleOnce(schedule.id);
  const workspaceId = requireCompletedRunWorkspaceId(ran);

  const workspaces = await ctx.client.fetchWorkspaces();
  const runWorkspace = workspaces.entries.find((entry) => entry.id === workspaceId);
  if (!runWorkspace) {
    throw new Error(`Expected the run workspace ${workspaceId} to stay listed`);
  }
  const runDir = runWorkspace.workspaceDirectory;

  // isolation: "worktree" took effect for the next run.
  expect(runDir.startsWith(`${expectedRoot}${sep}`)).toBe(true);
  expect(runDir).not.toBe(repoDir);
  // archiveOnFinish: false took effect — the workspace and its directory survive.
  expect(existsSync(runDir)).toBe(true);
});
