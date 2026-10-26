// One parser is shared by daemon execution and the API harness's launch approval gate.
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const LAUNCH_CONFIG_RELATIVE_PATH = ".claude/launch.json";
const MAX_CONFIG_BYTES = 256 * 1024;
const argument = z
  .string()
  .max(16384)
  .refine((value) => !value.includes("\0"));
const environment = z.record(
  z
    .string()
    .min(1)
    .max(512)
    .refine((value) => !value.includes("=") && !value.includes("\0")),
  argument,
);
const destination = z
  .string()
  .max(8192)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
    );
  }, "Preview URL must use HTTP(S) without credentials.");
const entry = z.object({
  name: z
    .string()
    .min(1)
    .max(128)
    .refine((value) => value.trim().length > 0),
  runtimeExecutable: argument.refine((value) => value.trim().length > 0),
  runtimeArgs: z.array(argument).max(256).optional(),
  port: z.number().int().min(1).max(65535),
  url: destination.optional(),
  env: environment.refine((value) => Object.keys(value).length <= 128).optional(),
});
const document = z.object({
  version: z.string().max(128).optional(),
  configurations: z.array(entry).max(64),
});

export type PreviewLaunchEntry = z.infer<typeof entry>;
export interface PreviewLaunchConfig {
  cwd: string;
  file: string;
  revision: string;
  servers: PreviewLaunchEntry[];
}
export class PreviewConfigError extends Error {
  constructor(
    readonly file: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${LAUNCH_CONFIG_RELATIVE_PATH}: ${message}`, options);
    this.name = "PreviewConfigError";
  }
}
export function previewDestination(server: PreviewLaunchEntry): string {
  return server.url ?? `http://127.0.0.1:${server.port}/`;
}
/** Deliberately excludes URL/name/port. Approval binds execution, not presentation. */
export function previewCommandRevision(cwd: string, server: PreviewLaunchEntry): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        cwd,
        executable: server.runtimeExecutable,
        args: server.runtimeArgs ?? [],
        env: Object.entries(server.env ?? {}).sort(([left], [right]) => left.localeCompare(right)),
      }),
    )
    .digest("hex");
}
function absent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
async function readBytes(file: string): Promise<Buffer> {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_CONFIG_BYTES)
      throw new PreviewConfigError(file, "Use one ordinary launch file no larger than 256 KiB.");
    const bytes = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    if (offset > MAX_CONFIG_BYTES || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new PreviewConfigError(
        file,
        "Launch configuration changed while reading. Refresh before starting.",
      );
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
}
/** A read never creates configuration, discovers executables or starts a process. */
export async function readPreviewLaunchConfig(cwd: string): Promise<PreviewLaunchConfig | null> {
  const root = await realpath(cwd);
  const directory = path.join(root, ".claude");
  const file = path.join(directory, "launch.json");
  let bytes: Buffer;
  try {
    const folder = await lstat(directory);
    if (!folder.isDirectory() || folder.isSymbolicLink())
      throw new PreviewConfigError(
        file,
        "The configuration directory must belong to this workspace.",
      );
    const target = await lstat(file);
    if (!target.isFile() || target.isSymbolicLink())
      throw new PreviewConfigError(file, "Use an ordinary workspace launch file.");
    bytes = await readBytes(file);
  } catch (error) {
    if (absent(error)) return null;
    if (error instanceof PreviewConfigError) throw error;
    throw new PreviewConfigError(
      file,
      "Could not read launch configuration. The file was preserved.",
      { cause: error },
    );
  }
  let parsed: z.infer<typeof document>;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = document.parse(JSON.parse(text));
  } catch (error) {
    throw new PreviewConfigError(
      file,
      "Invalid launch configuration. Review its format; the file was preserved.",
      { cause: error },
    );
  }
  const names = new Set<string>();
  for (const server of parsed.configurations) {
    if (names.has(server.name)) throw new PreviewConfigError(file, "Server names must be unique.");
    names.add(server.name);
  }
  return {
    cwd: root,
    file,
    revision: createHash("sha256").update(root).update("\0").update(bytes).digest("hex"),
    servers: parsed.configurations,
  };
}
