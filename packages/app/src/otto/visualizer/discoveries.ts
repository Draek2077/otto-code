import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
export interface VisualizerDiscovery {
  type: "pattern" | "finding" | "code" | "error";
  label: string;
  content: string;
}
const line = (value: string, max = 44) => value.trim().replace(/\s+/gu, " ").slice(0, max);
const firstLines = (value: string) =>
  value
    .slice(0, 12000)
    .split("\n")
    .map((valueLine) => valueLine.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((valueLine) => line(valueLine))
    .join("\n");
/** Bounded excerpts of notable reported tool results, not generated findings or
 * test verdicts. Ordinary reads and child dispatches do not create extra cards. */
export function visualizerDiscovery(
  detail: ToolCallDetail,
  failed: boolean,
): VisualizerDiscovery | null {
  switch (detail.type) {
    case "write":
      return {
        type: "code",
        label: `New: ${line(detail.filePath, 40)}`,
        content: firstLines(detail.content ?? "Created"),
      };
    case "edit":
      return {
        type: "code",
        label: line(detail.filePath, 40),
        content: firstLines(detail.unifiedDiff ?? "Edited"),
      };
    case "search":
      return searchDiscovery(detail);
    case "fetch":
      return detail.result
        ? { type: "finding", label: line(detail.url, 40), content: firstLines(detail.result) }
        : null;
    case "shell":
      return shellDiscovery(detail, failed);
    default:
      return null;
  }
}
function searchDiscovery(
  detail: Extract<ToolCallDetail, { type: "search" }>,
): VisualizerDiscovery | null {
  if (detail.webResults?.length)
    return {
      type: "finding",
      label: line(detail.query, 40),
      content: detail.webResults
        .slice(0, 3)
        .map((result) => line(result.title))
        .join("\n"),
    };
  if (detail.numMatches === undefined && detail.numFiles === undefined) return null;
  const counts: string[] = [];
  if (detail.numMatches !== undefined) counts.push(`${detail.numMatches} matches`);
  if (detail.numFiles !== undefined) counts.push(`${detail.numFiles} files`);
  return {
    type: "pattern",
    label: line(detail.query, 40),
    content: [...counts, ...(detail.filePaths ?? []).slice(0, 3).map((path) => line(path))].join(
      "\n",
    ),
  };
}
function shellDiscovery(
  detail: Extract<ToolCallDetail, { type: "shell" }>,
  failed: boolean,
): VisualizerDiscovery | null {
  if (
    failed ||
    (detail.exitCode !== undefined && detail.exitCode !== null && detail.exitCode !== 0)
  )
    return {
      type: "error",
      label: "Command failed",
      content: firstLines(detail.output ?? detail.command),
    };
  const output = detail.output?.slice(0, 12000) ?? "";
  const results = output
    .split("\n")
    .filter((value) => /\b(?:tests?|passed|failed|coverage)\b/iu.test(value))
    .slice(0, 3);
  return results.length
    ? {
        type: "finding",
        label: "Test output",
        content: results.map((value) => line(value)).join("\n"),
      }
    : null;
}
