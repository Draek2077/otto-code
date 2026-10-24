import { randomUUID } from "node:crypto";
import { open, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnProcess, terminateProcess } from "@getpaseo/plugin/server";
import type { ProviderSessionConfig, ProviderToolCallDetail } from "../../../server/provider.js";
import { z } from "zod";
import type { ToolDefinition } from "./completions.js";

export interface AgentTool {
  access?: "read" | "write" | "execute" | "unknown";
  definition: ToolDefinition;
  detail(input: Record<string, unknown>): ProviderToolCallDetail;
  execute(input: Record<string, unknown>, signal: AbortSignal): Promise<string | ToolOutput>;
  preapproval?: { server: string; tool: string };
}
export interface ToolOutput {
  text: string;
  images: Array<{ type: "image"; mimeType: string; data: string }>;
}

export function boundedResult(text: string): string {
  return text.length <= 16000
    ? text
    : `${text.slice(0, 16000)}\n[Output truncated at 16000 characters.]`;
}

function definition(name: string, description: string, schema: z.ZodType): ToolDefinition {
  const parameters = z.toJSONSchema(schema);
  delete parameters.$schema;
  return { type: "function", function: { name, description, parameters } };
}

const readInput = z.object({
  path: z.string().min(1),
  offset: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
});
const writeInput = z.object({ path: z.string().min(1), content: z.string().max(1024 * 1024) });
const commandInput = z.object({
  command: z.string().min(1),
  timeout_ms: z.number().int().min(1000).max(300000).optional(),
});

export function nativeTools(config: ProviderSessionConfig): AgentTool[] {
  return [
    {
      access: "read",
      definition: definition(
        "otto_read_file",
        "Read a text file on the agent host. Paths resolve from the workspace. Use offset (1-based line) and limit to inspect a bounded part of a file. Execution follows the selected permission mode.",
        readInput,
      ),
      detail(input) {
        const value = readInput.parse(input);
        return { type: "read", filePath: path.resolve(config.cwd, value.path) };
      },
      async execute(input, signal) {
        const value = readInput.parse(input);
        signal.throwIfAborted();
        const file = await open(path.resolve(config.cwd, value.path), "r");
        try {
          const buffer = Buffer.alloc(1024 * 1024 + 1);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          if (bytesRead > 1024 * 1024)
            throw new Error(
              "This file exceeds 1 MiB; inspect a smaller file or use an approved command.",
            );
          const text = buffer.subarray(0, bytesRead).toString("utf8");
          if (text.includes("\0")) throw new Error("This tool reads text files, not binary files.");
          const lines = text.split(/\r?\n/);
          const offset = (value.offset ?? 1) - 1;
          const selected = lines.slice(offset, offset + (value.limit ?? 200));
          return boundedResult(
            selected.map((line, index) => `${offset + index + 1}: ${line}`).join("\n") +
              `\n[${selected.length} lines shown; ${lines.length} total.]`,
          );
        } finally {
          await file.close();
        }
      },
    },
    {
      access: "write",
      definition: definition(
        "otto_write_file",
        "Write UTF-8 text to a file on the agent host, replacing its content. Read an existing file before changing it. Paths resolve from the workspace. Execution follows the selected permission mode.",
        writeInput,
      ),
      detail(input) {
        const value = writeInput.parse(input);
        return {
          type: "write",
          filePath: path.resolve(config.cwd, value.path),
          content: value.content,
        };
      },
      async execute(input, signal) {
        const value = writeInput.parse(input);
        signal.throwIfAborted();
        const file = path.resolve(config.cwd, value.path);
        const temporary = path.join(
          path.dirname(file),
          `.${path.basename(file)}.otto-${randomUUID()}.tmp`,
        );
        let mode = 0o600;
        try {
          mode = (await stat(file)).mode & 0o777;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        try {
          await writeFile(temporary, value.content, { mode, flag: "wx", signal });
          signal.throwIfAborted();
          await rename(temporary, file);
          return `Wrote ${Buffer.byteLength(value.content)} bytes to ${file}.`;
        } finally {
          await rm(temporary, { force: true });
        }
      },
    },
    {
      access: "execute",
      definition: definition(
        "otto_exec_command",
        "Run a shell command on the agent host in the workspace. Before changing files, inspect AGENTS.md or CLAUDE.md rules in their directories. Explain destructive operations in the command request. Execution follows the selected permission mode. Output is bounded; use timeout_ms for a shorter deadline.",
        commandInput,
      ),
      detail(input) {
        const value = commandInput.parse(input);
        return { type: "shell", command: value.command, cwd: config.cwd };
      },
      async execute(input, signal) {
        const value = commandInput.parse(input);
        signal.throwIfAborted();
        const abort = AbortSignal.any([signal, AbortSignal.timeout(value.timeout_ms ?? 120000)]);
        const windows = process.platform === "win32";
        const command = windows ? (config.env.ComSpec ?? "cmd.exe") : "/bin/sh";
        const args = windows ? ["/d", "/s", "/c", value.command] : ["-c", value.command];
        const child = spawnProcess(command, args, {
          cwd: config.cwd,
          env: { ...config.env },
          windowsHide: true,
          shell: false,
          stdio: "pipe",
        });
        child.stdin.end();
        let output = "";
        const append = (chunk: Buffer) => {
          if (output.length < 16000)
            output += chunk.toString("utf8").slice(0, 16000 - output.length);
        };
        child.stdout.on("data", append);
        child.stderr.on("data", append);
        const stop = () => {
          void terminateProcess(child).catch(() => child.kill());
        };
        abort.addEventListener("abort", stop, { once: true });
        if (abort.aborted) stop();
        try {
          const code = await new Promise<number | null>((resolve, reject) => {
            child.once("close", resolve);
            child.once("error", reject);
          });
          abort.throwIfAborted();
          return `${output}\n[Exit code: ${code ?? "unknown"}${output.length >= 16000 ? "; output truncated" : ""}]`;
        } finally {
          abort.removeEventListener("abort", stop);
        }
      },
    },
  ];
}
