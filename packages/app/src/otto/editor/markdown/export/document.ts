import { markdownToHtmlDocument } from "./markdown-to-html";
import { exportEditorDocument } from "@getpaseo/plugin/otto/editor";
import { getDesktopHost } from "@/desktop/host";
import { v4 as uuid } from "uuid";
import type { EditorRpc } from "../../client";
import { Buffer } from "buffer";

/** A new sibling on the actual owning host, never a local-file shortcut. Existing
 * exports receive a numeric suffix instead of being overwritten implicitly. */
export async function exportDocument(
  client: EditorRpc,
  root: string,
  file: string,
  markdown: string,
  extension: "html" | "pdf",
) {
  const { html } = markdownToHtmlDocument(markdown, file.split(/[\\/]/u).at(-1) ?? "Document");
  let base64: string;
  if (extension === "pdf") {
    const bridge = getDesktopHost()?.documentExport;
    if (!bridge) throw new Error("Update the desktop shell to export PDFs.");
    base64 = await bridge.print(html);
  } else base64 = Buffer.from(html, "utf8").toString("base64");
  return client.call(exportEditorDocument, {
    hostId: client.hostId,
    root,
    file,
    operationId: uuid(),
    extension,
    base64,
  });
}
