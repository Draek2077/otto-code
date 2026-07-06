import { spawn } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ToolCallDetail } from "../agent-sdk-types.js";

/**
 * Built-in coding tools for the OpenAI-compatible native provider. These run
 * in the daemon process against the agent's cwd — there is no external agent
 * binary, so the daemon is the tool runtime. Definitions use the OpenAI
 * function-calling schema so any /chat/completions server that supports
 * `tools` can drive them.
 */

/** Gating class used by the session's permission modes. */
export type CompatToolKind = "read" | "edit" | "execute";

export interface CompatToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  kind: CompatToolKind;
}

export interface CompatToolOutcome {
  /** Text fed back to the model as the tool result. */
  output: string;
  /** Timeline rendering payload. */
  detail: ToolCallDetail;
  isError?: boolean;
}

const MAX_READ_BYTES = 256 * 1024;
const MAX_TOOL_OUTPUT_CHARS = 30_000;
const MAX_COMMAND_OUTPUT_CHARS = 16_000;
const MAX_GREP_MATCHES = 100;
const MAX_GREP_FILE_BYTES = 1024 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const MAX_COMMAND_TIMEOUT_MS = 600_000;
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".expo",
  ".next",
  ".dev",
]);

export const COMPAT_TOOL_SPECS: CompatToolSpec[] = [
  {
    name: "read_file",
    kind: "read",
    description:
      "Read a file. Returns the file content, truncated when very large. Use offset/limit (line numbers) to page through big files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path, absolute or relative to the workspace" },
        offset: { type: "number", description: "1-based line to start reading from" },
        limit: { type: "number", description: "Maximum number of lines to return" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_dir",
    kind: "read",
    description:
      "List the entries of a directory. Directories are suffixed with '/'. Defaults to the workspace root.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path, defaults to the workspace root" },
      },
    },
  },
  {
    name: "grep_search",
    kind: "read",
    description:
      "Search file contents recursively with a regular expression. Returns matching lines as path:line:text. Skips binary files and dependency folders.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "JavaScript regular expression to search for" },
        path: { type: "string", description: "Directory to search, defaults to workspace root" },
        max_results: { type: "number", description: "Maximum matches to return (default 100)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "write_file",
    kind: "edit",
    description:
      "Create or overwrite a file with the given content. Parent directories are created automatically.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path, absolute or relative to the workspace" },
        content: { type: "string", description: "Full file content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    kind: "edit",
    description:
      "Replace an exact string in a file. old_string must match exactly once unless replace_all is true. Include enough surrounding context to make it unique.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path, absolute or relative to the workspace" },
        old_string: { type: "string", description: "Exact text to replace" },
        new_string: { type: "string", description: "Replacement text" },
        replace_all: { type: "boolean", description: "Replace every occurrence (default false)" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "run_command",
    kind: "execute",
    description:
      "Run a shell command in the workspace directory and return its combined output and exit code. Long output is truncated. " +
      "Do not start long-running dev servers here — they block the shell and cannot be verified; when the preview tools are available, use preview_start instead.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to run" },
        timeout_seconds: {
          type: "number",
          description: "Maximum runtime in seconds (default 120, max 600)",
        },
      },
      required: ["command"],
    },
  },
];

export function buildOpenAIToolsPayload(specs: CompatToolSpec[]): unknown[] {
  return specs.map((spec) => ({
    type: "function",
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
    },
  }));
}

export function findCompatToolSpec(name: string): CompatToolSpec | undefined {
  return COMPAT_TOOL_SPECS.find((spec) => spec.name === name);
}

export interface CompatToolCallInput {
  name: string;
  arguments: Record<string, unknown>;
  cwd: string;
  signal?: AbortSignal;
}

export async function executeCompatTool(input: CompatToolCallInput): Promise<CompatToolOutcome> {
  switch (input.name) {
    case "read_file":
      return readFileTool(input);
    case "list_dir":
      return listDirTool(input);
    case "grep_search":
      return grepSearchTool(input);
    case "write_file":
      return writeFileTool(input);
    case "edit_file":
      return editFileTool(input);
    case "run_command":
      return runCommandTool(input);
    default:
      return {
        output: `Unknown tool: ${input.name}`,
        detail: { type: "unknown", input: input.arguments, output: null },
        isError: true,
      };
  }
}

/**
 * Build the preview detail shown in the timeline (and permission prompt)
 * before the tool has produced output.
 */
export function buildCompatToolPreviewDetail(
  name: string,
  args: Record<string, unknown>,
  cwd: string,
): ToolCallDetail {
  switch (name) {
    case "read_file":
      return { type: "read", filePath: resolveToolPath(cwd, readString(args, "path") ?? "") };
    case "list_dir":
      return {
        type: "plain_text",
        label: `List ${readString(args, "path") ?? "."}`,
        icon: "eye",
      };
    case "grep_search":
      return { type: "search", query: readString(args, "pattern") ?? "", toolName: "grep" };
    case "write_file":
      return {
        type: "write",
        filePath: resolveToolPath(cwd, readString(args, "path") ?? ""),
        content: readString(args, "content") ?? "",
      };
    case "edit_file":
      return {
        type: "edit",
        filePath: resolveToolPath(cwd, readString(args, "path") ?? ""),
        oldString: readString(args, "old_string") ?? "",
        newString: readString(args, "new_string") ?? "",
      };
    case "run_command":
      return { type: "shell", command: readString(args, "command") ?? "", cwd };
    default:
      return { type: "unknown", input: args, output: null };
  }
}

function readString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveToolPath(cwd: string, target: string): string {
  return path.resolve(cwd, target);
}

function truncateOutput(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, maxChars), truncated: true };
}

/**
 * Cap text fed back to the model as a tool result. Shared with MCP tool
 * results, which are untrusted external content and must not blow the context.
 */
export function capToolOutput(text: string): string {
  const { text: capped, truncated } = truncateOutput(text, MAX_TOOL_OUTPUT_CHARS);
  return truncated ? `${capped}\n[truncated]` : capped;
}

function errorOutcome(message: string, detail: ToolCallDetail): CompatToolOutcome {
  return { output: message, detail, isError: true };
}

async function readFileTool(input: CompatToolCallInput): Promise<CompatToolOutcome> {
  const relPath = readString(input.arguments, "path");
  if (!relPath) {
    return errorOutcome("read_file requires a 'path' argument", {
      type: "unknown",
      input: input.arguments,
      output: null,
    });
  }
  const filePath = resolveToolPath(input.cwd, relPath);
  const detailBase = { type: "read" as const, filePath };
  let raw: string;
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      return errorOutcome(`${filePath} is a directory — use list_dir instead`, detailBase);
    }
    if (stat.size > MAX_READ_BYTES) {
      const handle = await fs.open(filePath, "r");
      try {
        const buffer = Buffer.alloc(MAX_READ_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, MAX_READ_BYTES, 0);
        raw = `${buffer.subarray(0, bytesRead).toString("utf8")}\n[truncated: file is ${stat.size} bytes]`;
      } finally {
        await handle.close();
      }
    } else {
      raw = await fs.readFile(filePath, "utf8");
    }
  } catch (error) {
    return errorOutcome(describeFsError(error), detailBase);
  }

  const offset = readNumber(input.arguments, "offset");
  const limit = readNumber(input.arguments, "limit");
  let output = raw;
  if (offset !== undefined || limit !== undefined) {
    const lines = raw.split("\n");
    const start = Math.max((offset ?? 1) - 1, 0);
    const end = limit !== undefined ? start + limit : lines.length;
    output = lines.slice(start, end).join("\n");
  }
  const { text, truncated } = truncateOutput(output, MAX_TOOL_OUTPUT_CHARS);
  return {
    output: truncated ? `${text}\n[truncated]` : text,
    detail: {
      ...detailBase,
      ...(offset !== undefined ? { offset } : {}),
      ...(limit !== undefined ? { limit } : {}),
    },
  };
}

async function listDirTool(input: CompatToolCallInput): Promise<CompatToolOutcome> {
  const relPath = readString(input.arguments, "path") ?? ".";
  const dirPath = resolveToolPath(input.cwd, relPath);
  const detail: ToolCallDetail = { type: "plain_text", label: `List ${relPath}`, icon: "eye" };
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const names = entries
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort((a, b) => a.localeCompare(b));
    const listing = names.length > 0 ? names.join("\n") : "(empty directory)";
    return { output: listing, detail: { ...detail, text: listing } };
  } catch (error) {
    return errorOutcome(describeFsError(error), detail);
  }
}

async function grepSearchTool(input: CompatToolCallInput): Promise<CompatToolOutcome> {
  const pattern = readString(input.arguments, "pattern");
  if (!pattern) {
    return errorOutcome("grep_search requires a 'pattern' argument", {
      type: "search",
      query: "",
      toolName: "grep",
    });
  }
  const detailBase = { type: "search" as const, query: pattern, toolName: "grep" as const };
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch (error) {
    return errorOutcome(
      `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
      detailBase,
    );
  }
  const rootPath = resolveToolPath(input.cwd, readString(input.arguments, "path") ?? ".");
  const maxResults = Math.min(
    readNumber(input.arguments, "max_results") ?? MAX_GREP_MATCHES,
    MAX_GREP_MATCHES,
  );

  const matches: string[] = [];
  const filesWithMatches = new Set<string>();
  try {
    await walkForGrep({
      dirPath: rootPath,
      rootPath,
      regex,
      maxResults,
      matches,
      filesWithMatches,
      signal: input.signal,
    });
  } catch (error) {
    return errorOutcome(describeFsError(error), detailBase);
  }

  const truncated = matches.length >= maxResults;
  const content =
    matches.length > 0 ? matches.join("\n") : `No matches for /${pattern}/ under ${rootPath}`;
  return {
    output: truncated ? `${content}\n[truncated at ${maxResults} matches]` : content,
    detail: {
      ...detailBase,
      content,
      numMatches: matches.length,
      numFiles: filesWithMatches.size,
      truncated,
    },
  };
}

interface GrepWalkContext {
  dirPath: string;
  rootPath: string;
  regex: RegExp;
  maxResults: number;
  matches: string[];
  filesWithMatches: Set<string>;
  signal?: AbortSignal;
}

async function walkForGrep(context: GrepWalkContext): Promise<void> {
  if (context.matches.length >= context.maxResults || context.signal?.aborted) {
    return;
  }
  const entries = await fs.readdir(context.dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (context.matches.length >= context.maxResults || context.signal?.aborted) {
      return;
    }
    const entryPath = path.join(context.dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        await walkForGrep({ ...context, dirPath: entryPath });
      }
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    await grepFile(context, entryPath);
  }
}

async function grepFile(context: GrepWalkContext, filePath: string): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return;
  }
  if (stat.size > MAX_GREP_FILE_BYTES) {
    return;
  }
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return;
  }
  if (content.includes(" ")) {
    return; // binary
  }
  const relPath = path.relative(context.rootPath, filePath) || filePath;
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (context.matches.length >= context.maxResults) {
      return;
    }
    const line = lines[index] ?? "";
    if (context.regex.test(line)) {
      context.filesWithMatches.add(filePath);
      context.matches.push(`${relPath}:${index + 1}:${line.slice(0, 400)}`);
    }
  }
}

async function writeFileTool(input: CompatToolCallInput): Promise<CompatToolOutcome> {
  const relPath = readString(input.arguments, "path");
  const content = readString(input.arguments, "content");
  if (!relPath || content === undefined) {
    return errorOutcome("write_file requires 'path' and 'content' arguments", {
      type: "unknown",
      input: input.arguments,
      output: null,
    });
  }
  const filePath = resolveToolPath(input.cwd, relPath);
  const detail: ToolCallDetail = { type: "write", filePath, content };
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  } catch (error) {
    return errorOutcome(describeFsError(error), detail);
  }
  return { output: `Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${filePath}`, detail };
}

async function editFileTool(input: CompatToolCallInput): Promise<CompatToolOutcome> {
  const relPath = readString(input.arguments, "path");
  const oldString = readString(input.arguments, "old_string");
  const newString = readString(input.arguments, "new_string");
  if (!relPath || oldString === undefined || newString === undefined) {
    return errorOutcome("edit_file requires 'path', 'old_string' and 'new_string' arguments", {
      type: "unknown",
      input: input.arguments,
      output: null,
    });
  }
  const filePath = resolveToolPath(input.cwd, relPath);
  const detail: ToolCallDetail = { type: "edit", filePath, oldString, newString };
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    return errorOutcome(describeFsError(error), detail);
  }
  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) {
    return errorOutcome(`old_string not found in ${filePath}`, detail);
  }
  const replaceAll = input.arguments["replace_all"] === true;
  if (occurrences > 1 && !replaceAll) {
    return errorOutcome(
      `old_string matches ${occurrences} times in ${filePath} — add more context or set replace_all`,
      detail,
    );
  }
  const updated = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);
  try {
    await fs.writeFile(filePath, updated, "utf8");
  } catch (error) {
    return errorOutcome(describeFsError(error), detail);
  }
  const replacements = replaceAll ? occurrences : 1;
  return { output: `Replaced ${replacements} occurrence(s) in ${filePath}`, detail };
}

async function runCommandTool(input: CompatToolCallInput): Promise<CompatToolOutcome> {
  const command = readString(input.arguments, "command");
  if (!command) {
    return errorOutcome("run_command requires a 'command' argument", {
      type: "shell",
      command: "",
      cwd: input.cwd,
    });
  }
  const timeoutSeconds = readNumber(input.arguments, "timeout_seconds");
  const timeoutMs = Math.min(
    (timeoutSeconds ?? DEFAULT_COMMAND_TIMEOUT_MS / 1000) * 1000,
    MAX_COMMAND_TIMEOUT_MS,
  );

  const result = await runShellCommand(command, input.cwd, timeoutMs, input.signal);
  const { text, truncated } = truncateOutput(result.output, MAX_COMMAND_OUTPUT_CHARS);
  const outputText = truncated ? `${text}\n[output truncated]` : text;
  const statusLine = describeShellStatus(result, timeoutMs);
  return {
    output: outputText ? `${outputText}\n${statusLine}` : statusLine,
    detail: {
      type: "shell",
      command,
      cwd: input.cwd,
      output: outputText,
      exitCode: result.exitCode,
    },
    isError: result.exitCode !== 0,
  };
}

interface ShellResult {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
}

function describeShellStatus(result: ShellResult, timeoutMs: number): string {
  if (result.exitCode !== null) {
    return `[exit code ${result.exitCode}]`;
  }
  if (result.timedOut) {
    return `[command timed out after ${Math.round(timeoutMs / 1000)}s]`;
  }
  return "[command was interrupted]";
}

async function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ShellResult> {
  const child = spawn(command, { shell: true, cwd, windowsHide: true });
  let output = "";
  let timedOut = false;

  const kill = () => {
    // shell:true spawns an intermediate shell; child.kill only reaches the
    // shell on Windows, so use taskkill to take the whole tree down.
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true });
    } else {
      child.kill("SIGKILL");
    }
  };

  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, timeoutMs);
  const onAbort = () => {
    kill();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });

  let exitCode: number | null = null;
  try {
    // events.once rejects when the child emits "error" (spawn failure) —
    // the one case where "close" never arrives.
    const [code] = (await once(child, "close")) as [number | null];
    exitCode = code;
  } catch (error) {
    output += `\n${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
  return {
    output,
    exitCode: timedOut || signal?.aborted ? null : exitCode,
    timedOut,
  };
}

function describeFsError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
