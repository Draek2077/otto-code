/** Stable source and subsystem markers for the one Brain service-session log. */
export type BrainLogArea = "library" | "model" | "api" | "server";

const LLAMA_SERVER_PREFIX = /^\d+(?:\.\d+){3}\s+[A-Z]\s+\S+\s+(?:\S+:\s+)?(.+)$/u;

const SOURCES = ["brain", "llama-server"] as const;
const AREAS = ["library", "model", "api", "server"] as const;

function taggedValue(line: string, values: readonly string[]): string | null {
  for (const value of values) {
    const tag = `[${value}]`;
    if (line.startsWith(tag)) return tag;
  }
  return null;
}

/**
 * Every service-owned event carries both its process source and operation area.
 * llama-server output is separately marked by `formatLlamaServerLog`.
 */
export function formatBrainLog(area: BrainLogArea, message: string): string {
  return taggedValue(message, SOURCES) ? message : `[brain] [${area}] ${message}`;
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
  return taggedValue(message, SOURCES)
    ? message
    : `[llama-server] ${stripLlamaServerPrefix(message)}`;
}

/** Place source tags ahead of the timestamp so they are scannable in a dense log. */
export function timestampBrainLogLine(timestamp: string, line: string): string {
  const tagged = formatBrainLog("server", line);
  const source = taggedValue(tagged, SOURCES);
  if (!source) return `${timestamp} ${tagged}`;
  let remainder = tagged.slice(source.length).trimStart();
  const area = taggedValue(remainder, AREAS);
  if (area) remainder = remainder.slice(area.length).trimStart();
  const message = remainder;
  return `${source}${area ? ` ${area}` : ""} ${timestamp}${message ? ` ${message}` : ""}`;
}
