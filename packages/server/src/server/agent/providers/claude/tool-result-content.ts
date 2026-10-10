// Flattens a Claude tool_result `content` payload into the string Otto records
// on the tool call: plain text blocks are joined as-is, and anything else is
// serialized deterministically (sorted keys, cycle- and bigint-safe) so the
// same payload always yields the same string.

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isToolResultTextBlock(value: unknown): value is { type: "text"; text: string } {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "text" &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

function normalizeForDeterministicString(value: unknown, seen: WeakSet<object>): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "function") {
    return "[function]";
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  if (typeof value === "undefined") {
    return "[undefined]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForDeterministicString(entry, seen));
  }
  if (typeof value === "object") {
    const objectValue = value;
    if (seen.has(objectValue)) {
      return "[circular]";
    }
    seen.add(objectValue);
    const record = toObjectRecord(value);
    if (!record) {
      seen.delete(objectValue);
      return "[invalid]";
    }
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      normalized[key] = normalizeForDeterministicString(record[key], seen);
    }
    seen.delete(objectValue);
    return normalized;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "[unsupported]";
}

function deterministicStringify(value: unknown): string {
  if (typeof value === "undefined") {
    return "";
  }
  try {
    const normalized = normalizeForDeterministicString(value, new WeakSet<object>());
    if (typeof normalized === "string") {
      return normalized;
    }
    return JSON.stringify(normalized);
  } catch {
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return "[unserializable]";
  }
}

export function coerceToolResultContentToString(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content) && content.every((block) => isToolResultTextBlock(block))) {
    return content.map((block) => block.text).join("");
  }
  return deterministicStringify(content);
}
