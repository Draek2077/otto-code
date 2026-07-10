// Pure composition of the AI Refactor prompt. The dialog's whole job is to
// produce a tightly-scoped instruction that gets good results without
// exceeding what the user asked — so the scope guard is baked in here, not
// left to the model to infer. No React, no daemon; unit-tested in isolation.

export interface RefactorScope {
  /** Workspace-relative path of the file being refactored. */
  path: string;
  /** 1-based inclusive line range, or null for a whole-file refactor. */
  lineStart: number | null;
  lineEnd: number | null;
  /** The exact selected code, or null when refactoring the whole file. */
  selectedCode: string | null;
}

export interface BuildRefactorPromptInput {
  scope: RefactorScope;
  /** The user's plain-language instruction. */
  instruction: string;
}

const SCOPE_GUARD = [
  "Scope rules (follow strictly):",
  "- Change only what the instruction asks for, within the stated scope.",
  "- Do not reformat unrelated code, reorder imports, or fix unrelated issues.",
  "- Do not add, remove, or upgrade dependencies.",
  "- Preserve the file's existing style, indentation, and line endings.",
  "- If the instruction cannot be done safely within scope, explain why instead of guessing.",
].join("\n");

function describeScope(scope: RefactorScope): string {
  if (scope.lineStart && scope.lineEnd) {
    const range =
      scope.lineStart === scope.lineEnd
        ? `line ${scope.lineStart}`
        : `lines ${scope.lineStart}–${scope.lineEnd}`;
    return `Scope: \`${scope.path}\`, ${range}.`;
  }
  return `Scope: the whole file \`${scope.path}\`.`;
}

function codeFence(path: string, code: string): string {
  const language = path.split(".").pop()?.toLowerCase() ?? "";
  // Use a fence long enough to survive backticks inside the selection.
  const longestRun = (code.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}

export function isRefactorInstructionValid(instruction: string): boolean {
  return instruction.trim().length > 0;
}

/**
 * Compose the guarded refactor prompt. Throws on an empty instruction — the
 * dialog gates the confirm button on {@link isRefactorInstructionValid}, so
 * this is a defensive invariant, not a user-facing path.
 */
export function buildRefactorPrompt(input: BuildRefactorPromptInput): string {
  const instruction = input.instruction.trim();
  if (!instruction) {
    throw new Error("Refactor instruction is required");
  }
  const parts = [
    `Refactor request for \`${input.scope.path}\`.`,
    "",
    describeScope(input.scope),
    "",
    `Instruction: ${instruction}`,
  ];
  if (input.scope.selectedCode != null && input.scope.selectedCode.trim().length > 0) {
    parts.push("", "Selected code:", codeFence(input.scope.path, input.scope.selectedCode));
  }
  parts.push("", SCOPE_GUARD);
  return parts.join("\n");
}
