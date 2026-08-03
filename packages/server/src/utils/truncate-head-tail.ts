/**
 * Head/tail truncation for model-visible text.
 *
 * Every one of these call sites is a place where model-produced text (a final
 * message, a curated timeline, a schedule run's output) is stored or replayed
 * into another model's context. Keeping the head (how it started) and a tail
 * (how it ended) with an explicit marker is the house style: never drop
 * silently, and never leave the size to whatever the model happened to write.
 *
 * `otto-tool-serialization.ts` and `openai-compat-agent.ts` keep their own
 * copies for the two tool-result serializers; those are deliberately
 * independent of this helper so a change to one cap cannot move the other.
 */
export interface TruncateHeadTailInput {
  text: string;
  headChars: number;
  tailChars: number;
  /** Appended to the marker, e.g. "call get_agent_activity for the full message". */
  note?: string;
}

export function truncateHeadTail(input: TruncateHeadTailInput): string {
  const { text, headChars, tailChars, note } = input;
  if (text.length <= headChars + tailChars) {
    return text;
  }
  const removed = text.length - headChars - tailChars;
  const suffix = note ? `; ${note}` : "";
  return (
    `${text.slice(0, headChars)}\n` +
    `[... ${removed} characters truncated${suffix} ...]\n` +
    `${tailChars > 0 ? text.slice(-tailChars) : ""}`
  );
}
