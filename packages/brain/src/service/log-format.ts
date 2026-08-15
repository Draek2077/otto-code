/** Stable source and subsystem markers for the one Brain service-session log. */
export type BrainLogArea = "library" | "model" | "api" | "server";

const TAGGED_LINE = /^\[(?:brain|llama-server)\]/u;
const SOURCE_AND_AREA =
  /^(\[(?:brain|llama-server)\])(?:\s+(\[(?:library|model|api|server)\]))?\s*(.*)$/u;
const LLAMA_SERVER_PREFIX = /^\d+(?:\.\d+){3}\s+[A-Z]\s+\S+\s+(?:\S+:\s+)?(.+)$/u;

/**
 * Every service-owned event carries both its process source and operation area.
 * llama-server output is separately marked by `formatLlamaServerLog`.
 */
export function formatBrainLog(area: BrainLogArea, message: string): string {
  return TAGGED_LINE.test(message) ? message : `[brain] [${area}] ${message}`;
}

/**
 * Remove llama.cpp's elapsed-time, level and component columns. Otto owns the
 * timestamp and source marker, and the remaining message is what an operator
 * needs to diagnose the runtime.
 */
export function stripLlamaServerPrefix(message: string): string {
  return LLAMA_SERVER_PREFIX.exec(message)?.[1] ?? message;
}

/** Preserve the useful llama.cpp message while making its process boundary explicit. */
export function formatLlamaServerLog(message: string): string {
  return TAGGED_LINE.test(message) ? message : `[llama-server] ${stripLlamaServerPrefix(message)}`;
}

/** Place source tags ahead of the timestamp so they are scannable in a dense log. */
export function timestampBrainLogLine(timestamp: string, line: string): string {
  const tagged = formatBrainLog("server", line);
  const match = SOURCE_AND_AREA.exec(tagged);
  if (!match) return `${timestamp} ${tagged}`;
  const [, source, area, message] = match;
  return `${source}${area ? ` ${area}` : ""} ${timestamp}${message ? ` ${message}` : ""}`;
}
