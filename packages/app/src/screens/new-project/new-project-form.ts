import type { ProjectScaffoldGit } from "@otto-code/protocol/messages";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";

// The New project page's form model, kept out of the component so every rule —
// which fields a mode needs, when Create is allowed, what the resulting git
// request looks like — is testable without rendering.

// What the user is doing. "open" is the pre-existing behaviour (adopt a folder
// that is already on the host); the rest are the scaffolding paths.
export type NewProjectMode = "open" | "create" | "clone";

// Within "create", how much git setup to do. Kept separate from the mode so the
// page can present it as a second, smaller choice rather than a 5-way switch.
export type NewProjectGitSetup = "none" | "init" | "remote";

export interface NewProjectFormState {
  mode: NewProjectMode;
  // "open": the directory to adopt. Otherwise: the parent to create inside.
  directory: string;
  // Folder to create. Unused by "open"; optional for "clone" (derived from URL).
  folderName: string;
  gitSetup: NewProjectGitSetup;
  initialBranch: string;
  addReadme: boolean;
  gitignoreTemplate: string | null;
  // Remote creation (gitSetup === "remote").
  remoteProvider: string | null;
  remoteOwner: string | null;
  remoteName: string;
  remoteVisibility: "private" | "public";
  remoteDescription: string;
  // Clone source.
  cloneUrl: string;
}

export function createNewProjectFormState(): NewProjectFormState {
  return {
    mode: "open",
    directory: "",
    folderName: "",
    gitSetup: "init",
    initialBranch: "main",
    addReadme: true,
    gitignoreTemplate: null,
    remoteProvider: null,
    remoteOwner: null,
    remoteName: "",
    remoteVisibility: "private",
    remoteDescription: "",
    cloneUrl: "",
  };
}

// Why Create is disabled. The page shows this next to the offending field
// rather than a generic "fill in the form".
export type NewProjectBlocker =
  | "directory_required"
  | "folder_name_required"
  | "clone_url_required"
  | "remote_provider_required"
  | "remote_name_required"
  | "remote_owner_required"
  | "scaffold_unsupported";

export interface NewProjectCapabilities {
  // server_info.features.projectScaffold
  canScaffold: boolean;
  // Providers that reported the createRepository capability and are connected.
  remoteCapableProviders: readonly string[];
  // Providers that require an explicit owner — Bitbucket has no implicit
  // "authenticated user's namespace" the daemon could fall back to.
  providersRequiringOwner: readonly string[];
}

export function getNewProjectBlocker(
  state: NewProjectFormState,
  capabilities: NewProjectCapabilities,
): NewProjectBlocker | null {
  if (state.mode !== "open" && !capabilities.canScaffold) {
    return "scaffold_unsupported";
  }
  if (!state.directory.trim()) {
    return "directory_required";
  }
  if (state.mode === "open") {
    return null;
  }
  if (state.mode === "clone") {
    return state.cloneUrl.trim() ? null : "clone_url_required";
  }

  if (!state.folderName.trim()) {
    return "folder_name_required";
  }
  if (state.gitSetup !== "remote") {
    return null;
  }
  const provider = state.remoteProvider?.trim() ?? "";
  if (!provider || !capabilities.remoteCapableProviders.includes(provider)) {
    return "remote_provider_required";
  }
  if (!resolveRemoteRepositoryName(state)) {
    return "remote_name_required";
  }
  if (capabilities.providersRequiringOwner.includes(provider) && !state.remoteOwner?.trim()) {
    return "remote_owner_required";
  }
  return null;
}

// The remote repository defaults to the folder name — the overwhelmingly common
// case — and only diverges when the user edits it.
export function resolveRemoteRepositoryName(state: NewProjectFormState): string {
  return state.remoteName.trim() || state.folderName.trim();
}

// Translates the form into the wire shape. Returns null when the form is not
// submittable, so callers can't accidentally send a half-filled request.
export function buildScaffoldGitRequest(
  state: NewProjectFormState,
  capabilities: NewProjectCapabilities,
): ProjectScaffoldGit | null {
  if (state.mode === "open" || getNewProjectBlocker(state, capabilities)) {
    return null;
  }

  if (state.mode === "clone") {
    return { kind: "clone", url: state.cloneUrl.trim() };
  }

  if (state.gitSetup === "none") {
    return { kind: "none" };
  }

  const base = {
    kind: "init" as const,
    initialBranch: state.initialBranch.trim() || undefined,
    addReadme: state.addReadme,
    gitignoreTemplate: state.gitignoreTemplate ?? undefined,
    // A remote implies a commit; the daemon enforces this too, but sending the
    // honest intent keeps the step plan the client renders accurate up front.
    initialCommit: true,
  };

  if (state.gitSetup !== "remote") {
    return base;
  }

  return {
    ...base,
    remote: {
      providerId: state.remoteProvider!.trim(),
      owner: state.remoteOwner?.trim() || null,
      name: resolveRemoteRepositoryName(state),
      description: state.remoteDescription.trim() || undefined,
      visibility: state.remoteVisibility,
    },
  };
}

// Adding a folder that is already a project is a no-op the daemon accepts
// silently — `findOrCreateProjectForDirectory` just returns the existing record,
// so the page would close as if it had done something. Catch it here instead and
// say so, the way New workspace refuses an occupied directory.
//
// Checked against the *target* path, so it also catches "create a folder that is
// already a project" and "clone into one" before any of it runs.
export function findDuplicateProjectPath(input: {
  targetPath: string | null;
  existingProjectPaths: readonly string[];
}): string | null {
  const target = normalizeWorkspacePath(input.targetPath);
  if (!target) {
    return null;
  }
  const match = input.existingProjectPaths.find(
    (candidate) => normalizeWorkspacePath(candidate) === target,
  );
  return match ?? null;
}

// Which separator to join with. The client cannot know the daemon's platform,
// but the directory the user typed or browsed already tells us which convention
// that host writes — so match it rather than picking one. Joining a Windows
// directory with "/" produced `C:\Users\me\Projects/thing`, which reads as a
// bug even though the daemon would accept it.
export function detectPathSeparator(directory: string): "/" | "\\" {
  if (directory.includes("\\")) {
    return "\\";
  }
  // A bare drive letter ("C:") has no separator to copy, but is still Windows.
  return /^[a-zA-Z]:$/.test(directory.trim()) ? "\\" : "/";
}

// Preview of where the project will land, shown under the folder-name field so
// the user sees the full path before committing to it.
export function previewProjectPath(state: NewProjectFormState): string | null {
  const directory = state.directory.trim();
  if (!directory) {
    return null;
  }
  if (state.mode === "open") {
    return directory;
  }
  const folderName =
    state.folderName.trim() ||
    (state.mode === "clone" ? deriveFolderNameFromCloneUrl(state.cloneUrl) : "");
  if (!folderName) {
    return null;
  }
  const trimmedDirectory = directory.replace(/[/\\]+$/, "");
  return `${trimmedDirectory}${detectPathSeparator(directory)}${folderName}`;
}

// Mirrors the daemon's own derivation (deriveFolderNameFromRepositoryUrl) so
// the path preview matches where the clone actually lands.
export function deriveFolderNameFromCloneUrl(url: string): string {
  const trimmed = url.trim().replace(/[/\\]+$/, "");
  if (!trimmed) {
    return "";
  }
  const lastSegment = trimmed.split(/[/\\:]/).pop() ?? "";
  return lastSegment.replace(/\.git$/i, "");
}
