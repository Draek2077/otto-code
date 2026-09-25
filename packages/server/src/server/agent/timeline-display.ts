import { normalizeWidgetTimelineItem } from "../widget/widget-timeline.js";
import { unwrapSpokenInput } from "../voice-config.js";
import { stripTrailingTodoNudge } from "./todo-reminders.js";
import { limitAgentTimelineItemContent } from "./agent-timeline-content.js";
import { isSystemInjectedEnvelope } from "./agent-prompt.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import type { AgentTimelineItem, ImportedTimelineEntry } from "./agent-sdk-types.js";
import { resolveCreateAgentTitles } from "./create-agent-title.js";
import type { AgentSessionConfig } from "./agent-sdk-types.js";

export function resolveImportedAgentTitle(
  config: AgentSessionConfig,
  timelineRows: readonly AgentTimelineRow[],
): string | null {
  const initialPrompt = getFirstUserMessageTextFromRows(timelineRows);
  if (!initialPrompt) {
    return null;
  }
  const { explicitTitle, provisionalTitle } = resolveCreateAgentTitles({
    configTitle: config.title,
    initialPrompt,
  });
  return explicitTitle ?? provisionalTitle ?? null;
}

function getFirstUserMessageTextFromRows(rows: readonly AgentTimelineRow[]): string | null {
  for (const row of rows) {
    const item = row.item;
    if (item.type !== "user_message") {
      continue;
    }
    const text = item.text.trim();
    if (text) {
      return text;
    }
  }
  return null;
}

/**
 * Strip the voice `<spoken-input>` scaffolding from a `user_message` so the chat
 * shows the words the user spoke, not the markup the model was fed (see
 * `wrapSpokenInput`). Display-only and provider-agnostic: applied at the
 * timeline chokepoint so every surface (chat, copy, rewind prefill, title, CLI)
 * gets the clean text. The wrapped prompt was already delivered to the provider
 * for the live turn; this only shapes Otto's own timeline projection. Idempotent
 * and a no-op for every non-spoken message.
 */
function normalizeUserMessageForDisplay(item: AgentTimelineItem): AgentTimelineItem {
  if (item.type !== "user_message") {
    return item;
  }
  // Strip the passive todo nudge Otto appended for the model, then unwrap voice
  // scaffolding. Both are display-only and idempotent (see stripTrailingTodoNudge
  // and unwrapSpokenInput); the provider already received the full prompt.
  const cleaned = unwrapSpokenInput(stripTrailingTodoNudge(item.text));
  if (cleaned === item.text) {
    return item;
  }
  return { ...item, text: cleaned };
}

/**
 * The single display-normalization pass for timeline items. Both steps are
 * idempotent, which matters: the chokepoint normalizes on the way to the stream
 * AND the store re-normalizes on append, and history import runs it again on
 * replay.
 */
export function normalizeTimelineItemForDisplay(item: AgentTimelineItem): AgentTimelineItem {
  return normalizeWidgetTimelineItem(normalizeUserMessageForDisplay(item));
}

export function buildImportedTimelineRows(
  entries: readonly ImportedTimelineEntry[],
): AgentTimelineRow[] {
  const rows: AgentTimelineRow[] = [];
  for (const entry of entries) {
    if (entry.item.type === "user_message" && isSystemInjectedEnvelope(entry.item.text)) {
      continue;
    }
    rows.push({
      seq: rows.length + 1,
      timestamp: entry.timestamp ?? new Date().toISOString(),
      // Hydration builds rows directly instead of going through
      // recordTimeline, so it has to bound for itself. Provider history is
      // exactly where an unbounded output arrives in bulk.
      item: limitAgentTimelineItemContent(normalizeTimelineItemForDisplay(entry.item)),
    });
  }
  return rows;
}
