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
  lines: readonly T[],
) {
  const numbered = lines.map(
    (entry): StructuralDiffLine => ({
      type: entry.line.type,
      content: prefix(entry.line),
      oldLineNumber: entry.oldLineNumber ?? undefined,
      newLineNumber: entry.newLineNumber ?? undefined,
    }),
  );
  const input: StructuralDiffInput = {
    lines: numbered,
    filePath: file.path,
    beforeSource: file.structuralSource?.before,
    afterSource: file.structuralSource?.after,
  };
  const reason = getStructuralDiffUnavailableReason(input);
  if (reason) return { reason, pairs: null, formattingOnly: false };
  const original = new Map(numbered.map((line, index) => [line, lines[index]]));
  return {
    reason: null,
    formattingOnly: isSyntaxFormattingOnly(input),
    pairs: buildStructuralDiffRows(input).flatMap((row) =>
      row.kind === "header"
        ? []
        : [
            {
              left: row.left ? (original.get(row.left) ?? null) : null,
              right: row.right ? (original.get(row.right) ?? null) : null,
            },
          ],
    ),
  };
}
