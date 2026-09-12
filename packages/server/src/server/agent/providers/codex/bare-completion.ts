import { z } from "zod";
import type { AgentBareCompletionOptions } from "../../agent-sdk-types.js";
import type { CodexAppServerClient } from "./app-server-transport.js";

const COMPLETION_TIMEOUT_MS = 90_000;
const BASE_INSTRUCTIONS =
  "Generate the requested text using only the supplied prompt. Do not use tools or inspect files. Return only the requested output.";
const RecordSchema = z.record(z.string(), z.unknown());
const ThreadSchema = z.object({
  thread: z.object({ id: z.string().min(1) }),
  model: z.string().optional(),
});

function record(value: unknown): Record<string, unknown> {
  const parsed = RecordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function completionConfig(inherited: unknown, customConfig?: Record<string, unknown> | null) {
  const config: Record<string, unknown> = {
    ...customConfig,
    project_doc_max_bytes: 0,
    developer_instructions: "",
    notify: [],
    include_permissions_instructions: false,
    include_collaboration_mode_instructions: false,
    include_apps_instructions: false,
    web_search: "disabled",
    "skills.include_instructions": false,
    "features.skip_host_skill_discovery": true,
    "tools.update_plan.enabled": false,
  };
  // An empty table can merge with inherited entries. Disable every entry and
  // keep names inside the table: Codex splits dotted override keys literally,
  // including dots in a server or plugin name. Keep only the transport selector
  // needed for validation, not credentials or nullable config/read defaults.
  for (const section of ["mcp_servers", "plugins"]) {
    config[section] = Object.fromEntries(
      Object.entries(record(record(inherited)[section])).map(([name, value]) => {
        const entry = record(value);
        return [
          name,
          {
            enabled: false,
            ...(section === "mcp_servers" && typeof entry.command === "string"
              ? { command: entry.command }
              : {}),
            ...(section === "mcp_servers" && typeof entry.url === "string"
              ? { url: entry.url }
              : {}),
          },
        ];
      }),
    );
  }
  for (const feature of [
    "shell_tool",
    "unified_exec",
    "apply_patch_freeform",
    "view_image",
    "image_generation",
    "apps",
    "plugins",
    "remote_plugin",
    "recommended_plugins",
    "memories",
    "hooks",
    "multi_agent",
    "multi_agent_v2",
    "goals",
    "code_mode",
    "code_mode_only",
    "code_mode_host",
    "computer_use",
    "browser_use",
    "browser_use_external",
    "in_app_browser",
    "sleep_tool",
    "skill_search",
    "tool_suggest",
    "request_permissions_tool",
    "default_mode_request_user_input",
  ]) {
    config[`features.${feature}`] = false;
  }
  return config;
}

export interface CodexBareCompletionResult {
  text: string;
  tokenUsage?: unknown;
  model?: string;
}

/** Owns one dedicated app-server client, including teardown on every exit. */
export async function runCodexBareCompletion(input: {
  client: CodexAppServerClient;
  options: AgentBareCompletionOptions;
  initializeParams: unknown;
  customConfig?: Record<string, unknown> | null;
}): Promise<CodexBareCompletionResult> {
  const { client, options } = input;
  let threadId: string | undefined;
  let model = options.model;
  let tokenUsage: unknown;
  const messages = new Map<string, string>();
  let finish!: (result: CodexBareCompletionResult) => void;
  let fail!: (error: Error) => void;
  const completed = new Promise<CodexBareCompletionResult>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const onAbort = () =>
    fail(
      options.signal?.reason instanceof Error
        ? options.signal.reason
        : new Error("Codex metadata generation canceled"),
    );
  const timer = setTimeout(
    () => fail(new Error("Codex metadata generation timed out after 90 seconds")),
    COMPLETION_TIMEOUT_MS,
  );
  client.setUnexpectedTerminationHandler(fail);
  client.setNotificationHandler((method, raw) => {
    const params = record(raw);
    if (!threadId || params.threadId !== threadId) return;
    if (method === "thread/tokenUsage/updated") {
      tokenUsage = params.tokenUsage;
    } else if (method === "item/started") {
      const item = record(params.item);
      if (
        typeof item.type === "string" &&
        !["userMessage", "agentMessage", "reasoning"].includes(item.type)
      ) {
        fail(new Error(`Codex metadata generation attempted a tool or action: ${item.type}`));
      }
    } else if (method === "item/completed") {
      const item = record(params.item);
      if (
        item.type === "agentMessage" &&
        typeof item.id === "string" &&
        typeof item.text === "string" &&
        item.phase !== "commentary"
      ) {
        messages.set(item.id, item.text);
      }
    } else if (method === "turn/completed") {
      const turn = record(params.turn);
      if (turn.status !== "completed") {
        const error = record(turn.error);
        fail(
          new Error(
            typeof error.message === "string"
              ? error.message
              : `Codex metadata generation ${String(turn.status)}`,
          ),
        );
        return;
      }
      const text = [...messages.values()].join("\n").trim();
      if (!text) fail(new Error("Codex metadata generation returned no text"));
      else finish({ text, tokenUsage, model });
    }
  });
  // A metadata request must never wait for a permission dialog or user input.
  for (const method of [
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "item/tool/requestUserInput",
    "tool/requestUserInput",
    "item/tool/call",
    "mcpServer/elicitation/request",
  ]) {
    client.setRequestHandler(method, () => {
      const error = new Error(`Codex metadata generation unexpectedly requested ${method}`);
      fail(error);
      throw error;
    });
  }
  options.signal?.addEventListener("abort", onAbort, { once: true });
  async function start() {
    options.signal?.throwIfAborted();
    await client.request("initialize", input.initializeParams, COMPLETION_TIMEOUT_MS);
    client.notify("initialized", {});
    const inherited = record(
      await client.request(
        "config/read",
        { cwd: options.cwd, includeLayers: false },
        COMPLETION_TIMEOUT_MS,
      ),
    ).config;
    const response = ThreadSchema.parse(
      await client.request(
        "thread/start",
        {
          cwd: options.cwd,
          ...(options.model ? { model: options.model } : {}),
          ephemeral: true,
          approvalPolicy: "never",
          sandbox: "read-only",
          baseInstructions: options.systemPrompt
            ? `${BASE_INSTRUCTIONS}\n\n${options.systemPrompt}`
            : BASE_INSTRUCTIONS,
          developerInstructions: "",
          environments: [],
          config: completionConfig(inherited, input.customConfig),
        },
        COMPLETION_TIMEOUT_MS,
      ),
    );
    threadId = response.thread.id;
    model = response.model ?? model;
    await client.request(
      "turn/start",
      {
        threadId,
        input: [{ type: "text", text: options.prompt, text_elements: [] }],
        ...(options.thinkingOptionId ? { effort: options.thinkingOptionId } : {}),
      },
      COMPLETION_TIMEOUT_MS,
    );
    return await completed;
  }
  try {
    // Attach both consumers before startup can emit notifications or fail.
    return await Promise.race([completed, start()]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    await client.dispose();
  }
}
