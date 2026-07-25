import {
  getOttoToolLeafName,
  normalizeToolName,
} from "@otto-code/protocol/tool-name-normalization";
import {
  WIDGET_METADATA_KEY,
  WIDGET_PAYLOAD_VERSION,
  WIDGET_TOOL_NAME,
  type WidgetPayload,
} from "@otto-code/protocol/widgets/types";

import type { AgentTimelineItem } from "../agent/agent-sdk-types.js";
import {
  WidgetFragmentError,
  sanitizeWidgetFragment,
  sanitizeWidgetLoadingMessages,
  sanitizeWidgetTitle,
} from "./widget-fragment.js";

/**
 * Turn a `show_widget` tool call into a renderable widget, provider-neutrally.
 *
 * This runs at `AgentManager.recordAndDispatchTimelineItem` — the one place
 * every timeline item passes through, on every provider, on both the direct
 * stream path and the coalescer's flush. Putting it there rather than in each
 * provider's tool-call mapper is what makes widgets a capability of Otto rather
 * than a capability of Claude: any provider that surfaces a tool call with its
 * input gets widgets with no per-provider code.
 *
 * The widget rides in `metadata`, never in `detail` — see the note on
 * WIDGET_METADATA_KEY for why a new detail variant would break old clients.
 * `detail` is downgraded to `plain_text` so a client that predates widgets
 * still shows a sensible row.
 */

interface WidgetToolInput {
  widget_code?: unknown;
  title?: unknown;
  loading_messages?: unknown;
}

function readToolInput(item: Extract<AgentTimelineItem, { type: "tool_call" }>): WidgetToolInput {
  const detail = item.detail;
  if (detail?.type === "unknown" && detail.input && typeof detail.input === "object") {
    return detail.input as WidgetToolInput;
  }
  return {};
}

function isWidgetToolCall(name: string): boolean {
  // Two shapes, because Otto's catalog reaches models two different ways.
  // Providers that host an MCP client see `mcp__otto__show_widget` (or the
  // dotted `otto.show_widget`); the openai-compat provider injects the catalog
  // natively into its own tool loop and exposes each tool under its BARE name
  // (see buildOttoToolPayload in openai-compat-agent.ts). Matching only the
  // namespaced form would have quietly given widgets to Claude and not to the
  // local-model provider — the exact single-provider gap this fork exists to
  // close.
  return (
    getOttoToolLeafName(name) === WIDGET_TOOL_NAME || normalizeToolName(name) === WIDGET_TOOL_NAME
  );
}

function toStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : undefined;
}

/**
 * Build the widget payload, or a human-readable reason it could not be built.
 *
 * A fragment that fails sanitizing must NOT render as a blank frame — silent
 * failure is how a broken widget gets mistaken for a working one — so the
 * failure path returns text that the ordinary tool-call row will show.
 */
function buildPayload(
  callId: string,
  input: WidgetToolInput,
): { payload: WidgetPayload } | { error: string } {
  const title = sanitizeWidgetTitle(typeof input.title === "string" ? input.title : "");
  const loadingMessages = sanitizeWidgetLoadingMessages(toStringArray(input.loading_messages));

  // While a tool call streams, the provider withholds string arguments until
  // they close (Claude's partial-JSON parser does this deliberately, so an
  // `old_string` is never half-matched). So `widget_code` legitimately arrives
  // late while `title` and `loading_messages` are already here — that is the
  // pending state, and it is what the loading messages exist for.
  if (typeof input.widget_code !== "string" || input.widget_code.trim().length === 0) {
    return {
      payload: {
        version: WIDGET_PAYLOAD_VERSION,
        id: callId,
        title,
        mode: "html",
        code: "",
        loadingMessages,
      },
    };
  }

  try {
    const fragment = sanitizeWidgetFragment(input.widget_code);
    return {
      payload: {
        version: WIDGET_PAYLOAD_VERSION,
        id: callId,
        title,
        mode: fragment.mode,
        code: fragment.code,
        loadingMessages,
        ...(fragment.truncated ? { truncated: true } : {}),
      },
    };
  } catch (error) {
    if (error instanceof WidgetFragmentError) {
      return { error: error.message };
    }
    return { error: "Widget could not be rendered." };
  }
}

export function normalizeWidgetTimelineItem(item: AgentTimelineItem): AgentTimelineItem {
  if (item.type !== "tool_call" || !isWidgetToolCall(item.name)) {
    return item;
  }
  // Idempotent: the chokepoint normalizes on the way to both the stream and the
  // store, and history import runs it again on replay. A widget that has
  // already been through here no longer carries its raw input under an
  // `unknown` detail, and re-running would replace a good payload with an empty
  // one.
  if (item.detail?.type !== "unknown") {
    return item;
  }

  const result = buildPayload(item.callId, readToolInput(item));
  if ("error" in result) {
    return {
      ...item,
      detail: { type: "plain_text", label: "Widget", text: result.error, icon: "sparkles" },
    };
  }

  return {
    ...item,
    // The fallback row for clients that do not know about widgets. The title is
    // the model's own snake_case identifier, which reads acceptably as a label.
    detail: {
      type: "plain_text",
      label: "Widget",
      text: result.payload.title,
      icon: "sparkles",
    },
    metadata: {
      ...item.metadata,
      [WIDGET_METADATA_KEY]: result.payload,
    },
  };
}
