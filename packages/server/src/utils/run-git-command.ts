import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync } from "node:fs";
import {
  GitCommandRuntimeMetricsWindow,
  type GitCommandRuntimeMetricsSnapshot,
} from "./git-command-runtime-metrics.js";
import type { Logger } from "pino";
import type { ProcessEnvRecord } from "../server/otto-env.js";
import { getActiveGitCommandObserver } from "../server/git-operation-log.js";
import { spawnProcess } from "./spawn.js";
import {
  GitProcessScheduler,
  type GitProcessPolicy,
  type GitProcessPriority,
  resolveGitProcessPolicy,
} from "./git-process-scheduler.js";

/**
 * Config pinned on every git invocation so output shape is ours to parse, not the
 * user's to configure. Their own `git diff` keeps whatever they set; only these
 * daemon reads are normalized.
 *
 * - `core.quotepath=false` emits raw UTF-8 paths instead of octal-escaping non-ASCII
 *   bytes (e.g. `测试文件.txt` vs `"\346\265\213..."`).
 * - The prefix keys keep patch headers at `a/path b/path`. `diff.mnemonicPrefix`
 *   (`c/`, `w/`, `i/`, `o/`) and custom `diff.srcPrefix`/`dstPrefix` are common
 *   personal settings that otherwise reshape every header we read.
 * - `color.ui=false` defeats `color.ui=always`, which wraps patch lines in ANSI
 *   escapes even when stdout is a pipe.
 *
 * `diff.external` cannot be pinned here: an empty value makes git exit with
 * "external diff died", so patch-producing commands pass `--no-ext-diff` instead.
 */
const MACHINE_READABLE_GIT_CONFIG = [
  "-c",
  "core.quotepath=false",
  "-c",
  "diff.mnemonicPrefix=false",
  "-c",
  "diff.noprefix=false",
  "-c",
  "diff.srcPrefix=a/",
  "-c",
  "diff.dstPrefix=b/",
  "-c",
  "color.ui=false",
];

/**
 * Flags for commands whose patch output the daemon parses. Config cannot cover these:
 * a configured `diff.external` (difftastic, delta, meld) replaces the patch entirely,
 * and a `diff=<driver>` textconv attribute rewrites its content so hunk line numbers
 * no longer anchor to the real file.
 */
export const MACHINE_READABLE_DIFF_FLAGS = ["--no-ext-diff", "--no-textconv"];

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 20 * 1024 * 1024; // 20MB
const DEFAULT_STDERR_LIMIT = 2048;

let gitProcessScheduler = new GitProcessScheduler(resolveGitProcessPolicy({ env: process.env }));
let gitRuntimeMetrics = createGitCommandRuntimeMetricsWindow(gitProcessScheduler.policy);
const gitCommandPriority = new AsyncLocalStorage<GitProcessPriority>();

function createGitCommandRuntimeMetricsWindow(policy: GitProcessPolicy) {
  return new GitCommandRuntimeMetricsWindow({
    concurrencyLimit: policy.maxProcessConcurrency,
    maxProcessesPerSecond: policy.maxProcessesPerSecond,
  });
}

export function configureGitProcessPolicy(policy: GitProcessPolicy): void {
  gitProcessScheduler = new GitProcessScheduler(policy);
  gitRuntimeMetrics = createGitCommandRuntimeMetricsWindow(policy);
}

export function runWithGitCommandPriority<T>(priority: GitProcessPriority, operation: () => T): T {
  return gitCommandPriority.run(priority, operation);
}

export interface GitCommandOptions {
  cwd: string;
  env?: ProcessEnvRecord;
  envOverlay?: ProcessEnvRecord;
  logger?: Pick<Logger, "trace">;
  timeout?: number;
  maxOutputBytes?: number;
  // Raise past the 2 KB default when stderr carries user-facing output the
  // caller must relay in full (e.g. commit hook failures).
  maxStderrBytes?: number;
  acceptExitCodes?: number[];
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  truncated: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface GitCommandMetric {
  args: string[];
  cwd: string;
  startedAtMs: number;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  success: boolean;
}

export interface GitCommandMetricsSnapshot {
  commands: GitCommandMetric[];
  submissions: GitCommandSubmissionMetric[];
  submitted: number;
  started: number;
  completed: number;
  active: number;
  pending: number;
  total: number;
  failed: number;
  maxConcurrent: number;
}

export interface GitCommandSubmissionMetric {
  args: string[];
  cwd: string;
}

interface GitCommandMetricsState {
  commands: GitCommandMetric[];
  submissions: GitCommandSubmissionMetric[];
  submitted: number;
  started: number;
  completed: number;
  active: number;
  maxConcurrent: number;
  lastSubmittedAtMs: number;
}

let gitCommandMetricsState: GitCommandMetricsState | null = null;

export function startGitCommandMetrics(): void {
  gitCommandMetricsState = {
    commands: [],
    submissions: [],
    submitted: 0,
    started: 0,
    completed: 0,
    active: 0,
    maxConcurrent: 0,
    lastSubmittedAtMs: Date.now(),
  };
}

export function stopGitCommandMetrics(): GitCommandMetricsSnapshot {
  const state = gitCommandMetricsState;
  if (!state) {
    return {
      commands: [],
      submissions: [],
      submitted: 0,
      started: 0,
      completed: 0,
      active: 0,
      pending: 0,
      total: 0,
      failed: 0,
      maxConcurrent: 0,
    };
  }
  const unfinished = state.submitted - state.completed;
  if (unfinished > 0) {
    throw new Error(
      `Cannot stop Git command metrics while ${unfinished} submitted commands are unfinished`,
    );
  }
  gitCommandMetricsState = null;
  return snapshotGitCommandMetricsState(state);
}

export function getGitCommandMetrics(): GitCommandMetricsSnapshot {
  const state = gitCommandMetricsState;
  return state ? snapshotGitCommandMetricsState(state) : stopGitCommandMetrics();
}

export async function waitForGitCommandMetricsIdle(options: {
  quietMs: number;
  timeoutMs: number;
}): Promise<void> {
  const startedAtMs = Date.now();
  while (true) {
    const state = gitCommandMetricsState;
    if (!state) throw new Error("Git command metrics are not running");
    if (
      state.completed === state.submitted &&
      Date.now() - state.lastSubmittedAtMs >= options.quietMs
    ) {
      return;
    }
    if (Date.now() - startedAtMs >= options.timeoutMs) {
      throw new Error(
        `Timed out waiting for Git command metrics to become idle (${state.submitted - state.completed} unfinished)`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function snapshotGitCommandMetricsState(state: GitCommandMetricsState): GitCommandMetricsSnapshot {
  return {
    commands: [...state.commands],
    submissions: state.submissions.map((submission) => ({
      args: [...submission.args],
      cwd: submission.cwd,
    })),
    submitted: state.submitted,
    started: state.started,
    completed: state.completed,
    active: state.active,
    pending: state.submitted - state.started,
    total: state.commands.length,
    failed: state.commands.filter((command) => !command.success).length,
    maxConcurrent: state.maxConcurrent,
  };
}

function submitGitCommandMetric(args: string[], cwd: string): GitCommandMetricsState | null {
  const state = gitCommandMetricsState;
  if (!state) return null;
  state.submissions.push({ args: [...args], cwd });
  state.submitted += 1;
  state.lastSubmittedAtMs = Date.now();
  return state;
}

function beginGitCommandMetric(state: GitCommandMetricsState | null): void {
  if (!state) return;
  state.started += 1;
  state.active += 1;
  state.maxConcurrent = Math.max(state.maxConcurrent, state.active);
}

function finishGitCommandMetric(
  state: GitCommandMetricsState | null,
  metric: GitCommandMetric,
): void {
  if (!state) {
    return;
  }
  state.active = Math.max(0, state.active - 1);
  state.completed += 1;
  state.commands.push(metric);
}

function mergeEnvOverlays(
  env: ProcessEnvRecord | undefined,
  envOverlay: ProcessEnvRecord | undefined,
): ProcessEnvRecord | undefined {
  if (!env) {
    return envOverlay;
  }
  if (!envOverlay) {
    return env;
  }
  return { ...env, ...envOverlay };
}

function getEnvOverlayKeys(envOverlay: ProcessEnvRecord | undefined): string[] {
  return Object.keys(envOverlay ?? {}).sort();
}

export function runGitCommand(
  args: string[],
  options: GitCommandOptions,
): Promise<GitCommandResult> {
  // Captured before the concurrency queue: the thunk may execute in a later
  // async context where the operation-log ALS store is no longer active.
  const commandObserver = getActiveGitCommandObserver();
  const metricsState = submitGitCommandMetric(args, options.cwd);
  const runtimeMetric = gitRuntimeMetrics.submit(getGitOperation(args));
  const startCommand = () => {
    let releaseProcessSlot!: () => void;
    const exited = new Promise<void>((resolve) => {
      releaseProcessSlot = resolve;
    });
    let processSlotReleased = false;
    const releaseProcessSlotOnce = () => {
      if (processSlotReleased) return;
      processSlotReleased = true;
      releaseProcessSlot();
    };
    const result = new Promise<GitCommandResult>((resolve, reject) => {
      gitRuntimeMetrics.start(runtimeMetric);
      const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
      const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
      const maxStderrBytes = options.maxStderrBytes ?? DEFAULT_STDERR_LIMIT;
      const acceptExitCodes = options.acceptExitCodes ?? [0];
      const command = formatGitCommand(args);
      const envOverlay = mergeEnvOverlays(options.env, options.envOverlay);
      const startedAt = Date.now();
      beginGitCommandMetric(metricsState);
      const logger = typeof options.logger?.trace === "function" ? options.logger : undefined;
      const traceContext = logger
        ? {
            command: "git",
            args,
            cwd: options.cwd,
            cwdExists: existsSync(options.cwd),
            timeout,
            maxOutputBytes,
            acceptExitCodes,
            envOverlayKeys: getEnvOverlayKeys(envOverlay),
          }
        : null;

      if (logger && traceContext) {
        logger.trace(traceContext, "Spawning git command");
      }

      let child: ReturnType<typeof spawnProcess>;
      try {
        child = spawnProcess("git", [...MACHINE_READABLE_GIT_CONFIG, ...args], {
          cwd: options.cwd,
          envOverlay,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        releaseProcessSlotOnce();
        finishGitCommandMetric(metricsState, {
          args,
          cwd: options.cwd,
          startedAtMs: startedAt,
          durationMs: Date.now() - startedAt,
          exitCode: null,
          signal: null,
          success: false,
        });
        gitRuntimeMetrics.finish(runtimeMetric, { success: false, timedOut: false });
        reject(error);
        return;
      }

      let settled = false;
      let metricFinished = false;
      // Mirrors Paseo's runtime-metrics contract: distinguishes a timeout kill
      // from an ordinary non-zero exit.
      let timedOut = false;
      let truncated = false;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      commandObserver?.onCommandStart(command);
      let observerEnded = false;
      const endObserver = (exitCode: number | null) => {
        if (!commandObserver || observerEnded) return;
        observerEnded = true;
        commandObserver.onCommandEnd({ exitCode, durationMs: Date.now() - startedAt });
      };

      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };

      const finishMetricOnce = (metric: GitCommandMetric) => {
        if (metricFinished) return;
        metricFinished = true;
        finishGitCommandMetric(metricsState, metric);
        gitRuntimeMetrics.finish(runtimeMetric, { success: metric.success, timedOut });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        const error = new Error(`Git command timed out after ${timeout}ms: ${command}`);
        child.kill("SIGKILL");
        endObserver(null);
        finishMetricOnce({
          args,
          cwd: options.cwd,
          startedAtMs: startedAt,
          durationMs: Date.now() - startedAt,
          exitCode: null,
          signal: "SIGKILL",
          success: false,
        });
        settle(() => reject(error));
      }, timeout);

      child.stdout!.on("data", (chunk: Buffer | string) => {
        if (settled || truncated) return;

        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        commandObserver?.onCommandOutput(buffer.toString("utf8"), "stdout");
        const remainingBytes = maxOutputBytes - stdoutBytes;

        if (remainingBytes <= 0) {
          truncated = true;
          child.kill("SIGKILL");
          return;
        }

        if (buffer.length > remainingBytes) {
          stdoutChunks.push(buffer.subarray(0, remainingBytes));
          stdoutBytes += remainingBytes;
          truncated = true;
          child.kill("SIGKILL");
          return;
        }

        stdoutChunks.push(buffer);
        stdoutBytes += buffer.length;
      });

      child.stderr!.on("data", (chunk: Buffer | string) => {
        if (settled) return;

        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        commandObserver?.onCommandOutput(buffer.toString("utf8"), "stderr");
        if (stderrBytes >= maxStderrBytes) return;
        const remainingBytes = maxStderrBytes - stderrBytes;

        if (buffer.length > remainingBytes) {
          stderrChunks.push(buffer.subarray(0, remainingBytes));
          stderrBytes += remainingBytes;
          return;
        }

        stderrChunks.push(buffer);
        stderrBytes += buffer.length;
      });

      child.on("error", (error) => {
        releaseProcessSlotOnce();
        endObserver(null);
        finishMetricOnce({
          args,
          cwd: options.cwd,
          startedAtMs: startedAt,
          durationMs: Date.now() - startedAt,
          exitCode: null,
          signal: null,
          success: false,
        });
        if (logger && traceContext) {
          logger.trace(
            {
              ...traceContext,
              err: error,
              durationMs: Date.now() - startedAt,
            },
            "Git command process error",
          );
        }
        settle(() => reject(error));
      });

      child.on("exit", (exitCode, signal) => {
        releaseProcessSlotOnce();
        finishMetricOnce({
          args,
          cwd: options.cwd,
          startedAtMs: startedAt,
          durationMs: Date.now() - startedAt,
          exitCode,
          signal,
          success: !timedOut && (truncated || acceptExitCodes.includes(exitCode ?? -1)),
        });
      });

      child.on("close", (exitCode, signal) => {
        releaseProcessSlotOnce();
        endObserver(exitCode);
        const commandResult: GitCommandResult = {
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          truncated,
          exitCode,
          signal,
        };
        if (logger && traceContext) {
          logger.trace(
            {
              ...traceContext,
              durationMs: Date.now() - startedAt,
              exitCode,
              signal,
              truncated,
              stdoutBytes,
              stderrBytes,
            },
            "Git command closed",
          );
        }

        if (!truncated && !acceptExitCodes.includes(exitCode ?? -1)) {
          finishMetricOnce({
            args,
            cwd: options.cwd,
            startedAtMs: startedAt,
            durationMs: Date.now() - startedAt,
            exitCode,
            signal,
            success: false,
          });
          const stderrPreview = commandResult.stderr.trim() || "(no stderr)";
          const truncationNote = commandResult.truncated ? " (stdout truncated)" : "";

          settle(() =>
            reject(
              new Error(
                `Git command failed: ${command}${truncationNote} (exit code: ${String(exitCode)}, signal: ${signal ?? "none"})\n${stderrPreview}`,
              ),
            ),
          );
          return;
        }

        finishMetricOnce({
          args,
          cwd: options.cwd,
          startedAtMs: startedAt,
          durationMs: Date.now() - startedAt,
          exitCode,
          signal,
          success: true,
        });
        settle(() => resolve(commandResult));
      });
    });
    return { result, exited };
  };
  const promise = gitProcessScheduler.run(startCommand, {
    priority: gitCommandPriority.getStore(),
  });
  gitRuntimeMetrics.observeLimiter(
    gitProcessScheduler.activeCount,
    gitProcessScheduler.pendingCount,
  );
  return promise;
}

function formatGitCommand(args: string[]): string {
  return ["git", ...args].join(" ");
}

export function snapshotGitCommandRuntimeMetrics(): GitCommandRuntimeMetricsSnapshot {
  return gitRuntimeMetrics.snapshotAndReset({
    active: gitProcessScheduler.activeCount,
    pending: gitProcessScheduler.pendingCount,
  });
}

function getGitOperation(args: string[]): string {
  return args[0] === "-c" ? (args[2] ?? "unknown") : (args[0] ?? "unknown");
}
