import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { isSameOrDescendantPath } from "../path-utils.js";

// Per-node query tools (projects/orchestration-graphs, Stage 3).
//
// A graph author can hand one node a specific read-only lookup — "list the open
// issues", "read the changelog", "count the failing tests" — without granting
// it the workspace. Every kind here is read-only by construction, and the
// safety properties are structural rather than validated:
//
//   command    argv array, spawned with shell:false. Parameters become whole
//              argv entries, so a value containing ; || $() && > is an argument
//              and nothing else. There is no string to inject into.
//   http-get   GET, no author-supplied headers. A graph template cannot carry a
//              credential into an outbound request.
//   file-read  resolved and checked against the run's cwd before opening, so
//              ../ and absolute paths are refused rather than clipped.

/** Namespace so a query tool can never shadow a built-in Otto tool. */
export const QUERY_TOOL_PREFIX = "query_";

/**
 * The shape this module needs, structurally.
 *
 * Both the wire type (GraphQueryTool, a passthrough Zod object) and the label
 * form the tool catalog reads back satisfy it, so neither side has to convert —
 * and this module stays independent of which one it was handed.
 */
export interface QueryToolSpec {
  name: string;
  description: string;
  kind: string;
  parameters?: Array<{ key: string; type: string; description?: string; required?: boolean }>;
  command?: string[];
  url?: string;
  path?: string;
}

export interface QueryToolResult {
  text: string;
  isError?: boolean;
}

const OUTPUT_LIMIT = 20_000;
const COMMAND_TIMEOUT_MS = 30_000;
const HTTP_TIMEOUT_MS = 30_000;

export function queryToolName(tool: QueryToolSpec): string {
  return `${QUERY_TOOL_PREFIX}${tool.name}`;
}

/**
 * Substitute `{{param}}` references from validated arguments.
 *
 * For `command` this runs per argv entry, so a substituted value is always
 * exactly one argument. Unknown references resolve to an empty string rather
 * than being left literal: a half-substituted path or URL is a bug worth
 * failing on, not one worth passing along.
 */
function substitute(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (_whole, key: string) => {
    const value = args[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function truncate(text: string): string {
  return text.length <= OUTPUT_LIMIT ? text : `${text.slice(0, OUTPUT_LIMIT)}\n… (truncated)`;
}

export async function executeQueryTool(input: {
  tool: QueryToolSpec;
  args: Record<string, unknown>;
  cwd: string;
  signal?: AbortSignal;
}): Promise<QueryToolResult> {
  switch (input.tool.kind) {
    case "command":
      return runCommand(input);
    case "http-get":
      return runHttpGet(input);
    case "file-read":
      return runFileRead(input);
    default:
      return {
        text: `Query tool "${input.tool.name}" has unknown kind "${input.tool.kind}".`,
        isError: true,
      };
  }
}

async function runCommand(input: {
  tool: QueryToolSpec;
  args: Record<string, unknown>;
  cwd: string;
  signal?: AbortSignal;
}): Promise<QueryToolResult> {
  const template = input.tool.command ?? [];
  const [executable, ...rest] = template.map((part) => substitute(part, input.args));
  if (!executable) {
    return { text: `Query tool "${input.tool.name}" declares no command.`, isError: true };
  }
  return awaitCommand({
    executable,
    args: rest,
    cwd: input.cwd,
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

function awaitCommand(input: {
  executable: string;
  args: string[];
  cwd: string;
  signal?: AbortSignal;
}): Promise<QueryToolResult> {
  return new Promise<QueryToolResult>((resolve) => {
    // shell:false is the whole security model — never make this configurable.
    const child = spawn(input.executable, input.args, {
      cwd: input.cwd,
      shell: false,
      windowsHide: true,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    let stdout = "";
    let stderr = "";
    let spawnError: Error | null = null;
    // The timeout kills the child rather than resolving, so "close" stays the
    // single settle path — including for a spawn that never started, which
    // emits "error" and then "close".
    const timer = setTimeout(() => child.kill(), COMMAND_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error: Error) => {
      spawnError = error;
    });
    child.once("close", (code: number | null) => {
      clearTimeout(timer);
      const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      // A non-zero exit is reported, not thrown: "the command said no" is
      // frequently the answer the node wanted.
      const result: QueryToolResult = spawnError
        ? { text: `Command failed to start: ${(spawnError as Error).message}`, isError: true }
        : {
            text: truncate(combined || `(no output; exit code ${code ?? "unknown"})`),
            ...(code === 0 ? {} : { isError: true }),
          };
      // eslint-disable-next-line promise/no-multiple-resolved -- "close" fires once (registered with `once`) and is the only settle path; the timeout kills the child rather than resolving, and a spawn failure records its error for this handler to report.
      resolve(result);
    });
  });
}

async function runHttpGet(input: {
  tool: QueryToolSpec;
  args: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<QueryToolResult> {
  const url = substitute(input.tool.url ?? "", input.args);
  if (!url) {
    return { text: `Query tool "${input.tool.name}" declares no URL.`, isError: true };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      text: `Query tool "${input.tool.name}" produced an invalid URL: ${url}`,
      isError: true,
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      text: `Query tools may only fetch http(s) URLs (got ${parsed.protocol}).`,
      isError: true,
    };
  }
  try {
    const response = await fetch(parsed, {
      method: "GET",
      signal: input.signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const body = await response.text();
    return {
      text: truncate(body),
      ...(response.ok ? {} : { isError: true }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { text: `Request failed: ${message}`, isError: true };
  }
}

async function runFileRead(input: {
  tool: QueryToolSpec;
  args: Record<string, unknown>;
  cwd: string;
}): Promise<QueryToolResult> {
  const relative = substitute(input.tool.path ?? "", input.args);
  if (!relative) {
    return { text: `Query tool "${input.tool.name}" declares no path.`, isError: true };
  }
  const resolved = path.resolve(input.cwd, relative);
  // Resolve first, then check: this refuses ../ escapes and absolute paths
  // outright rather than trying to sanitise them.
  if (!isSameOrDescendantPath(input.cwd, resolved)) {
    return {
      text: `"${relative}" is outside this orchestration's workspace, so it cannot be read.`,
      isError: true,
    };
  }
  try {
    return { text: truncate(await readFile(resolved, "utf8")) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { text: `Could not read "${relative}": ${message}`, isError: true };
  }
}
