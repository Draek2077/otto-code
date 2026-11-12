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

/** Policy over Paseo's existing repository timers, not another observation or job owner. */
export class GitFetchControl<T extends FetchTarget> {
  private policy: GitFetchPreferences;
  private readonly eligible = new Set<T>();
  private readonly operations = new Map<string, Promise<WorkspaceGitFetchResult>>();
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
      .then(() => (this.canRun(target) ? this.ports.run(target) : undefined))
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
    if (this.closed) return Promise.reject(new Error("Workspace Git has stopped."));
    const key = this.key(root),
      current = this.operations.get(key);
    if (current) return current;
    const pending = Promise.resolve().then(() => {
      if (this.closed) throw new Error("Workspace Git has stopped.");
      return operation();
    });
    this.operations.set(key, pending);
    void pending
      .finally(() => {
        if (this.operations.get(key) === pending) this.operations.delete(key);
      })
      .catch(() => {});
    return pending;
  }
  dispose() {
    this.closed = true;
    for (const target of this.eligible) this.forget(target);
  }
}
