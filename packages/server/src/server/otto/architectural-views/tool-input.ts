import { z } from "zod";
import { ViewRevision, parseViewSpecification } from "@getpaseo/plugin/otto/architectural-views";
import { ArchitecturalViewError } from "./specification.js";
/** A shallow model-facing object avoids recursive MCP-schema references and
 * allows the explicit bounded walk to run before recursive JSON validation. */
export const viewDraftToolInput = z
  .object({
    expectedRevision: ViewRevision,
    specification: z.record(z.string(), z.unknown()),
    title: z.string().min(1).max(200).optional(),
  })
  .strict();
export function viewToolSpecification(value: unknown) {
  try {
    return parseViewSpecification(value);
  } catch (cause) {
    throw new ArchitecturalViewError(
      "invalid",
      cause instanceof Error ? cause.message.slice(0, 500) : "The View source is invalid.",
      { cause },
    );
  }
}
