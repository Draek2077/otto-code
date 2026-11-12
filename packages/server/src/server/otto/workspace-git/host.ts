import {
  DEFAULT_GIT_FETCH_PREFERENCES,
  readGitFetchPolicy,
  saveGitFetchPolicy,
  fetchWorkspaceGit,
  type GitFetchPreferences,
} from "@getpaseo/plugin/otto/workspace-git";
import { GitFetchSettingsStore, GitFetchSettingsError } from "./settings.js";

export class WorkspaceGitHost {
  readonly store: GitFetchSettingsStore;
  constructor(
    private readonly ports: {
      store: GitFetchSettingsStore;
      hostId: string;
      workspace(id: string): Promise<{ cwd: string; archivedAt: string | null } | null>;
      policy(value: GitFetchPreferences): void;
      fetch(cwd: string): Promise<void>;
    },
  ) {
    this.store = ports.store;
  }
  private assertHost(id: string) {
    if (id !== this.ports.hostId) throw new Error("Select the workspace's owning host.");
  }
  private async guard<T>(operation: () => Promise<T>) {
    try {
      return { ok: true as const, value: await operation() };
    } catch (error) {
      return {
        ok: false as const,
        error: {
          kind: error instanceof GitFetchSettingsError ? error.kind : ("failed" as const),
          message:
            error instanceof GitFetchSettingsError
              ? error.message
              : "The host could not acknowledge Git fetch. Check its Git access and repository state before trying again.",
        },
      };
    }
  }
  invoke(method: string, input: unknown): Promise<unknown> | undefined {
    switch (method) {
      case readGitFetchPolicy.name:
        return this.guard(async () => {
          this.assertHost(readGitFetchPolicy.input.parse(input).hostId);
          const settings = this.store.read();
          this.ports.policy(settings.preferences);
          return settings;
        });
      case saveGitFetchPolicy.name:
        return this.guard(async () => {
          const value = saveGitFetchPolicy.input.parse(input);
          this.assertHost(value.hostId);
          const settings = this.store.save(value.expectedRevision, value.patch);
          this.ports.policy(settings.preferences);
          return settings;
        });
      case fetchWorkspaceGit.name:
        return this.guard(async () => {
          const value = fetchWorkspaceGit.input.parse(input);
          this.assertHost(value.hostId);
          const workspace = await this.ports.workspace(value.workspaceId);
          if (!workspace || workspace.archivedAt) throw new Error("Select an active workspace.");
          await this.ports.fetch(workspace.cwd);
          return { remote: "origin" as const };
        });
    }
  }
}

export function initialGitFetchPolicy(
  store: GitFetchSettingsStore,
  report: () => void,
): GitFetchPreferences {
  try {
    return store.read().preferences;
  } catch {
    report();
    // An unreadable opt-out must never turn into permission to fetch.
    return { ...DEFAULT_GIT_FETCH_PREFERENCES, enabled: false };
  }
}
