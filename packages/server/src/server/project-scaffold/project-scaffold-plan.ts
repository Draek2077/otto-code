import type {
  ProjectScaffoldGit,
  ProjectScaffoldGitignoreTemplateId,
} from "@otto-code/protocol/messages";
import { PROJECT_SCAFFOLD_GITIGNORE_TEMPLATE_IDS } from "@otto-code/protocol/messages";

// Pure decisions the scaffold makes before it touches the filesystem: what the
// folder is called, whether that name is legal, and which steps will run. Kept
// separate from the service so every branch is testable without a temp dir.

export type ProjectScaffoldStepId =
  | "create_directory"
  | "git_clone"
  | "git_init"
  | "starter_files"
  | "initial_commit"
  | "create_remote"
  | "push"
  | "register_project";

export type ProjectScaffoldNameError =
  | "empty"
  | "path_separator"
  | "relative_segment"
  | "reserved_character"
  | "reserved_name"
  | "trailing_dot_or_space";

// Windows forbids these in a path component; POSIX allows most of them, but a
// project created on one host is routinely opened from another, so the stricter
// rule is applied everywhere rather than producing names that break on sync.
// Spaces and hyphens are legal on both and stay allowed — only the genuinely
// unusable punctuation and control characters are rejected.
const RESERVED_PUNCTUATION = /[<>:"|?*]/;

// Checked by code point rather than a regex class so the source carries no
// literal control bytes.
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

// Windows device names, matched without their extension and case-insensitively.
const RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

export function validateProjectFolderName(name: string): ProjectScaffoldNameError | null {
  if (!name.trim()) {
    return "empty";
  }
  if (name.includes("/") || name.includes("\\")) {
    return "path_separator";
  }
  if (name === "." || name === "..") {
    return "relative_segment";
  }
  if (RESERVED_PUNCTUATION.test(name) || hasControlCharacter(name)) {
    return "reserved_character";
  }
  // Windows silently strips these, so "foo." and "foo" would collide.
  if (/[. ]$/.test(name)) {
    return "trailing_dot_or_space";
  }
  const withoutExtension = name.split(".")[0]?.toLowerCase() ?? "";
  if (RESERVED_NAMES.has(withoutExtension)) {
    return "reserved_name";
  }
  return null;
}

// `git clone <url>` with no target derives the directory from the URL's last
// segment minus a `.git` suffix. Mirror that so the client can preview the
// folder name before the clone runs, and so the daemon knows where it landed.
export function deriveFolderNameFromRepositoryUrl(url: string): string | null {
  const trimmed = url.trim().replace(/[/\\]+$/, "");
  if (!trimmed) {
    return null;
  }
  // Handles https://host/owner/name.git, git@host:owner/name.git, and
  // ssh://git@host/owner/name — all end in the segment we want. Backslash is in
  // the set because git also clones from a local path, which on Windows is
  // `C:\src\name`.
  const lastSegment = trimmed.split(/[/\\:]/).pop() ?? "";
  const withoutGitSuffix = lastSegment.replace(/\.git$/i, "");
  return withoutGitSuffix || null;
}

export interface ResolveFolderNameResult {
  folderName: string | null;
  error: ProjectScaffoldNameError | null;
}

// The folder name is explicit for every path except a clone, where it may be
// left to the repository URL.
export function resolveProjectFolderName(input: {
  folderName: string | undefined;
  git: ProjectScaffoldGit;
}): ResolveFolderNameResult {
  const explicit = input.folderName?.trim() ?? "";
  if (explicit) {
    const error = validateProjectFolderName(explicit);
    return { folderName: error ? null : explicit, error };
  }
  if (input.git.kind !== "clone") {
    return { folderName: null, error: "empty" };
  }
  const derived = deriveFolderNameFromRepositoryUrl(input.git.url);
  if (!derived) {
    return { folderName: null, error: "empty" };
  }
  const error = validateProjectFolderName(derived);
  return { folderName: error ? null : derived, error };
}

// The ordered step list for a given request. The service reports progress
// against exactly this list, so the UI can render the full sequence up front
// instead of discovering steps as they start.
export function buildProjectScaffoldStepPlan(git: ProjectScaffoldGit): ProjectScaffoldStepId[] {
  if (git.kind === "clone") {
    // Clone creates the directory itself; a pre-made one would make git refuse.
    return ["git_clone", "register_project"];
  }
  if (git.kind === "none") {
    return ["create_directory", "register_project"];
  }

  const steps: ProjectScaffoldStepId[] = ["create_directory", "git_init"];
  const hasStarterFiles = Boolean(git.addReadme) || Boolean(git.gitignoreTemplate);
  if (hasStarterFiles) {
    steps.push("starter_files");
  }
  // A push needs a commit to push. Requesting a remote implies the commit even
  // when the client didn't ask for one, rather than failing late at the push.
  if (git.initialCommit || git.remote) {
    steps.push("initial_commit");
  }
  if (git.remote) {
    steps.push("create_remote", "push");
  }
  steps.push("register_project");
  return steps;
}

export function isProjectScaffoldGitignoreTemplateId(
  value: string,
): value is ProjectScaffoldGitignoreTemplateId {
  return (PROJECT_SCAFFOLD_GITIGNORE_TEMPLATE_IDS as readonly string[]).includes(value);
}

// Deliberately short starters — enough that a fresh repo doesn't commit build
// output on its first commit, not a mirror of github/gitignore.
const GITIGNORE_TEMPLATES: Record<ProjectScaffoldGitignoreTemplateId, string> = {
  node: ["node_modules/", "dist/", "build/", ".env", ".env.local", "*.log", ".DS_Store"].join("\n"),
  python: [
    "__pycache__/",
    "*.py[cod]",
    ".venv/",
    "venv/",
    "dist/",
    "build/",
    "*.egg-info/",
    ".env",
    ".DS_Store",
  ].join("\n"),
  go: ["bin/", "vendor/", "*.exe", "*.test", "*.out", ".env", ".DS_Store"].join("\n"),
  rust: ["target/", "**/*.rs.bk", "Cargo.lock", ".env", ".DS_Store"].join("\n"),
  java: ["target/", "build/", ".gradle/", "*.class", "*.jar", "*.war", ".env", ".DS_Store"].join(
    "\n",
  ),
  dotnet: ["bin/", "obj/", "*.user", "*.suo", ".vs/", "TestResults/", ".env", ".DS_Store"].join(
    "\n",
  ),
};

export function getGitignoreTemplateContent(templateId: string): string | null {
  if (!isProjectScaffoldGitignoreTemplateId(templateId)) {
    return null;
  }
  return `${GITIGNORE_TEMPLATES[templateId]}\n`;
}

// A README whose only job is to make the first commit non-empty and give the
// repo a title. Anything more opinionated belongs to the user's own template.
export function buildReadmeContent(projectName: string): string {
  return `# ${projectName}\n`;
}
