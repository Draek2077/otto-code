import { AsyncLocalStorage } from "node:async_hooks";
import type { GitOperationLogEntry } from "@otto-code/protocol/messages";

// Known watchable operations. The wire carries an open string so this list can
// grow without breaking old peers; keep in sync with the client's
// GIT_LOG_OPERATIONS.
export type GitOperationId = "commit" | "pull" | "push";

const MAX_ENTRIES_PER_LOG = 500;
const MAX_CHARS_PER_OUTPUT_ENTRY = 8_192;

/**
 * Receives what runGitCommand observes while a watched operation runs. The
 * observer is installed with AsyncLocalStorage by runOperation(), so every git
 * command spawned anywhere inside the operation reports here without the git
 * helpers having to thread a sink through their signatures.
 */
export interface GitCommandObserver {
  onCommandStart(command: string): void;
  onCommandOutput(text: string, stream: "stdout" | "stderr"): void;
  onCommandEnd(input: { exitCode: number | null; durationMs: number }): void;
}

const gitCommandObserverStorage = new AsyncLocalStorage<GitCommandObserver>();

export function getActiveGitCommandObserver(): GitCommandObserver | undefined {
  return gitCommandObserverStorage.getStore();
}

export interface GitOperationLogAppend {
  cwd: string;
  operation: GitOperationId;
  entries: GitOperationLogEntry[];
}

export type GitOperationLogListener = (append: GitOperationLogAppend) => void;

interface RunOperationInput {
  cwd: string;
  operation: GitOperationId;
  // Plain-English heading for the log itself. Log content is not localized —
  // it sits next to raw git output; the pane's *title* is localized client-side.
  label: string;
}

/**
 * In-memory log of watched git operations, one bounded buffer per
 * (cwd, operation). Feeds the app's "Git Commit"/"Git Pull"/"Git Push" log
 * panes: backfill reads the buffer, live updates flow through listeners that
 * sessions fan out as checkout.git.log_appended.notification. Deliberately not
 * persisted — it is operational visibility, not history.
 */
export class GitOperationLogService {
  private readonly buffers = new Map<string, GitOperationLogEntry[]>();
  private readonly seqCounters = new Map<string, number>();
  private readonly listeners = new Set<GitOperationLogListener>();

  subscribe(listener: GitOperationLogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getEntries(cwd: string, operation: string): GitOperationLogEntry[] {
    return [...(this.buffers.get(bufferKey(cwd, operation)) ?? [])];
  }

  append(input: {
    cwd: string;
    operation: GitOperationId;
    level: GitOperationLogEntry["level"];
    text: string;
  }): void {
    const key = bufferKey(input.cwd, input.operation);
    const seq = (this.seqCounters.get(key) ?? 0) + 1;
    this.seqCounters.set(key, seq);
    const entry: GitOperationLogEntry = {
      seq,
      timestamp: new Date().toISOString(),
      level: input.level,
      text: truncateOutput(input.text),
    };
    const buffer = this.buffers.get(key) ?? [];
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES_PER_LOG) {
      buffer.splice(0, buffer.length - MAX_ENTRIES_PER_LOG);
    }
    this.buffers.set(key, buffer);
    for (const listener of this.listeners) {
      listener({ cwd: input.cwd, operation: input.operation, entries: [entry] });
    }
  }

  /**
   * Run a git operation with command observation. Writes the started heading
   * and, on throw, the failure line; the caller appends its own outcome line
   * for structured (non-throwing) results it alone can describe.
   */
  async runOperation<T>(input: RunOperationInput, run: () => Promise<T>): Promise<T> {
    const { cwd, operation, label } = input;
    this.append({ cwd, operation, level: "info", text: `── ${label}` });
    const observer: GitCommandObserver = {
      onCommandStart: (command) => {
        this.append({ cwd, operation, level: "info", text: `$ ${command}` });
      },
      onCommandOutput: (text, stream) => {
        const trimmed = text.replace(/\r?\n$/, "");
        if (trimmed.length === 0) {
          return;
        }
        void stream;
        this.append({ cwd, operation, level: "output", text: trimmed });
      },
      onCommandEnd: ({ exitCode, durationMs }) => {
        if (exitCode !== 0) {
          this.append({
            cwd,
            operation,
            level: "error",
            text: `exit ${exitCode ?? "signal"} (${durationMs}ms)`,
          });
        }
      },
    };
    try {
      return await gitCommandObserverStorage.run(observer, run);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.append({ cwd, operation, level: "error", text: `${label} failed: ${message}` });
      throw error;
    }
  }
}

function bufferKey(cwd: string, operation: string): string {
  return `${cwd}::${operation}`;
}

function truncateOutput(text: string): string {
  if (text.length <= MAX_CHARS_PER_OUTPUT_ENTRY) {
    return text;
  }
  return `${text.slice(0, MAX_CHARS_PER_OUTPUT_ENTRY)}\n… output truncated`;
}

// Daemon-global instance: git operations are daemon-wide facts (any client may
// watch any workspace's log), mirroring the module-level caches in
// checkout-git.ts. Tests construct their own GitOperationLogService.
export const gitOperationLog = new GitOperationLogService();
