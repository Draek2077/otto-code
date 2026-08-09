import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { formatChatExport, type ChatExportFormat } from "./chat-export";
import type { StreamItem } from "@/types/stream";

export async function saveChatExport(input: {
  title: string;
  items: StreamItem[];
  format: ChatExportFormat;
}): Promise<void> {
  const extension = input.format === "markdown" ? "md" : input.format;
  let mimeType = "text/plain";
  if (input.format === "json") mimeType = "application/json";
  if (input.format === "html") mimeType = "text/html";
  const contents = formatChatExport(input.title, input.items, input.format);
  const fileName = `${
    input.title
      .trim()
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/^-|-$/g, "") || "chat"
  }.${extension}`;
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, contents, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType, dialogTitle: `Export ${input.title}` });
  }
}
