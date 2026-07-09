import { spawn } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as dns from "node:dns";
import * as net from "node:net";
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";

import type { ToolCallDetail } from "../agent-sdk-types.js";

// ---------------------------------------------------------------------------
// SSRF Protection — prevent web_fetch from reaching internal networks
// ---------------------------------------------------------------------------

/**
 * IP ranges that must never be reachable from web_fetch.
 * Covers: loopback, link-local, private (RFC 1918), carrier-grade,
 * unique-local, multicast, reserved, and cloud metadata endpoints.
 */
const BLOCKED_IP_RANGES: Array<[string, string]> = [
  // Loopback: 127.0.0.0/8
  ["127.0.0.0", "127.255.255.255"],
  // Link-local: 169.254.0.0/16
  ["169.254.0.0", "169.254.255.255"],
  // Private: 10.0.0.0/8
  ["10.0.0.0", "10.255.255.255"],
  // Private: 172.16.0.0/12
  ["172.16.0.0", "172.31.255.255"],
  // Private: 192.168.0.0/16
  ["192.168.0.0", "192.168.255.255"],
  // Carrier-grade NAT: 100.64.0.0/10
  ["100.64.0.0", "100.127.255.255"],
  // Documentation: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
  // (not strictly needed but defensive)
  ["192.0.2.0", "192.0.2.255"],
  ["198.51.100.0", "198.51.100.255"],
  ["203.0.113.0", "203.0.113.255"],
  // Benchmarking: 198.18.0.0/15
  ["198.18.0.0", "198.19.255.255"],
  // Multicast: 224.0.0.0/4
  ["224.0.0.0", "239.255.255.255"],
  // Reserved + broadcast: 240.0.0.0/4
  ["240.0.0.0", "255.255.255.255"],
  // Any local: 0.0.0.0/8
  ["0.0.0.0", "0.255.255.255"],
];

/** Hostnames that are always allowed (DuckDuckGo API endpoints). */
const ALLOWED_HOSTS = new Set(["api.duckduckgo.com", "html.duckduckgo.com"]);

/**
 * Convert an IPv4 address string to an unsigned 32-bit integer for range
 * comparison. Throws on anything that is not a dotted quad.
 */
function ipv4ToNumber(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    throw new Error(`Not an IPv4 address: ${ip}`);
  }
  let value = 0;
  for (const part of parts) {
    const octet = Number.parseInt(part, 10);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      throw new Error(`Not an IPv4 address: ${ip}`);
    }
    value = (value * 256 + octet) >>> 0;
  }
  return value;
}

/**
 * Extract the IPv4 address embedded in an IPv4-mapped IPv6 address
 * (::ffff:a.b.c.d, including the hex form ::ffff:aabb:ccdd). Returns null for
 * anything else. Mapped addresses must be screened with the IPv4 rules — a
 * socket to ::ffff:127.0.0.1 reaches loopback.
 */
function extractMappedIpv4(lowerIp: string): string | null {
  const dotted = lowerIp.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u);
  if (dotted) {
    return dotted[1];
  }
  const hex = lowerIp.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u);
  if (hex) {
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  }
  return null;
}

/**
 * Check whether an IP address falls within any blocked range.
 * Returns true if the IP is dangerous and should be blocked.
 */
export function isBlockedIp(ip: string): boolean {
  // IPv6: block loopback (::1), unique-local (fc00::/7), multicast (ff00::/8),
  // link-local (fe80::/10, over-broadly as fe*), and IPv4-mapped addresses
  // whose embedded IPv4 is blocked.
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    const mapped = extractMappedIpv4(lower);
    if (mapped !== null) {
      return isBlockedIp(mapped);
    }
    return (
      lower === "::1" ||
      lower === "::" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe") ||
      lower.startsWith("ff")
    );
  }

  // IPv4: check against blocked ranges
  try {
    const num = ipv4ToNumber(ip);
    for (const [start, end] of BLOCKED_IP_RANGES) {
      if (num >= ipv4ToNumber(start) && num <= ipv4ToNumber(end)) {
        return true;
      }
    }
  } catch {
    // Unparseable IP — block it defensively
    return true;
  }

  return false;
}

interface ResolvedAddress {
  address: string;
  family: number;
}

/**
 * The validated connection target for one fetch hop. `addresses` is what the
 * socket is pinned to; empty means "no pinning" (allowlisted hosts only).
 */
interface ValidatedTarget {
  addresses: ResolvedAddress[];
}

/**
 * Resolve a hostname and validate that none of its addresses are blocked.
 * Returns the resolved addresses so the connection can be pinned to exactly
 * what was validated — validating and then letting fetch re-resolve would be
 * bypassable via low-TTL DNS rebinding. Throws if the host is blocked or
 * resolution fails.
 */
async function validateHostname(host: string): Promise<ValidatedTarget> {
  // Allowlist check — skip DNS validation for trusted hosts
  if (ALLOWED_HOSTS.has(host)) {
    return { addresses: [] };
  }

  // Reject well-known internal hostname patterns without DNS lookup.
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error(`Blocked: hostname '${host}' targets an internal network`);
  }

  // IP literals validate directly — no DNS involved. URL.hostname keeps the
  // brackets around IPv6 literals.
  const literal = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const literalFamily = net.isIP(literal);
  if (literalFamily !== 0) {
    if (isBlockedIp(literal)) {
      throw new Error(`Blocked: '${literal}' is in a restricted network range`);
    }
    return { addresses: [{ address: literal, family: literalFamily }] };
  }

  // getaddrinfo (not dns.resolve*) so hosts-file entries are validated the
  // same way the socket would resolve them, across both address families.
  let results: ResolvedAddress[];
  try {
    results = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new Error(`DNS resolution failed for '${host}'`);
  }
  if (results.length === 0) {
    throw new Error(`DNS resolution failed for '${host}'`);
  }
  for (const { address } of results) {
    if (isBlockedIp(address)) {
      throw new Error(
        `Blocked: '${host}' resolved to ${address} which is in a restricted network range`,
      );
    }
  }
  return { addresses: results };
}

/**
 * Validate that a URL is safe to fetch, checking protocol, hostname, and
 * resolved IPs. Returns the validated addresses for connection pinning.
 * Throws a descriptive error if the URL is blocked.
 */
async function validateUrlForFetch(urlString: string): Promise<ValidatedTarget> {
  const parsedUrl = new URL(urlString);

  // Only allow http/https
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error(`Blocked: only http:// and https:// URLs are allowed`);
  }

  return validateHostname(parsedUrl.hostname);
}

type PinnedLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | ResolvedAddress[],
  family?: number,
) => void;

/**
 * Dispatcher whose socket lookup answers from the pre-validated address set
 * instead of re-querying DNS — the connection can only reach an IP that
 * passed isBlockedIp. TLS keeps the hostname as servername, so certificate
 * validation is unaffected. An empty address set (allowlisted hosts) falls
 * back to the default resolver.
 */
function buildPinnedDispatcher(target: ValidatedTarget): Agent {
  if (target.addresses.length === 0) {
    return new Agent();
  }
  const pinned = target.addresses;
  const lookup = (
    _hostname: string,
    options: { all?: boolean },
    callback: PinnedLookupCallback,
  ): void => {
    if (options.all) {
      callback(null, pinned);
    } else {
      const first = pinned[0];
      callback(null, first.address, first.family);
    }
  };
  return new Agent({ connect: { lookup: lookup as net.LookupFunction } });
}

/**
 * Built-in coding tools for the OpenAI-compatible native provider. These run
 * in the daemon process against the agent's cwd — there is no external agent
 * binary, so the daemon is the tool runtime. Definitions use the OpenAI
 * function-calling schema so any /chat/completions server that supports
 * `tools` can drive them.
 */

/**
 * Gating class used by the session's permission modes. "network" tools reach
 * the outside world and always prompt outside bypassPermissions: an unprompted
 * web_fetch turns the unprompted read tools into a data-exfiltration channel
 * (read a secret, smuggle it out in a GET query string), so it must never
 * share the read tools' no-prompt treatment.
 */
export type CompatToolKind = "read" | "edit" | "execute" | "network";

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
/** Stop buffering command output past this point — only the head is ever shown. */
const MAX_COMMAND_BUFFER_BYTES = 1024 * 1024;
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".expo",
  ".next",
  ".dev",
]);

// --- Web tool constants ---
const DDG_API_URL = "https://api.duckduckgo.com";
const DDG_HTML_URL = "https://html.duckduckgo.com/html/";
const MAX_WEB_FETCH_BYTES = 1_000_000;
const MAX_WEB_FETCH_OUTPUT = 15_000;
const WEB_SEARCH_TIMEOUT_MS = 15_000;
const WEB_FETCH_TIMEOUT_MS = 30_000;
const MAX_WEB_SEARCH_RESULTS = 15;
const MAX_WEB_FETCH_REDIRECTS = 5;

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
    name: "web_search",
    kind: "read",
    description:
      "Search the web using DuckDuckGo. Returns a list of results with titles, URLs and snippets. " +
      "Use this to find current information, documentation, or anything not available locally.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "web_fetch",
    kind: "network",
    description:
      "Fetch the content of a web page and return it as readable text. " +
      "Use this to read the full content of a specific URL found via web_search or provided directly.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
        max_length: {
          type: "number",
          description: "Maximum characters to return (default 15000, capped at 30000)",
        },
      },
      required: ["url"],
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
    case "web_search":
      return webSearchTool(input);
    case "web_fetch":
      return webFetchTool(input);
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
    case "web_search":
      return { type: "search", query: readString(args, "query") ?? "", toolName: "web_search" };
    case "web_fetch":
      return { type: "fetch", url: readString(args, "url") ?? "" };
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

/**
 * True when the target path stays inside the workspace subtree. Used to scope
 * acceptEdits auto-approval: edits outside the cwd (~/.bashrc, Otto's own
 * config) still prompt. Purely lexical — symlinks are not chased — so it
 * gates prompting, it is not a sandbox.
 */
export function isPathInsideWorkspace(cwd: string, target: string): boolean {
  const relative = path.relative(cwd, path.resolve(cwd, target));
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
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
  // split/join, never String.replace: with a string search value, replace()
  // interprets $&, $`, $' and $$ in the replacement and silently splices
  // surrounding file content into the write.
  const updated = content.split(oldString).join(newString);
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
  // stdin closed from the start — a command that reads stdin should see EOF
  // immediately instead of hanging until the timeout kills it.
  const child = spawn(command, {
    shell: true,
    cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
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

  const append = (chunk: Buffer) => {
    if (output.length < MAX_COMMAND_BUFFER_BYTES) {
      output += chunk.toString("utf8");
    }
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

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

// ---------------------------------------------------------------------------
// DuckDuckGo web search & fetch helpers
// ---------------------------------------------------------------------------

/** Make an HTTP request with an optional timeout and abort signal. */
async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** Simple HTML entity decoder for common entities. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)));
}

/** Strip HTML tags and collapse whitespace. */
function stripHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// web_search — DuckDuckGo Instant Answer API + HTML scraping fallback
// ---------------------------------------------------------------------------

interface DdgInstantAnswerResult {
  title?: string;
  url?: string;
  body?: string;
  abstract?: string;
  abstractURL?: string;
  heading?: string;
}

interface DdgRelatedTopicResult {
  FirstURL?: string;
  Text?: string;
  Icon?: { URL?: string };
}

interface DdgResult {
  Heading?: string;
  Text?: string;
  URL?: string;
  AbstractURL?: string;
  Abstract?: string;
  RelatedTopics?: unknown[];
}

interface DdgInstantAnswerResponse {
  Result?: DdgInstantAnswerResult;
  RelatedTopics?: DdgRelatedTopicResult[];
  Results?: DdgResult[];
  NoResults?: string;
}

interface DdgHtmlResult {
  title: string;
  url: string;
  snippet: string;
}

async function ddgInstantAnswerSearch(query: string): Promise<DdgInstantAnswerResponse> {
  const url = new URL(`${DDG_API_URL}/`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_redirect", "1");

  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; Otto/1.0; +https://github.com/otto-ai/otto-code)",
      },
    },
    WEB_SEARCH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`DuckDuckGo API returned ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as DdgInstantAnswerResponse;
  } catch {
    return {};
  }
}

async function ddgHtmlSearch(query: string): Promise<DdgHtmlResult[]> {
  const url = new URL(DDG_HTML_URL);
  url.searchParams.set("q", query);

  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    },
    WEB_SEARCH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`DuckDuckGo HTML search returned ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  return parseDdgHtmlResults(html);
}

interface DdgAnchorHit {
  tag: string;
  inner: string;
  start: number;
  end: number;
}

export function parseDdgHtmlResults(html: string): DdgHtmlResult[] {
  const results: DdgHtmlResult[] = [];

  // DDG's container markup changes across revisions (<li class="result">,
  // <div class="result web-result">, …) and attribute order isn't stable, so
  // key off the stable classes instead: the title anchor carries result__a
  // and the snippet element (between one title anchor and the next) carries
  // result__snippet.
  const anchorRegex = /<a\b[^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex =
    /<([a-z]+)\b[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/i;

  const anchors: DdgAnchorHit[] = [];
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) !== null && anchors.length < MAX_WEB_SEARCH_RESULTS) {
    anchors.push({
      tag: match[0],
      inner: match[1],
      start: match.index,
      end: anchorRegex.lastIndex,
    });
  }

  for (const [index, anchor] of anchors.entries()) {
    const title = stripHtml(decodeHtmlEntities(anchor.inner)).trim();

    // DDG wraps results in /l/?uddg=<encoded> redirect links; recover the
    // destination (query params intact — stripping them breaks links that
    // need them) and fall back to the raw href.
    const hrefMatch = anchor.tag.match(/\bhref="([^"]+)"/i);
    let url = hrefMatch ? decodeHtmlEntities(hrefMatch[1]) : "";
    const uddgMatch = url.match(/[?&]uddg=([^&]+)/);
    if (uddgMatch) {
      try {
        url = decodeURIComponent(uddgMatch[1]);
      } catch {
        // Malformed encoding — keep the redirect URL, it still resolves.
      }
    }

    const segment = html.slice(anchor.end, anchors[index + 1]?.start ?? html.length);
    const snippetMatch = segment.match(snippetRegex);
    const snippet = snippetMatch ? stripHtml(decodeHtmlEntities(snippetMatch[2])).trim() : "";

    if (title || url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

async function webSearchTool(input: CompatToolCallInput): Promise<CompatToolOutcome> {
  const query = readString(input.arguments, "query");
  if (!query) {
    return errorOutcome("web_search requires a 'query' argument", {
      type: "search",
      query: "",
      toolName: "web_search",
    });
  }

  const detailBase: ToolCallDetail = {
    type: "search",
    query,
    toolName: "web_search",
  };

  try {
    // Try the Instant Answer API first (fast, structured JSON)
    const instantResults = await ddgInstantAnswerSearch(query);
    const webResults: Array<{ title: string; url: string }> = [];
    const annotations: string[] = [];

    // Extract results from the Instant Answer API. Results and annotations
    // are joined by index later, so an annotation slot (possibly empty) is
    // pushed for every kept result — filling them under different conditions
    // attaches snippets to the wrong result.
    if (instantResults.Results && instantResults.Results.length > 0) {
      for (const r of instantResults.Results) {
        const url = r.AbstractURL || r.URL || "";
        if (!url) {
          continue;
        }
        webResults.push({ title: r.Heading || "", url });
        annotations.push(r.Text ?? "");
      }
    }

    // If we got good results from the API, return them
    if (webResults.length > 0) {
      const lines = webResults.map((r, i) => {
        const snippet = annotations[i] || "";
        return `${i + 1}. ${r.title}\n   URL: ${r.url}${snippet ? "\n   " + snippet : ""}`;
      });

      const output = `Web search results for "${query}":\n\n${lines.join("\n\n")}`;
      return {
        output,
        detail: {
          ...detailBase,
          webResults,
          ...(annotations.some((snippet) => snippet.length > 0) ? { annotations } : {}),
        },
      };
    }

    // Fallback: scrape DuckDuckGo HTML results
    const htmlResults = await ddgHtmlSearch(query);
    if (htmlResults.length > 0) {
      const webResultsFromHtml = htmlResults.map((r) => ({
        title: r.title,
        url: r.url,
      }));
      const lines = htmlResults.map(
        (r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}${r.snippet ? "\n   " + r.snippet : ""}`,
      );

      const output = `Web search results for "${query}":\n\n${lines.join("\n\n")}`;
      return {
        output,
        detail: {
          ...detailBase,
          webResults: webResultsFromHtml,
        },
      };
    }

    return {
      output: `No results found for "${query}"`,
      detail: detailBase,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorOutcome(`web_search failed: ${message}`, detailBase);
  }
}

// ---------------------------------------------------------------------------
// web_fetch — Fetch a URL and extract readable text
// ---------------------------------------------------------------------------

interface GuardedResponse {
  response: UndiciResponse;
  /** Closes the pinned connection pool; call once the body is consumed. */
  dispose: () => Promise<void>;
}

/**
 * Fetch a URL, following redirects manually so every hop is re-validated
 * against the SSRF blocklist — a public URL must not be able to redirect into
 * an internal/metadata address. Each hop's connection is pinned to the
 * addresses that passed validation (see buildPinnedDispatcher), so a low-TTL
 * DNS-rebinding server cannot answer validation with a public IP and the
 * connection with a private one. Throws on blocked hosts or excessive
 * redirects.
 */
async function fetchWithSsrfGuard(urlString: string): Promise<GuardedResponse> {
  let currentUrl = urlString;
  for (let hop = 0; hop <= MAX_WEB_FETCH_REDIRECTS; hop++) {
    const target = await validateUrlForFetch(currentUrl);
    const dispatcher = buildPinnedDispatcher(target);
    const dispose = async (): Promise<void> => {
      await dispatcher.close().catch(() => undefined);
    };
    let response: UndiciResponse;
    try {
      // undici's own fetch, not the global one: the pinned dispatcher must
      // come from the same undici build that executes the request.
      response = await undiciFetch(currentUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS),
        dispatcher,
      });
    } catch (error) {
      await dispose();
      throw error;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { response, dispose };
      }
      await response.body?.cancel().catch(() => undefined);
      await dispose();
      if (hop === MAX_WEB_FETCH_REDIRECTS) {
        throw new Error(`Too many redirects (>${MAX_WEB_FETCH_REDIRECTS})`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return { response, dispose };
  }
  throw new Error("No response received");
}

/**
 * Read a response body up to maxBytes. Stops reading and cancels the stream
 * the moment the cap is crossed — the whole point is that a hostile server
 * cannot stream an unbounded body into daemon memory before a size check.
 */
async function readBodyWithCap(
  response: UndiciResponse,
  maxBytes: number,
): Promise<{ body: Buffer; exceededCap: boolean }> {
  if (!response.body) {
    return { body: Buffer.alloc(0), exceededCap: false };
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = Buffer.from(value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { body: Buffer.concat(chunks), exceededCap: true };
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return { body: Buffer.concat(chunks), exceededCap: false };
}

async function webFetchTool(input: CompatToolCallInput): Promise<CompatToolOutcome> {
  const urlString = readString(input.arguments, "url");
  if (!urlString) {
    return errorOutcome("web_fetch requires a 'url' argument", {
      type: "fetch",
      url: "",
    });
  }

  // Validate URL shape up front for a friendly error message; protocol and
  // SSRF checks happen per-hop inside fetchWithSsrfGuard.
  if (!URL.canParse(urlString)) {
    return errorOutcome(`web_fetch failed: Invalid URL "${urlString}"`, {
      type: "fetch",
      url: urlString,
    });
  }

  // max_length is model-controlled — clamp it so a tool result can never
  // exceed the shared per-result context budget.
  const requestedLength = readNumber(input.arguments, "max_length");
  const maxLength = Math.min(
    Math.max(requestedLength ?? MAX_WEB_FETCH_OUTPUT, 1),
    MAX_TOOL_OUTPUT_CHARS,
  );

  const detailBase: ToolCallDetail = {
    type: "fetch",
    url: urlString,
  };

  try {
    const { response, dispose } = await fetchWithSsrfGuard(urlString);
    let bodyResult: { body: Buffer; exceededCap: boolean };
    try {
      // Reject oversized responses up front when the server declares a
      // length; the streamed cap below covers servers that lie or omit it.
      const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_WEB_FETCH_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        return errorOutcome(
          `web_fetch failed: Response too large (${declaredLength} bytes, max ${MAX_WEB_FETCH_BYTES})`,
          detailBase,
        );
      }
      bodyResult = await readBodyWithCap(response, MAX_WEB_FETCH_BYTES);
    } finally {
      await dispose();
    }
    if (bodyResult.exceededCap) {
      return errorOutcome(
        `web_fetch failed: Response too large (>${MAX_WEB_FETCH_BYTES} bytes)`,
        detailBase,
      );
    }

    const statusText = response.status >= 400 ? response.statusText : "OK";
    const bytes = bodyResult.body.byteLength;
    const encoding = normalizeBufferEncoding(
      extractCharset(response.headers.get("content-type") ?? ""),
    );

    const text = bodyResult.body.toString(encoding);
    const isHtml = response.headers.get("content-type")?.includes("text/html") ?? false;

    let content: string;
    if (isHtml) {
      content = extractReadableTextFromHtml(text);
    } else {
      // Try to parse as JSON for pretty-printing
      try {
        const json = JSON.parse(text);
        content = JSON.stringify(json, null, 2);
      } catch {
        content = text;
      }
    }

    const truncated = content.length > maxLength;
    const result = truncated ? content.slice(0, maxLength) : content;

    const output = `Fetched ${urlString} (${response.status} ${statusText}, ${bytes} bytes)\n\n${result}${truncated ? "\n\n[truncated]" : ""}`;

    return {
      output: capToolOutput(output),
      detail: {
        ...detailBase,
        result: result.slice(0, 500) + (truncated ? "..." : ""),
        code: response.status,
        codeText: statusText,
        bytes,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorOutcome(`web_fetch failed: ${message}`, detailBase);
  }
}

/** Extract a charset from a Content-Type header value. */
function extractCharset(contentType: string): string | null {
  const match = contentType.match(/charset=([^\s;]+)/i);
  return match ? match[1] : null;
}

/**
 * Map a charset label to a Node Buffer encoding, falling back to utf-8 for
 * anything Node's Buffer can't decode (e.g. windows-1252). Buffer.toString
 * throws on unknown encodings, so this keeps web_fetch from failing on pages
 * that declare an exotic charset.
 */
function normalizeBufferEncoding(charset: string | null): BufferEncoding {
  switch (charset?.toLowerCase().trim()) {
    case "utf-8":
    case "utf8":
      return "utf-8";
    case "iso-8859-1":
    case "latin1":
    case "us-ascii":
    case "ascii":
      return "latin1";
    case "utf-16le":
    case "utf-16":
    case "ucs-2":
      return "utf16le";
    default:
      return "utf-8";
  }
}

/**
 * Extract readable text from an HTML document.
 * Strips scripts, styles, nav, footer, etc. and returns the main content.
 */
function extractReadableTextFromHtml(html: string): string {
  let text = html;

  // Remove script and style contents
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

  // Remove comments
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Try to extract <body> content
  const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    text = bodyMatch[1];
  }

  // Try to extract <article> or <main> content (preferred for readability)
  const articleMatch = text.match(/<(?:article|main)[^>]*>([\s\S]*?)<\/(?:article|main)>/i);
  if (articleMatch) {
    text = articleMatch[1];
  }

  // Add newlines for block elements
  text = text.replace(/<\/(?:p|div|h[1-6]|li|br|tr|blockquote|pre)>/gi, "\n");
  text = text.replace(/<li/gi, "\n- ");
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode entities
  text = decodeHtmlEntities(text);

  // Collapse whitespace
  text = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

function describeFsError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
