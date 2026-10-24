import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { ProviderContent } from "../../../server/provider.js";
import { z } from "zod";
import type { ChatMessage, ChatContentPart } from "./completions.js";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const imageMime = z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const storedContentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    mimeType: imageMime,
  }),
]);
export type StoredContent = z.infer<typeof storedContentSchema>;
export type StoredMessage =
  | Exclude<ChatMessage, { role: "user" }>
  | { role: "user"; content: string | StoredContent[] };

function textAttachment(part: Exclude<ProviderContent, { type: "image" }>): string {
  switch (part.type) {
    case "text":
      return [
        "title" in part && part.title ? `[${part.title}]` : "",
        "externalResource" in part && part.externalResource
          ? `[${part.externalResource.providerLabel}: ${part.externalResource.identifier}]\n${part.externalResource.url}`
          : "",
        part.text,
      ]
        .filter(Boolean)
        .join("\n");
    case "uploaded_file":
      return `[Attached file: ${part.fileName}, ${part.mimeType}, ${part.size} bytes]\nHost path: ${part.path}\nUse an appropriate approved tool to inspect this file.`;
    case "review":
      return `[Review: ${part.cwd}, ${part.mode}${part.baseRef ? `, base ${part.baseRef}` : ""}]\n${part.comments.map((comment) => `${comment.filePath}:${comment.lineNumber} (${comment.side})\n${comment.body}\n${comment.context.hunkHeader}\n${comment.context.lines.map((line) => `${line.type}: ${line.content}`).join("\n")}`).join("\n\n")}`;
    case "forge_change_request":
    case "github_pr":
      return `[Change request #${part.number}: ${part.title}]\n${part.url}\n${part.body ?? ""}\nBase: ${part.baseRefName ?? ""}\nHead: ${part.headRefName ?? ""}`;
    case "forge_issue":
    case "github_issue":
      return `[Issue #${part.number}: ${part.title}]\n${part.url}\n${part.body ?? ""}`;
  }
}

export function prepareContent(parts: readonly ProviderContent[]) {
  const content: StoredContent[] = [];
  const images = new Map<string, Buffer>();
  const labels: string[] = [];
  let imageBytes = 0;
  let textBytes = 0;
  for (const part of parts) {
    if (part.type === "image") {
      const mimeType = imageMime.parse(part.mimeType);
      if (
        !part.data ||
        part.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
        /[^A-Za-z0-9+/=]/.test(part.data)
      )
        throw new Error(
          "Attach a valid base64 PNG, JPEG, GIF or WebP image, with at most 20 MiB of image data per prompt.",
        );
      const bytes = Buffer.from(part.data, "base64");
      if (bytes.toString("base64") !== part.data)
        throw new Error("The image attachment is not valid base64.");
      imageBytes += bytes.byteLength;
      if (imageBytes > MAX_IMAGE_BYTES)
        throw new Error("Image attachments exceed 20 MiB for this prompt.");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      images.set(sha256, bytes);
      content.push({ type: "image", sha256, mimeType });
      labels.push(`[Image: ${mimeType}]`);
    } else {
      const text = textAttachment(part);
      textBytes += Buffer.byteLength(text);
      if (textBytes > 1024 * 1024)
        throw new Error(
          "Prompt text exceeds 1 MiB. Attach a file for approved inspection instead.",
        );
      content.push({ type: "text", text });
      labels.push(text);
    }
  }
  return { content: images.size ? content : labels.join("\n"), text: labels.join("\n"), images };
}

/** Images stay on the owning host. Persistence carries content hashes, never base64 payloads. */
export class PromptImages {
  constructor(private readonly directory: string | undefined) {}

  private file(hash: string): string {
    if (!this.directory) throw new Error("The provider host has no attachment storage directory.");
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid image attachment reference.");
    return path.join(this.directory, hash);
  }

  async save(images: ReadonlyMap<string, Buffer>, signal: AbortSignal): Promise<void> {
    if (!images.size) return;
    if (!this.directory) throw new Error("The provider host has no attachment storage directory.");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const [hash, bytes] of images) {
      signal.throwIfAborted();
      const temporary = path.join(this.directory, `.${hash}-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, bytes, { flag: "wx", mode: 0o600, signal });
        signal.throwIfAborted();
        await rename(temporary, this.file(hash));
      } finally {
        await rm(temporary, { force: true });
      }
    }
  }

  async wire(messages: readonly StoredMessage[], signal: AbortSignal): Promise<ChatMessage[]> {
    const result: ChatMessage[] = [];
    let imageBytes = 0;
    for (const message of messages) {
      signal.throwIfAborted();
      if (message.role !== "user" || typeof message.content === "string") {
        result.push(message as ChatMessage);
        continue;
      }
      const content: ChatContentPart[] = [];
      for (const part of message.content) {
        if (part.type === "text") {
          content.push(part);
          continue;
        }
        const bytes = await this.read(part.sha256, 40 * 1024 * 1024 - imageBytes, signal);
        imageBytes += bytes.byteLength;
        content.push({
          type: "image_url",
          image_url: { url: `data:${part.mimeType};base64,${bytes.toString("base64")}` },
        });
      }
      result.push({ role: "user", content });
    }
    return result;
  }

  private async read(hash: string, remainingBytes: number, signal: AbortSignal): Promise<Buffer> {
    const file = await open(this.file(hash), "r");
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > Math.min(MAX_IMAGE_BYTES, remainingBytes))
        throw new Error(
          "The image context exceeds its supported size. Compact or rewind before continuing.",
        );
      const buffer = Buffer.alloc(info.size + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        signal.throwIfAborted();
        const next = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (!next.bytesRead) break;
        bytesRead += next.bytesRead;
      }
      const bytes = buffer.subarray(0, bytesRead);
      if (bytesRead !== info.size || createHash("sha256").update(bytes).digest("hex") !== hash)
        throw new Error("An image attachment changed on disk. Reattach it before continuing.");
      return bytes;
    } finally {
      await file.close();
    }
  }
}
