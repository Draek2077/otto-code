import { existsSync, statSync } from "node:fs";
import path from "node:path";

const OPEN_PROJECT_FLAG = "--open-project";
// Distinct from --open-project: this is what the OS "Open with Otto" folder
// integrations (Windows installer.nsh context-menu commands, etc.) invoke.
// Unlike --open-project, which adds the folder as a project with no
// questions asked (a capability CLI/scripted callers rely on), this flag
// routes through OpenTargetListener's duplicate-check -> New Project page
// flow so a brand-new folder gets a chance to configure git setup first.
const OPEN_WITH_OTTO_FLAG = "--open-with-otto";
const OPEN_PROJECT_IGNORED_ARG_PREFIXES = ["-psn_", "--no-sandbox"];

function isExistingDirectoryAbsolutePath(candidate: string): boolean {
  if (!path.isAbsolute(candidate) || !existsSync(candidate)) {
    return false;
  }

  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isExistingFileAbsolutePath(candidate: string): boolean {
  if (!path.isAbsolute(candidate) || !existsSync(candidate)) {
    return false;
  }

  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function effectiveArgsFrom(input: { argv: string[]; isDefaultApp: boolean }): string[] {
  return input.argv
    .slice(input.isDefaultApp ? 2 : 1)
    .filter((arg) => !OPEN_PROJECT_IGNORED_ARG_PREFIXES.some((prefix) => arg.startsWith(prefix)));
}

export function parseOpenProjectPathFromArgv(input: {
  argv: string[];
  isDefaultApp: boolean;
}): string | null {
  const effectiveArgs = effectiveArgsFrom(input);

  const positionalProjectPath = effectiveArgs.find(
    (arg) => !arg.startsWith("-") && isExistingDirectoryAbsolutePath(arg),
  );
  if (positionalProjectPath) {
    return positionalProjectPath;
  }

  const openProjectIndex = effectiveArgs.indexOf(OPEN_PROJECT_FLAG);
  if (openProjectIndex === -1) {
    return null;
  }

  const flaggedProjectPath = effectiveArgs[openProjectIndex + 1];
  return flaggedProjectPath && isExistingDirectoryAbsolutePath(flaggedProjectPath)
    ? flaggedProjectPath
    : null;
}

export type OpenTargetKind = "directory-shell" | "file";

export interface OpenTarget {
  kind: OpenTargetKind;
  path: string;
}

// Parses the OS "Open with Otto" entry points: --open-with-otto <dir> from
// the Windows/Linux shell-integration commands, or a bare file path (a
// directory positional is already claimed by parseOpenProjectPathFromArgv
// above, so only a file here is unambiguous). Kept fully separate from
// parseOpenProjectPathFromArgv so the existing --open-project/CLI
// auto-addProject behavior is never affected by this parser.
export function parseOpenTargetFromArgv(input: {
  argv: string[];
  isDefaultApp: boolean;
}): OpenTarget | null {
  const effectiveArgs = effectiveArgsFrom(input);

  const openWithOttoIndex = effectiveArgs.indexOf(OPEN_WITH_OTTO_FLAG);
  if (openWithOttoIndex !== -1) {
    const flaggedPath = effectiveArgs[openWithOttoIndex + 1];
    if (flaggedPath && isExistingDirectoryAbsolutePath(flaggedPath)) {
      return { kind: "directory-shell", path: flaggedPath };
    }
    return null;
  }

  const positionalFilePath = effectiveArgs.find(
    (arg) => !arg.startsWith("-") && isExistingFileAbsolutePath(arg),
  );
  if (positionalFilePath) {
    return { kind: "file", path: positionalFilePath };
  }

  return null;
}
