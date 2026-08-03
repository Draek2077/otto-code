// These SDK internals are reachable through @modelcontextprotocol/sdk's wildcard export,
// not a curated public subpath. Keep that package pinned exactly and re-verify these
// paths on every SDK bump so native host-tool schemas stay byte-compatible.
import {
  normalizeObjectSchema,
  type AnySchema,
  type ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";

import type { OttoToolDefinition, OttoToolResult } from "./types.js";

const EMPTY_OBJECT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {},
};

/**
 * Hard cap on the model-visible text of an Otto tool result. Previously
 * uncapped, so a large structuredContent dump entered the transcript verbatim
 * and was replayed on every round. Matches the MCP builtin cap (~30K) with a
 * head-heavy head/tail window and a clear truncation marker.
 *
 * openai-compat keeps its own copy of these constants for the non-MCP tool
 * loop; the two are deliberately independent.
 */
const RESULT_HEAD_CHARS = 26_000;
const RESULT_TAIL_CHARS = 4_000;

function truncateHeadTail(text: string, headChars: number, tailChars: number): string {
  if (text.length <= headChars + tailChars) {
    return text;
  }
  const removed = text.length - headChars - tailChars;
  return `${text.slice(0, headChars)}\n[... ${removed} characters truncated ...]\n${text.slice(
    -tailChars,
  )}`;
}

function formatStructuredContentForModel(structuredContent: unknown): string {
  if (
    !structuredContent ||
    typeof structuredContent !== "object" ||
    Array.isArray(structuredContent)
  ) {
    // Compact JSON: the model reads it fine and 2-space indentation was pure
    // token inflation replayed every round.
    return truncateHeadTail(
      JSON.stringify(structuredContent),
      RESULT_HEAD_CHARS,
      RESULT_TAIL_CHARS,
    );
  }

  const record = structuredContent as Record<string, unknown>;
  const summary: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (!Array.isArray(value)) {
      continue;
    }
    summary.push(`${key}_count=${value.length}`);
    const ids = value
      .map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>).id
          : null,
      )
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (ids.length === value.length && ids.length > 0) {
      summary.push(`${key}_ids=${ids.join(",")}`);
    }
  }

  const json = JSON.stringify(structuredContent);
  const combined = summary.length > 0 ? `${summary.join("\n")}\n\n${json}` : json;
  return truncateHeadTail(combined, RESULT_HEAD_CHARS, RESULT_TAIL_CHARS);
}

export function addModelVisibleStructuredContent(result: OttoToolResult): OttoToolResult {
  if (result.structuredContent === undefined || result.content.length > 0) {
    return result;
  }

  return {
    ...result,
    content: [
      {
        type: "text",
        text: formatStructuredContentForModel(result.structuredContent),
      },
    ],
  };
}

export function serializeOttoToolInputParameters(
  tool: OttoToolDefinition,
): Record<string, unknown> {
  const schema = normalizeObjectSchema(
    tool.inputSchema as AnySchema | ZodRawShapeCompat | undefined,
  );
  return schema
    ? toJsonSchemaCompat(schema, {
        strictUnions: true,
        pipeStrategy: "input",
      })
    : { ...EMPTY_OBJECT_JSON_SCHEMA };
}
