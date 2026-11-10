import type { JsonValue } from "@getpaseo/protocol/agent-types";
interface PreviewBudget {
  nodes: number;
  characters: number;
  seen: WeakSet<object>;
}
function bounded(value: unknown, depth: number, budget: PreviewBudget): JsonValue {
  if (++budget.nodes > 128 || budget.characters <= 0) return "[More content in chat]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.slice(0, Math.min(4000, budget.characters));
    budget.characters -= text.length;
    return text;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value || typeof value !== "object") return null;
  if (depth >= 4) return "[More content in chat]";
  if (budget.seen.has(value)) return "[More content in chat]";
  budget.seen.add(value);
  if (Array.isArray(value))
    return value.slice(0, 16).map((item) => bounded(item, depth + 1, budget));
  const result: Record<string, JsonValue> = {};
  let count = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (count++ >= 24) break;
    result[key.slice(0, 120)] = bounded(Reflect.get(value, key), depth + 1, budget);
  }
  return result;
}
/** Generic provider tool details remain available as bounded excerpts. */
export function visualizerDataPreview(value: unknown) {
  if (value === undefined) return "";
  try {
    return JSON.stringify(
      bounded(value, 0, { nodes: 0, characters: 12000, seen: new WeakSet() }),
    ).slice(0, 12000);
  } catch {
    return "Preview unavailable; open the chat for this tool result.";
  }
}
