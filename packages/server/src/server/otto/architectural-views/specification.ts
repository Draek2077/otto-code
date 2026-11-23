import { createHash } from "node:crypto";
import { ViewSpecification, type ViewKind } from "@getpaseo/plugin/otto/architectural-views";

export class ArchitecturalViewError extends Error {
  constructor(
    readonly code:
      | "wrong_host"
      | "not_found"
      | "invalid"
      | "conflict"
      | "busy"
      | "unavailable"
      | "unknown",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ArchitecturalViewError";
  }
}
export function viewDigest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
export function specificationText(kind: ViewKind, value: unknown): string {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++count > 50000 || item.depth > 32)
      throw new ArchitecturalViewError("invalid", "The View exceeds its structural budget.");
    if (item.value === null || typeof item.value !== "object") continue;
    for (const [key, child] of Object.entries(item.value)) {
      if (key === "brand")
        throw new ArchitecturalViewError(
          "invalid",
          "Use semantic component kinds instead of external brand artwork.",
        );
      pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  const parsed = ViewSpecification.parse(value);
  if (parsed.diagram_type !== undefined && parsed.diagram_type !== kind)
    throw new ArchitecturalViewError("invalid", "The specification does not match this View type.");
  // Otto 0.9 receipts hash the pretty-printed JSON value without a final newline.
  // Keep that canonical identity so reading a retained source never rewrites it.
  const text = JSON.stringify(parsed, null, 2);
  if (Buffer.byteLength(text) > 524288)
    throw new ArchitecturalViewError("invalid", "View specifications are limited to 512 KiB.");
  return text;
}
