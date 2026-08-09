import { formatChatExport, type ChatExportFormat } from "./chat-export";
import type { StreamItem } from "@/types/stream";

export async function saveChatExport(input: {
  title: string;
  items: StreamItem[];
  format: ChatExportFormat;
}): Promise<void> {
  const extension = input.format === "markdown" ? "md" : input.format;
  const contents = formatChatExport(input.title, input.items, input.format);
  const fileName = `${
    input.title
      .trim()
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/^-|-$/g, "") || "chat"
  }.${extension}`;
  let mimeType = "text/plain";
  if (input.format === "json") mimeType = "application/json";
  if (input.format === "html") mimeType = "text/html";
  const blob = new Blob([contents], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
