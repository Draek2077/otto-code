import path from "node:path";
import { normalizePathForIdentity } from "../../../utils/path.js";
import {
  DEFAULT_GIT_FETCH_PREFERENCES,
  type GitFetchPreferences,
} from "@getpaseo/plugin/otto/workspace-git";
import type { WorkspaceGitFetchResult } from "../../workspace-git-fetch.js";

interface FetchTarget {
  repoGitRoot: string;
  closed: boolean;
  intervalId: ReturnType<typeof setInterval> | null;
}
interface FetchOperation<T> {
  promise: Promise<WorkspaceGitFetchResult>;
  run(): Promise<WorkspaceGitFetchResult>;
  automatic: T | undefined;
  started: boolean;
}

/** Policy over Paseo's existing repository timers, not another observation or job owner. */
export class GitFetchControl<T extends FetchTarget> {
  private policy: GitFetchPreferences;
  private readonly eligible = new Set<T>();
  private readonly operations = new Map<string, FetchOperation<T>>();
  private closed = false;
  constructor(
    private readonly ports: {
      active(target: T): boolean;
      run(target: T): Promise<WorkspaceGitFetchResult>;
      report(error: unknown, target: T): void;
    },
    policy = DEFAULT_GIT_FETCH_PREFERENCES,
  ) {
    this.policy = { ...policy };
  }
  private key(root: string) {
    return normalizePathForIdentity(path.resolve(root));
  }
  observe(target: T) {
    if (this.closed || this.eligible.has(target)) return;
    this.eligible.add(target);
    this.schedule(target);
    this.tick(target);
  }
  private canRun(target: T) {
    return (
      !this.closed &&
      this.policy.enabled &&
      this.eligible.has(target) &&
      !target.closed &&
      this.ports.active(target)
    );
  }
  private tick(target: T) {
    // Recheck after admission as well as when the timer fired: a queued callback
    // cannot revive automatic fetching after its policy or workspace is revoked.
    if (!this.canRun(target)) return;
    void Promise.resolve()
      .then(() =>
        this.canRun(target)
          ? this.admit(target.repoGitRoot, () => this.ports.run(target), target)
          : undefined,
      )
      .catch((error: unknown) => this.ports.report(error, target));
  }
  private schedule(target: T) {
    if (target.intervalId) clearInterval(target.intervalId);
    target.intervalId = null;
    if (this.closed || !this.policy.enabled || !this.eligible.has(target) || target.closed) return;
    target.intervalId = setInterval(() => this.tick(target), this.policy.intervalSeconds * 1000);
    target.intervalId.unref?.();
  }
  setPolicy(policy: GitFetchPreferences) {
    if (
      policy.enabled === this.policy.enabled &&
      policy.intervalSeconds === this.policy.intervalSeconds
    )
      return;
    this.policy = { ...policy };
    // Changing a preference re-arms the existing cadence, never launches a fetch.
    for (const target of this.eligible) this.schedule(target);
  }
  forget(target: T) {
    this.eligible.delete(target);
    if (target.intervalId) clearInterval(target.intervalId);
    target.intervalId = null;
  }
  single(root: string, operation: () => Promise<WorkspaceGitFetchResult>) {
    return this.admit(root, operation);
  }
  private admit(root: string, operation: () => Promise<WorkspaceGitFetchResult>, automatic?: T) {
    if (this.closed) return Promise.reject(new Error("Workspace Git has stopped."));
    const key = this.key(root),
      current = this.operations.get(key);
    if (current) {
      // An explicit request may claim queued automatic work even after opt-out.
      // Once Git is admitted, all callers share that operation's actual result.
      if (!automatic && current.automatic && !current.started) {
        current.automatic = undefined;
        current.run = operation;
      }
      return current.promise;
    }
    const entry: FetchOperation<T> = {
      run: operation,
      automatic,
      started: false,
      promise: Promise.resolve().then(() => {
        if (this.closed) throw new Error("Workspace Git has stopped.");
        if (entry.automatic && !this.canRun(entry.automatic)) {
          // Remove a skipped admission immediately: a later manual request must
          // start real work, rather than inherit this automatic no-op's result.
          if (this.operations.get(key) === entry) this.operations.delete(key);
          return { changes: [], error: null };
        }
        entry.started = true;
        return entry.run();
      }),
    };
    this.operations.set(key, entry);
    void entry.promise
      .finally(() => {
        if (this.operations.get(key) === entry) this.operations.delete(key);
      })
      .catch(() => {});
    return entry.promise;
  }
  dispose() {
    this.closed = true;
    for (const target of this.eligible) this.forget(target);
  }
}
