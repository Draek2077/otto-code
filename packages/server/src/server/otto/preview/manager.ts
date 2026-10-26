import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { PreviewLogs } from "./logs.js";
import type { PreviewServer } from "@getpaseo/plugin/otto/preview";
export type { PreviewServer } from "@getpaseo/plugin/otto/preview";
import {
  previewCommandRevision,
  previewDestination,
  readPreviewLaunchConfig,
  type PreviewLaunchEntry,
  type PreviewLaunchConfig,
} from "./launch-config.js";

export interface PreviewProcess {
  pid: number;
  exited: Promise<{ code: number | null; signal: string | null }>;
  stop(): Promise<void>;
}
export interface PreviewManagerPorts {
  probe(port: number): Promise<boolean>;
  spawn(input: {
    cwd: string;
    entry: PreviewLaunchEntry;
    output(source: "stdout" | "stderr", text: string): void;
  }): Promise<PreviewProcess>;
  now?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  protectedPorts: ReadonlySet<number>;
}
interface RecordState {
  view: PreviewServer;
  logs: PreviewLogs;
  process?: PreviewProcess;
  monitor: AbortController;
}
const protectedServices = new Set([
  22, 25, 53, 110, 143, 389, 445, 465, 587, 636, 993, 995, 1433, 1521, 2375, 2376, 3306, 3389, 5432,
  6379, 6788, 6868, 11211, 27017,
]);
function live(record: RecordState) {
  return record.view.status === "starting" || record.view.status === "ready";
}
function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
/** One daemon service, with cwd-scoped names and serialized lifecycle mutations. */
export class PreviewManager {
  private readonly records = new Map<string, RecordState>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private closed = false;
  constructor(private readonly ports: PreviewManagerPorts) {}
  private async trackedRoot(cwd: string): Promise<string> {
    try {
      return await realpath(cwd);
    } catch (error) {
      const exact = resolvePath(cwd);
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR") &&
        [...this.records.values()].some((record) => record.view.cwd === exact)
      )
        return exact;
      throw error;
    }
  }
  private async ownedRoot(cwd: string, id: string): Promise<string> {
    const exact = resolvePath(cwd);
    return [...this.records.values()].some(
      (record) => record.view.cwd === exact && record.view.id === id,
    )
      ? exact
      : await realpath(cwd);
  }
  private serial<T>(cwd: string, operation: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(cwd) ?? Promise.resolve()).catch(() => {}).then(operation);
    this.queues.set(cwd, next);
    void next
      .finally(() => {
        if (this.queues.get(cwd) === next) this.queues.delete(cwd);
      })
      .catch(() => {});
    return next;
  }
  async list(cwd: string, configuration?: PreviewLaunchConfig | null): Promise<PreviewServer[]> {
    const root = await this.trackedRoot(cwd);
    return this.serial(root, async () => {
      const config =
        configuration === undefined ? await readPreviewLaunchConfig(root) : configuration;
      for (const entry of config?.servers ?? []) {
        const existing = [...this.records.values()].find(
          (record) =>
            record.view.cwd === root &&
            record.view.port === entry.port &&
            (live(record) || (record.process && record.view.status !== "stopped")),
        );
        if (existing) {
          if (existing.view.name === entry.name) existing.view.url = previewDestination(entry);
          continue;
        }
        if (await this.ports.probe(entry.port)) this.adopt(root, entry);
      }
      const rows = [...this.records.values()].filter((record) => record.view.cwd === root);
      for (const record of rows) {
        if (!record.view.managed)
          record.view.status = (await this.ports.probe(record.view.port)) ? "ready" : "stopped";
      }
      return rows.map((record) => Object.assign({}, record.view));
    });
  }
  async start(input: {
    cwd: string;
    name: string;
    approvedCommandRevision: string;
  }): Promise<{ server: PreviewServer; reused: boolean }> {
    const root = await realpath(input.cwd);
    return this.serial(root, async () => {
      if (this.closed) throw new Error("Preview manager is closed.");
      const config = await readPreviewLaunchConfig(root);
      const entry = config?.servers.find((candidate) => candidate.name === input.name);
      if (!entry)
        throw new Error("Add this server to .claude/launch.json before starting Preview.");
      const existing = this.findLive(root, entry);
      if (existing) {
        existing.view.url = previewDestination(entry);
        return { server: { ...existing.view }, reused: true };
      }
      if (protectedServices.has(entry.port) || this.ports.protectedPorts.has(entry.port))
        throw new Error(
          "This port belongs to a protected host service. Choose a development server port.",
        );
      if (await this.ports.probe(entry.port))
        return { server: { ...this.adopt(root, entry).view }, reused: true };
      if (previewCommandRevision(root, entry) !== input.approvedCommandRevision)
        throw new Error(
          "The launch command changed. Review and approve the current command before starting.",
        );
      const record = this.record(root, entry, randomUUID(), true);
      this.records.set(record.view.id, record);
      try {
        record.process = await this.ports.spawn({
          cwd: root,
          entry,
          output: (source, text) => record.logs.append(source, text),
        });
        record.view.pid = record.process.pid;
      } catch (error) {
        this.fail(record, "Could not start the preview command. Review the command and host logs.");
        throw new Error(record.view.error!, { cause: error });
      }
      void this.watchExit(record);
      void this.waitReady(record).catch(() => {
        if (!record.monitor.signal.aborted)
          this.fail(
            record,
            "Could not check Preview readiness. Read its logs; stop it before retrying.",
          );
      });
      return { server: { ...record.view }, reused: false };
    });
  }
  private findLive(cwd: string, entry: PreviewLaunchEntry): RecordState | undefined {
    const record = [...this.records.values()].find(
      (candidate) =>
        candidate.view.cwd === cwd &&
        (live(candidate) || (candidate.process && candidate.view.status !== "stopped")) &&
        (candidate.view.name === entry.name || candidate.view.port === entry.port),
    );
    if (record?.view.status === "error")
      throw new Error(
        "Stop the previous preview process before starting again; its process may still be running.",
      );
    if (record && record.view.port !== entry.port)
      throw new Error(
        "This server is already running on another port. Stop it before changing its port.",
      );
    return record;
  }
  private record(
    cwd: string,
    entry: PreviewLaunchEntry,
    id: string,
    managed: boolean,
  ): RecordState {
    // Keep active/uncertain ownership. Only confirmed stopped or never-spawned
    // historical rows may yield space; a forgotten PID is not a stopped process.
    for (const [key, previous] of this.records) {
      if (this.records.size < 256) break;
      if (
        previous.view.status === "stopped" ||
        (!previous.process && previous.view.status === "error")
      )
        this.records.delete(key);
    }
    if (this.records.size >= 256)
      throw new Error(
        "Preview's host limit is reached. Stop unused owned servers before starting another.",
      );
    return {
      view: {
        id,
        cwd,
        name: entry.name,
        port: entry.port,
        url: previewDestination(entry),
        managed,
        status: managed ? "starting" : "ready",
        pid: null,
        error: null,
        browserId: null,
      },
      logs: new PreviewLogs(),
      monitor: new AbortController(),
    };
  }
  private adopt(cwd: string, entry: PreviewLaunchEntry): RecordState {
    // External IDs are cwd-scoped. No PID or stop authority is inferred from a listening port.
    const key = `ext:${entry.port}:${cwd}`;
    const record = this.records.get(key) ?? this.record(cwd, entry, `ext:${entry.port}`, false);
    record.view.url = previewDestination(entry);
    record.view.status = "ready";
    this.records.set(key, record);
    return record;
  }
  private fail(record: RecordState, message: string): void {
    record.view.status = "error";
    record.view.error = message;
    record.monitor.abort();
  }
  private async watchExit(record: RecordState): Promise<void> {
    try {
      const exit = await record.process!.exited;
      record.logs.flush();
      if (record.view.status !== "stopped")
        this.fail(
          record,
          `Preview exited (${exit.signal ?? exit.code ?? "unknown"}). Read its logs before starting again.`,
        );
    } catch {
      this.fail(
        record,
        "Preview process tracking failed. Its stop outcome must be checked before starting again.",
      );
    }
  }
  private async waitReady(record: RecordState): Promise<void> {
    const now = this.ports.now ?? Date.now;
    const deadline = now() + 60000;
    while (!record.monitor.signal.aborted && now() < deadline) {
      if (await this.ports.probe(record.view.port)) {
        if (!record.monitor.signal.aborted) record.view.status = "ready";
        return;
      }
      await (this.ports.sleep ?? sleep)(250, record.monitor.signal);
    }
    if (!record.monitor.signal.aborted)
      this.fail(
        record,
        "Preview did not listen within 60 seconds. Read its logs; stop it before retrying.",
      );
  }
  private owned(cwd: string, id: string): RecordState {
    const record = [...this.records.values()].find(
      (candidate) => candidate.view.cwd === cwd && candidate.view.id === id,
    );
    if (!record) throw new Error("Preview server does not belong to this workspace directory.");
    return record;
  }
  async stop(cwd: string, id: string): Promise<PreviewServer> {
    const root = await this.ownedRoot(cwd, id);
    return this.serial(root, async () => {
      const record = this.owned(root, id);
      if (!record.view.managed)
        throw new Error("Otto did not start this server. Stop it from its owning terminal.");
      record.monitor.abort();
      try {
        await record.process?.stop();
      } catch (error) {
        this.fail(
          record,
          "Could not confirm the preview process stopped. Check its owning process before retrying.",
        );
        throw new Error(record.view.error!, { cause: error });
      }
      record.view.status = "stopped";
      record.view.error = null;
      return { ...record.view };
    });
  }
  async logs(cwd: string, id: string, options?: Parameters<PreviewLogs["read"]>[0]) {
    return this.owned(await this.ownedRoot(cwd, id), id).logs.read(options);
  }
  async bindBrowser(cwd: string, id: string, browserId: string): Promise<void> {
    this.owned(await this.ownedRoot(cwd, id), id).view.browserId = browserId;
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled(this.queues.values());
    const results = await Promise.allSettled(
      [...this.records.values()]
        .filter(
          (record) => record.view.managed && record.process && record.view.status !== "stopped",
        )
        .map((record) => this.stop(record.view.cwd, record.view.id)),
    );
    const errors = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length)
      throw new AggregateError(errors, "Some preview processes could not be stopped.");
  }
}
