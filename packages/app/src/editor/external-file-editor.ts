import type { TerminalCompatibilityDiagnosticResponse } from "@otto-code/protocol/messages";

export const FILE_EDITOR_MODES = ["off", "vim", "neovim", "custom"] as const;
export type FileEditorMode = (typeof FILE_EDITOR_MODES)[number];

export interface ExternalFileEditorCommand {
  command: string;
  args: string[];
}

export interface ExternalFileEditorIdentity {
  serverId: string;
  workspaceId: string;
  path: string;
}

const activeExternalFileEditors = new Map<string, number>();

export function buildExternalFileEditorPresentationOwner(input: {
  workspaceId: string;
  absolutePath: string;
}): string {
  return `otto.file-editor:${encodeURIComponent(input.workspaceId)}:${encodeURIComponent(input.absolutePath)}`;
}

function externalFileEditorRegistryKey(input: ExternalFileEditorIdentity): string {
  return `${encodeURIComponent(input.serverId)}:${encodeURIComponent(input.workspaceId)}:${encodeURIComponent(input.path.replace(/\\/gu, "/"))}`;
}

export function registerActiveExternalFileEditor(input: ExternalFileEditorIdentity): () => void {
  const key = externalFileEditorRegistryKey(input);
  activeExternalFileEditors.set(key, (activeExternalFileEditors.get(key) ?? 0) + 1);
  return () => {
    const remaining = (activeExternalFileEditors.get(key) ?? 1) - 1;
    if (remaining > 0) {
      activeExternalFileEditors.set(key, remaining);
    } else {
      activeExternalFileEditors.delete(key);
    }
  };
}

export function hasActiveExternalFileEditor(input: ExternalFileEditorIdentity): boolean {
  return activeExternalFileEditors.has(externalFileEditorRegistryKey(input));
}

type DiagnosticPayload = TerminalCompatibilityDiagnosticResponse["payload"];

/**
 * Parse a command preference into argv without invoking a shell. The terminal
 * worker receives the executable and arguments separately, so shell operators
 * cannot turn this file action into an unrelated command.
 */
export function parseExternalEditorCommand(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s]+)/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const token = match[1] ?? match[2] ?? match[3] ?? "";
    tokens.push(token.replace(/\\([\\"'])/gu, "$1"));
  }
  return tokens;
}

export function resolveExternalFileEditorCommand(input: {
  mode: FileEditorMode;
  customCommand: string;
  path: string;
}): ExternalFileEditorCommand | null {
  if (input.mode === "off") {
    return null;
  }
  let tokens: string[];
  if (input.mode === "vim") {
    tokens = ["vim"];
  } else if (input.mode === "neovim") {
    tokens = ["nvim"];
  } else {
    tokens = parseExternalEditorCommand(input.customCommand);
  }
  if (tokens.length === 0 || !tokens[0]) {
    return null;
  }
  const pathArgs =
    input.mode === "vim" || input.mode === "neovim" ? ["--", input.path] : [input.path];
  return { command: tokens[0], args: [...tokens.slice(1), ...pathArgs] };
}

export function resolveExternalEditorCapability(
  payload: DiagnosticPayload,
  mode: Exclude<FileEditorMode, "off" | "custom">,
): string | null {
  const executable = mode === "vim" ? "vim" : "nvim";
  const check = payload.checks.find((candidate) => candidate.id === executable);
  if (payload.success && check?.status === "pass") {
    return null;
  }
  if (check?.status === "fail") {
    return `${executable} is not available on the Otto host. Install it or choose Custom in Settings > Editor.`;
  }
  return `Otto could not verify ${executable} on the host. Run Terminal compatibility again and retry.`;
}
