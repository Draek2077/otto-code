import path from "node:path";
import { realpath, stat } from "node:fs/promises";
export async function hostUploadFiles(cwd: string, inputs: string[]): Promise<string[]> {
  if (!inputs.length || inputs.length > 64)
    throw new Error("Host Browser accepts between one and 64 workspace files per upload.");
  const root = await realpath(cwd),
    files: string[] = [];
  for (const input of inputs) {
    const file = await realpath(path.resolve(root, input)),
      relative = path.relative(root, file);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      !(await stat(file)).isFile()
    )
      throw new Error("Browser upload accepts regular files inside the agent's workspace only.");
    files.push(file);
  }
  return files;
}
