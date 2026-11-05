import { resolveWorkspaceFilePaths } from "@/workspace/file-open";
export interface NewSourceFile {
  cwd: string;
  parentPath: string;
  name: string;
  kind: "file";
}
export async function createMissingSourceFile(
  create: (input: NewSourceFile) => Promise<{ success: boolean; error: string | null }>,
  target: { cwd: string; path: string },
) {
  const relative = resolveWorkspaceFilePaths({
    path: target.path,
    workspaceRoot: target.cwd,
  })?.relativePath;
  if (!relative) throw new Error("The new file must be inside its owning directory.");
  const segments = relative.split("/"),
    name = segments.pop();
  if (!name || name.trim() !== name)
    throw new Error("The filename is missing or has leading/trailing whitespace.");
  const result = await create({
    cwd: target.cwd,
    parentPath: segments.join("/") || ".",
    name,
    kind: "file",
  });
  if (!result.success) throw new Error(result.error ?? "The file could not be created.");
}
