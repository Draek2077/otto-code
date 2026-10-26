import { z } from "zod";
import type { PaseoToolDefinition } from "../../agent/tools/types.js";
import type { PreviewHost, PreviewBinding } from "./host.js";
import type { RetainedToolPolicy } from "../retained-tool-policy.js";

const empty = z.object({}).strict();
const server = z.object({ serverId: z.string().min(1).max(512) }).strict();
const start = z
  .object({
    name: z.string().min(1).max(128),
    commandRevision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const logs = server.extend({
  lines: z.number().int().min(1).max(2000).optional(),
  search: z.string().max(512).optional(),
  level: z.enum(["all", "error"]).optional(),
});
export interface PreviewToolCaller {
  binding: PreviewBinding | null;
  provider?: string;
}
/** Agent scope comes only from the active host session; models cannot name another directory. */
export function createPreviewTools(ports: {
  host: Pick<PreviewHost, "list" | "start" | "stop" | "logs">;
  caller(): PreviewToolCaller;
  policy: RetainedToolPolicy;
}): PaseoToolDefinition[] {
  const tool = <S extends z.ZodType>(
    name: string,
    description: string,
    schema: S,
    run: (binding: PreviewBinding, input: z.infer<S>) => Promise<unknown>,
  ): PaseoToolDefinition => ({
    name,
    description,
    inputSchema: schema,
    async handler(input) {
      const caller = ports.caller();
      const parsed = schema.safeParse(input);
      if (!parsed.success)
        return failure("Use the advertised Preview inputs. Paths and host IDs are not accepted.");
      if (!caller.binding) return failure("Preview requires this chat's active workspace.");
      try {
        if (!(await ports.policy(name, caller.provider)))
          return failure(
            "Preview tools are disabled or the owning host/provider policy could not be read. No operation was attempted.",
          );
        const result = await run(caller.binding, parsed.data);
        if (Buffer.byteLength(JSON.stringify(result), "utf8") > 192 * 1024)
          return failure(
            "This Preview response exceeds the tool budget. Reduce the launch configuration or request a small, filtered log tail. No automatic retry was started.",
          );
        return { content: [], structuredContent: result };
      } catch {
        // Execution output, environment and filesystem errors may contain credentials.
        return failure(
          "Preview could not acknowledge this operation. Read preview_list and preview_logs before another lifecycle action; do not automatically start another server or choose another port.",
        );
      }
    },
  });
  return [
    tool(
      "preview_list",
      "Read this chat workspace's .claude/launch.json commands and tracked servers before starting anything. Prefer an existing server by name or port. commandRevision pins the executable, arguments, environment and working directory without exposing environment values. A configError leaves tracked servers available for logs and explicit stop.",
      empty,
      (binding) => ports.host.list(binding),
    ),
    tool(
      "preview_start",
      'Start OR reuse a configured development server in this chat workspace. First call preview_list and pass its name and commandRevision. Never invent another port because the configured port is busy. If missing, inspect the project with ordinary file tools and create .claude/launch.json as {"version":"0.0.1","configurations":[{"name":"web","runtimeExecutable":"npm","runtimeArgs":["run","dev"],"port":3000}]}, then ask which server to start. Optional url is an absolute HTTP(S) destination; optional env is a string map. The provider must approve the resolved command, not merely this tool name. Use ONLY the returned server.browserId with browser_* tools to verify the result; prefer snapshots and narrow inspection over screenshots. A browserError means the process remains tracked: do not start a second process.',
      start,
      (binding, input) => ports.host.start(binding, input.name, input.commandRevision),
    ),
    tool(
      "preview_stop",
      "Explicitly stop an Otto-owned Preview process tree in this chat workspace. Use a serverId from preview_list. Adopted external processes have no stop authority and are refused; never infer or kill a PID from a port. Closing a browser does not stop a server.",
      server,
      (binding, input) => ports.host.stop(binding, input.serverId),
    ),
    tool(
      "preview_logs",
      "Read a bounded tail of Preview stdout/stderr. Prefer search or level:error and a small line count. The retained ring has 2,000 lines; each response also has a 128 KiB encoded budget. Logs may contain project secrets: do not copy them into prompts or reports unnecessarily.",
      logs,
      (binding, input) => ports.host.logs(binding, input.serverId, input),
    ),
  ];
}
function failure(message: string) {
  return { content: [], isError: true, structuredContent: { ok: false, error: { message } } };
}
