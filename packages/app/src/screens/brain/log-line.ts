export type BrainLogSource = "brain" | "llama-server";
export type BrainLogArea = "library" | "model" | "api" | "server";

export interface ParsedBrainLogLine {
  timestamp: string | null;
  source: BrainLogSource | null;
  area: BrainLogArea | null;
  message: string;
}

const TAGGED_LOG_LINE =
  /^(?:(\S+)\s+)?\[(brain|llama-server)\](?:\s+\[(library|model|api|server)\])?\s*(.*)$/u;
const FRONT_TAGGED_LOG_LINE =
  /^\[(brain|llama-server)\](?:\s+\[(library|model|api|server)\])?\s+((?:\d{4}-\d{2}-\d{2}T\S+)|(?:\d{2}:\d{2}:\d{2}\.\d{3}))\s*(.*)$/u;

/** Parse additive source markers while leaving pre-tagged historical logs readable. */
export function parseBrainLogLine(line: string): ParsedBrainLogLine {
  const front = FRONT_TAGGED_LOG_LINE.exec(line);
  if (front) {
    return {
      timestamp: front[3],
      source: front[1] as BrainLogSource,
      area: (front[2] as BrainLogArea | undefined) ?? null,
      message: front[4],
    };
  }
  const match = TAGGED_LOG_LINE.exec(line);
  if (!match) return { timestamp: null, source: null, area: null, message: line };
  return {
    timestamp: match[1] ?? null,
    source: match[2] as BrainLogSource,
    area: (match[3] as BrainLogArea | undefined) ?? null,
    message: match[4],
  };
}
