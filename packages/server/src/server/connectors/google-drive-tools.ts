import { randomUUID } from "node:crypto";
import { z } from "zod";
import { tool, id, page, type GoogleConnectorTool } from "./google-tool-definition.js";
const Drive = "https://www.googleapis.com/drive/v3";
const encode = encodeURIComponent;
const object = z.record(z.string(), z.unknown());

export function driveTools(): GoogleConnectorTool[] {
  return [
    tool(
      "list_files",
      "List or search Drive files using Drive query syntax. Returns one page with IDs and metadata. Shared-drive items are included where accessible.",
      z.object({ ...page, query: z.string().max(2048).optional() }),
      (api, input) =>
        api({
          url: `${Drive}/files`,
          query: {
            q: input.query ?? "trashed = false",
            pageSize: input.pageSize,
            pageToken: input.pageToken,
            fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)",
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          },
        }),
    ),
    tool(
      "read_file",
      "Read a text file or export a Google document as text. For other Google formats specify an export MIME type, such as text/csv for a spreadsheet. Returns at most 48,000 characters.",
      z.object({ fileId: id, exportMimeType: z.string().max(128).optional() }),
      async (api, input) => {
        const file = object.parse(
          await api({
            url: `${Drive}/files/${encode(input.fileId)}`,
            query: { fields: "id,name,mimeType,size", supportsAllDrives: true },
          }),
        );
        const native = String(file.mimeType).startsWith("application/vnd.google-apps.");
        if (
          !native &&
          !String(file.mimeType).startsWith("text/") &&
          !["application/json", "application/xml"].includes(String(file.mimeType))
        )
          throw new Error(
            "This file is binary. The text reader supports text, JSON, XML and exported Google documents.",
          );
        const content = z.string().parse(
          await api({
            url: `${Drive}/files/${encode(input.fileId)}${native ? "/export" : ""}`,
            query: native
              ? { mimeType: input.exportMimeType ?? "text/plain" }
              : { alt: "media", supportsAllDrives: true },
            text: true,
          }),
        );
        return { ...file, content: content.slice(0, 48_000), truncated: content.length > 48_000 };
      },
    ),
    tool(
      "create_file",
      "Create a UTF-8 text file in Drive. Repeating this call creates another file. Set mimeType for text, JSON or HTML content.",
      z.object({
        name: z.string().min(1).max(255),
        content: z.string().max(500_000),
        mimeType: z
          .string()
          .regex(/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/)
          .default("text/plain"),
        parentId: id.optional(),
      }),
      async (api, input) => {
        const boundary = `otto_${randomUUID()}`;
        const metadata = {
          name: input.name,
          mimeType: input.mimeType,
          ...(input.parentId ? { parents: [input.parentId] } : {}),
        };
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${input.mimeType}; charset=UTF-8\r\n\r\n${input.content}\r\n--${boundary}--`;
        return api({
          url: "https://www.googleapis.com/upload/drive/v3/files",
          method: "POST",
          query: {
            uploadType: "multipart",
            supportsAllDrives: true,
            fields: "id,name,mimeType,webViewLink",
          },
          bytes: Buffer.from(body),
          contentType: `multipart/related; boundary=${boundary}`,
        });
      },
    ),
    tool(
      "update_file",
      "Replace an existing text file's entire content in Drive. Does not edit native Google Docs, Sheets or Slides. Requires user instruction to replace the file.",
      z.object({
        fileId: id,
        content: z.string().max(500_000),
        mimeType: z
          .string()
          .regex(/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/)
          .default("text/plain"),
      }),
      async (api, input) => {
        const file = object.parse(
          await api({
            url: `${Drive}/files/${encode(input.fileId)}`,
            query: { fields: "mimeType", supportsAllDrives: true },
          }),
        );
        if (String(file.mimeType).startsWith("application/vnd.google-apps."))
          throw new Error(
            "Native Google documents require their document editing API; this operation replaces ordinary file content.",
          );
        return api({
          url: `https://www.googleapis.com/upload/drive/v3/files/${encode(input.fileId)}`,
          method: "PATCH",
          query: { uploadType: "media", supportsAllDrives: true },
          bytes: Buffer.from(input.content),
          contentType: input.mimeType,
        });
      },
    ),
  ];
}
