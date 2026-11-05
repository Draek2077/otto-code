import path from "node:path";
import { realpath } from "node:fs/promises";
import type { GraphQueryTool, WorkflowLaunch, GraphNode } from "@getpaseo/plugin/otto/workflows";
import { WorkflowError, readWorkflowFile, withWorkflowCleanup } from "./files.js";
import { validateNodeOutput } from "./node-output.js";

export function queryToolName(tool: GraphQueryTool): string {
  return `query_${tool.name}`;
}
/** argv is injection-resistant, not read-only. Commands and arbitrary GET destinations require explicit launch authority. */
export function workflowQueryProblems(
  launch: Extract<WorkflowLaunch, { kind: "graph" }>,
): string[] {
  const problems: string[] = [];
  for (const node of launch.graph.nodes) {
    const names = new Set<string>();
    if ((node.queryTools?.length ?? 0) > 16)
      problems.push(`Node ${node.id} exceeds 16 query tools.`);
    for (const tool of node.queryTools ?? []) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(tool.name) || names.has(tool.name))
        problems.push(`Node ${node.id} has an invalid or duplicate query name.`);
      names.add(tool.name);
      problems.push(...queryAuthorityProblems(tool, node, launch.allowQueryEffects === true));
    }
  }
  return problems;
}
function queryAuthorityProblems(
  tool: GraphQueryTool,
  node: GraphNode,
  allowEffects: boolean,
): string[] {
  const problems: string[] = [];
  if (!new Set(["command", "http-get", "file-read"]).has(tool.kind))
    problems.push(`Unknown query kind ${tool.kind}.`);
  if (tool.kind !== "file-read" && !allowEffects)
    problems.push(
      `Node ${node.id} requires explicit approval for host command/network query effects.`,
    );
  if (tool.kind === "command") problems.push(...commandProblems(tool, node));
  if (tool.kind === "file-read" && (!tool.path || node.access === "none"))
    problems.push(`File query ${tool.name} requires a path and workspace read access.`);
  if (tool.kind === "http-get" && !validQueryOrigin(tool.url))
    problems.push(`HTTP query ${tool.name} requires a literal HTTP(S) origin without credentials.`);
  return problems;
}
function validQueryOrigin(value: string | undefined): boolean {
  try {
    const url = new URL(value ?? "");
    return (
      new Set(["http:", "https:"]).has(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.origin.includes("{{")
    );
  } catch {
    return false;
  }
}
function commandProblems(tool: GraphQueryTool, node: GraphNode): string[] {
  const problems: string[] = [];
  if (node.access && node.access !== "write")
    problems.push(
      `Command query ${tool.name} requires write access; shell:false is not a read-only boundary.`,
    );
  if (
    !tool.command?.length ||
    tool.command.length > 64 ||
    tool.command.some((a) => a.length > 4096)
  )
    problems.push(`Command query ${tool.name} has invalid argv.`);
  return problems;
}
function substitute(template: string, values: Record<string, unknown>, encode = false): string {
  return template.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_match, key: string) => {
    if (!Object.hasOwn(values, key))
      throw new WorkflowError("invalid", `Query parameter ${key} was not supplied.`);
    const value = values[key];
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return encode ? encodeURIComponent(text ?? "") : (text ?? "");
  });
}
export interface WorkflowQueryPorts {
  fetch?: typeof fetch;
  command?(argv: string[], cwd: string, signal: AbortSignal): Promise<string>;
}
export async function executeWorkflowQuery(
  tool: GraphQueryTool,
  raw: unknown,
  cwd: string,
  signal: AbortSignal,
  ports: WorkflowQueryPorts = {},
): Promise<string> {
  signal.throwIfAborted();
  const encoded = JSON.stringify(raw);
  if (encoded === undefined || Buffer.byteLength(encoded) > 32000)
    throw new WorkflowError("invalid", "Query parameters exceed their budget.");
  const checked = validateNodeOutput(tool.parameters ?? [], raw);
  if (!checked.ok) throw new WorkflowError("invalid", checked.message);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
  let result: string;
  if (tool.kind === "file-read")
    result = await readQueryFile(cwd, substitute(tool.path ?? "", checked.value));
  else if (tool.kind === "http-get")
    result = await readQueryUrl(tool, checked.value, deadline, ports.fetch ?? fetch);
  else if (tool.kind === "command")
    result = await (ports.command ?? runQueryCommand)(
      (tool.command ?? []).map((a) => substitute(a, checked.value)),
      cwd,
      deadline,
    );
  else throw new WorkflowError("unsupported", "This query tool kind is unavailable.");
  deadline.throwIfAborted();
  return result.length > 16000
    ? `${result.slice(0, 16000)}\n[Query result truncated at 16,000 characters.]`
    : result;
}
async function readQueryFile(cwd: string, value: string): Promise<string> {
  const root = await realpath(cwd),
    file = await realpath(path.resolve(cwd, value)),
    relative = path.relative(root, file);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new WorkflowError("invalid", "Query file is outside this workspace.");
  const text = await readWorkflowFile(file, 64000);
  if (text === null || text.includes("\0"))
    throw new WorkflowError("invalid", "Query file is missing or is not bounded text.");
  return text;
}
async function readQueryUrl(
  tool: GraphQueryTool,
  values: Record<string, unknown>,
  signal: AbortSignal,
  transport: typeof fetch,
): Promise<string> {
  const declared = new URL(tool.url ?? ""),
    url = new URL(substitute(tool.url ?? "", values, true));
  if (url.origin !== declared.origin || url.username || url.password)
    throw new WorkflowError("invalid", "Query URL changed its approved origin.");
  const response = await transport(url, {
    method: "GET",
    redirect: "error",
    credentials: "omit",
    signal,
  });
  return withWorkflowCleanup(
    async () => {
      if (!response.ok)
        throw new WorkflowError("unavailable", `Query endpoint returned HTTP ${response.status}.`);
      const reader = response.body?.getReader();
      if (!reader) return "";
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      return withWorkflowCleanup(
        async () => {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.length;
            if (bytes > 64000) throw new WorkflowError("invalid", "Query response exceeds 64 KB.");
            chunks.push(next.value);
          }
          return Buffer.concat(chunks).toString("utf8");
        },
        async () => {
          try {
            await reader.cancel();
          } finally {
            reader.releaseLock();
          }
        },
      );
    },
    async () => {
      if (response.body && !response.body.locked) await response.body.cancel();
    },
  );
}
async function runQueryCommand(argv: string[], cwd: string, signal: AbortSignal): Promise<string> {
  if (!argv.length) throw new WorkflowError("invalid", "Query command has no executable.");
  const { spawnProcess, terminateProcess } = await import("@getpaseo/plugin/server");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined &&
        new Set([
          "PATH",
          "SYSTEMROOT",
          "COMSPEC",
          "PATHEXT",
          "TEMP",
          "TMP",
          "HOME",
          "USERPROFILE",
        ]).has(key.toUpperCase()),
    ),
  );
  const child = spawnProcess(argv[0], argv.slice(1), {
    cwd,
    env,
    shell: false,
    windowsHide: true,
    stdio: "pipe",
  });
  child.stdin.end();
  let text = "";
  const append = (chunk: Buffer) => {
    text += chunk.toString("utf8").slice(0, Math.max(0, 16000 - text.length));
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  let stopping: Promise<void> | null = null;
  const stop = () => {
    stopping ??= terminateProcess(child);
    void stopping.catch(() => undefined);
  };
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("close", resolve);
      child.once("error", reject);
    });
    signal.throwIfAborted();
    if (code !== 0)
      throw new WorkflowError(
        "unavailable",
        `Query command failed (${code ?? "unknown"}). ${text.slice(0, 2000)}`,
      );
    return text;
  } finally {
    signal.removeEventListener("abort", stop);
    if (stopping) await stopping;
  }
}
