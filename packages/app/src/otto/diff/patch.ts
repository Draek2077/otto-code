import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import {
  buildStructuralDiffRows,
  getStructuralDiffUnavailableReason,
  isSyntaxFormattingOnly,
  type StructuralDiffInput,
  type StructuralDiffLine,
} from "./structural";

interface SourceLine {
  line: Pick<StructuralDiffLine, "type" | "content">;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

interface SourceHunk<T extends SourceLine> {
  hunkHeader: string;
  lines: readonly T[];
}

type PatchRow<T extends SourceLine> =
  | { kind: "header"; hunkIndex: number }
  | { kind: "pair"; left: T | null; right: T | null };

function prefix(line: SourceLine["line"]) {
  switch (line.type) {
    case "remove":
      return `-${line.content}`;
    case "add":
      return `+${line.content}`;
    case "context":
      return ` ${line.content}`;
    default:
      return line.content;
  }
}

export function structuralPatchPlan<T extends SourceLine>(
  file: ParsedDiffFile,
  hunks: readonly SourceHunk<T>[],
) {
  const numbered: StructuralDiffLine[] = [];
  const original = new Map<StructuralDiffLine, T>();
  for (const hunk of hunks) {
    numbered.push({ type: "header", content: hunk.hunkHeader });
    for (const entry of hunk.lines) {
      if (entry.line.type === "header") continue;
      const line = {
        type: entry.line.type,
        content: prefix(entry.line),
        oldLineNumber: entry.oldLineNumber ?? undefined,
        newLineNumber: entry.newLineNumber ?? undefined,
      };
      numbered.push(line);
      original.set(line, entry);
    }
  }
  const input: StructuralDiffInput = {
    lines: numbered,
    filePath: file.path,
    beforeSource: file.structuralSource?.before,
    afterSource: file.structuralSource?.after,
  };
  const reason = getStructuralDiffUnavailableReason(input);
  if (reason) return { reason, rows: null, formattingOnly: false };
  let hunkIndex = 0;
  const rows = buildStructuralDiffRows(input).map((row): PatchRow<T> => {
    if (row.kind === "header") return { kind: "header", hunkIndex: hunkIndex++ };
    return {
      kind: "pair",
      left: row.left ? (original.get(row.left) ?? null) : null,
      right: row.right ? (original.get(row.right) ?? null) : null,
    };
  });
  return { reason: null, rows, formattingOnly: isSyntaxFormattingOnly(input) };
}
