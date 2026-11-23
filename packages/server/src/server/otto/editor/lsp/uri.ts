import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { realpath, stat } from "node:fs/promises";
import { EditorError } from "../errors.js";

export function fileUri(file: string): string {
  return pathToFileURL(file).href;
}
export function uriPath(uri: string): string {
  const value = new URL(uri);
  if (value.protocol !== "file:")
    throw new EditorError("invalid", "The server returned a non-file location.");
  return fileURLToPath(value);
}
export function pathKey(file: string): string {
  const normalized = path.resolve(file);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
export function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export interface DocumentPath {
  root: string;
  file: string;
}
export async function canonicalDocument(root: string, file: string): Promise<DocumentPath> {
  if (!path.isAbsolute(root) || !path.isAbsolute(file))
    throw new EditorError("invalid", "Editor paths must belong to the selected host.");
  const [canonicalRoot, canonicalFile] = await Promise.all([realpath(root), realpath(file)]);
  if (!isInside(canonicalRoot, canonicalFile))
    throw new EditorError(
      "invalid",
      "The file is outside this workspace. Open it with its owning directory.",
    );
  const info = await stat(canonicalFile);
  if (!info.isFile() || info.size > 4 * 1024 * 1024)
    throw new EditorError("invalid", "Code intelligence supports source files up to 4 MB.");
  return { root: canonicalRoot, file: canonicalFile };
}
