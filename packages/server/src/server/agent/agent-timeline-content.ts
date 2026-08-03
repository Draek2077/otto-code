import type { AgentTimelineItem } from "./agent-sdk-types.js";

const TOOL_CALL_CONTENT_MAX_LENGTH = 64 * 1024;

// File-content details ride in every running-status snapshot of a streamed
// Write/Edit, so an uncapped one is re-sent and re-retained on each update. Keep
// the same 64 KB budget as shell output, split head/tail so the preview still
// shows how the file starts and ends.
const FILE_CONTENT_HEAD_LENGTH = 48 * 1024;
const FILE_CONTENT_TAIL_LENGTH = TOOL_CALL_CONTENT_MAX_LENGTH - FILE_CONTENT_HEAD_LENGTH;

function limitFileContentValue(value: string | undefined): string | undefined {
  if (typeof value !== "string" || value.length <= TOOL_CALL_CONTENT_MAX_LENGTH) {
    return value;
  }
  const omitted = value.length - TOOL_CALL_CONTENT_MAX_LENGTH;
  return [
    value.slice(0, FILE_CONTENT_HEAD_LENGTH),
    `[... Otto truncated ${omitted} characters ...]`,
    value.slice(value.length - FILE_CONTENT_TAIL_LENGTH),
  ].join("\n");
}

function limitFileContent(item: AgentTimelineItem): AgentTimelineItem {
  if (item.type !== "tool_call") {
    return item;
  }
  if (item.detail.type === "write") {
    const content = limitFileContentValue(item.detail.content);
    if (content === item.detail.content) {
      return item;
    }
    return { ...item, detail: { ...item.detail, content } };
  }
  if (item.detail.type === "edit") {
    const oldString = limitFileContentValue(item.detail.oldString);
    const newString = limitFileContentValue(item.detail.newString);
    const unifiedDiff = limitFileContentValue(item.detail.unifiedDiff);
    if (
      oldString === item.detail.oldString &&
      newString === item.detail.newString &&
      unifiedDiff === item.detail.unifiedDiff
    ) {
      return item;
    }
    return { ...item, detail: { ...item.detail, oldString, newString, unifiedDiff } };
  }
  return item;
}

function limitFailedShellError(item: AgentTimelineItem): AgentTimelineItem {
  if (
    item.type !== "tool_call" ||
    item.detail.type !== "shell" ||
    item.status !== "failed" ||
    typeof item.error !== "object" ||
    item.error === null ||
    !("content" in item.error) ||
    typeof item.error.content !== "string" ||
    item.error.content.length <= TOOL_CALL_CONTENT_MAX_LENGTH
  ) {
    return item;
  }
  return {
    ...item,
    error: {
      ...item.error,
      content: item.error.content.slice(0, TOOL_CALL_CONTENT_MAX_LENGTH),
    },
  };
}

function limitPlainText(item: AgentTimelineItem): AgentTimelineItem {
  if (
    item.type !== "tool_call" ||
    item.detail.type !== "plain_text" ||
    typeof item.detail.text !== "string" ||
    item.detail.text.length <= TOOL_CALL_CONTENT_MAX_LENGTH
  ) {
    return item;
  }
  return {
    ...item,
    detail: {
      ...item.detail,
      text: item.detail.text.slice(0, TOOL_CALL_CONTENT_MAX_LENGTH),
    },
  };
}

export function limitAgentTimelineItemContent(item: AgentTimelineItem): AgentTimelineItem {
  item = limitFailedShellError(item);
  item = limitPlainText(item);
  item = limitFileContent(item);
  if (
    item.type !== "tool_call" ||
    item.detail.type !== "shell" ||
    typeof item.detail.output !== "string"
  ) {
    return item;
  }
  if (item.detail.output.length <= TOOL_CALL_CONTENT_MAX_LENGTH) {
    return item;
  }
  return {
    ...item,
    detail: {
      ...item.detail,
      output: item.detail.output.slice(0, TOOL_CALL_CONTENT_MAX_LENGTH),
    },
  };
}
