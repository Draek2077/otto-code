import type { StreamItem } from "@/types/stream";

export type ChatExportFormat = "json" | "html" | "markdown" | "text";

function itemLabel(item: StreamItem): string {
  switch (item.kind) {
    case "user_message":
      return item.text;
    case "assistant_message":
      return item.text;
    case "thought":
      return item.text;
    case "activity_log":
      return item.message;
    case "todo_list":
      return item.items
        .map((entry) => `${entry.completed ? "[x]" : "[ ]"} ${entry.text}`)
        .join("\n");
    case "tool_call":
      return JSON.stringify(item.payload, null, 2);
    case "action_group":
      return item.items.map(itemLabel).join("\n");
    case "compaction":
      return `Compaction ${item.status}`;
  }
}

function itemRole(item: StreamItem): string {
  switch (item.kind) {
    case "user_message":
      return "User";
    case "assistant_message":
      return "Assistant";
    case "thought":
      return "Thought";
    case "tool_call":
      return "Tool";
    case "todo_list":
      return "Todo list";
    case "activity_log":
      return "Activity";
    case "action_group":
      return "Actions";
    case "compaction":
      return "System";
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}

export function formatChatExport(
  title: string,
  items: StreamItem[],
  format: ChatExportFormat,
): string {
  if (format === "json") {
    return JSON.stringify(
      { version: 1, title, exportedAt: new Date().toISOString(), items },
      null,
      2,
    );
  }
  if (format === "html") {
    const body = items
      .map(
        (item) =>
          `<article><h2>${escapeHtml(itemRole(item))}</h2><time>${escapeHtml(item.timestamp.toISOString())}</time><pre>${escapeHtml(itemLabel(item))}</pre></article>`,
      )
      .join("\n");
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
  }
  const sections = items.map(
    (item) => `${itemRole(item)} (${item.timestamp.toISOString()})\n${itemLabel(item)}`,
  );
  return format === "markdown"
    ? `# ${title}\n\n${sections.map((section) => `## ${section}`).join("\n\n")}`
    : `${title}\n\n${sections.join("\n\n")}`;
}
