import { z } from "zod";

import type { ToolCallDetail } from "../../agent-sdk-types.js";
import {
  ToolEditInputSchema,
  ToolEditOutputSchema,
  ToolReadInputSchema,
  ToolReadOutputSchema,
  ToolSearchInputSchema,
  ToolGrepOutputSchema,
  ToolGlobOutputSchema,
  ToolShellInputSchema,
  ToolShellOutputSchema,
  ToolWebFetchInputSchema,
  ToolWebFetchOutputSchema,
  ToolWebSearchOutputSchema,
  ToolWriteInputSchema,
  ToolWriteOutputSchema,
  toEditToolDetail,
  toFetchToolDetail,
  toReadToolDetail,
  toSearchToolDetail,
  toShellToolDetail,
  toWriteToolDetail,
  toolDetailBranchByName,
} from "../tool-call-detail-primitives.js";

const ClaudeGrepOutputSchema = z
  .union([
    ToolGrepOutputSchema,
    z
      .object({ output: z.string() })
      .passthrough()
      .transform(({ output }) => ({ numFiles: 0, filenames: [], content: output })),
  ])
  .nullable();

const ClaudeToolEnvelopeSchema = z
  .object({
    name: z.string().min(1),
    input: z.unknown().nullable(),
    output: z.unknown().nullable(),
  })
  .passthrough();

// Claude's subagent fan-out tool ("Task", renamed "Agent" in newer CLIs).
// Mapping it to a sub_agent detail from the very first running item matters:
// consumers keying on detail.type (the visualizer's subagent_dispatch/return,
// the chat's sub-agent card) never see the sidechain tracker's later enriched
// updates if they dedupe per callId on the first item.
const ClaudeSubAgentInputSchema = z
  .object({
    description: z.string().optional(),
    subagent_type: z.string().optional(),
  })
  .passthrough();

function readClaudeSubAgentResultText(output: unknown): string | undefined {
  if (typeof output === "string") {
    return output.trim() || undefined;
  }
  if (output && typeof output === "object" && "output" in output) {
    const nested = (output as { output?: unknown }).output;
    if (typeof nested === "string") {
      return nested.trim() || undefined;
    }
  }
  return undefined;
}

function toClaudeSubAgentDetail(
  input: z.infer<typeof ClaudeSubAgentInputSchema> | null,
  output: unknown,
): ToolCallDetail {
  const subAgentType = input?.subagent_type?.trim();
  const description = input?.description?.trim();
  return {
    type: "sub_agent",
    ...(subAgentType ? { subAgentType } : {}),
    ...(description ? { description } : {}),
    log: readClaudeSubAgentResultText(output) ?? "",
  };
}

const ClaudeSpeakToolDetailSchema = z
  .object({
    name: z.literal("speak"),
    input: z
      .union([
        z.string().transform((text) => ({ text })),
        z.object({ text: z.string() }).passthrough(),
      ])
      .nullable(),
    output: z.unknown().nullable(),
  })
  .transform(({ input }) => {
    const text = input?.text?.trim() ?? "";
    if (!text) {
      return undefined;
    }
    return {
      type: "unknown",
      input: text,
      output: null,
    } satisfies ToolCallDetail;
  });

const ClaudeToolDetailPass2Schema = z.union([
  toolDetailBranchByName("Bash", ToolShellInputSchema, ToolShellOutputSchema, toShellToolDetail),
  toolDetailBranchByName("bash", ToolShellInputSchema, ToolShellOutputSchema, toShellToolDetail),
  toolDetailBranchByName("shell", ToolShellInputSchema, ToolShellOutputSchema, toShellToolDetail),
  toolDetailBranchByName(
    "exec_command",
    ToolShellInputSchema,
    ToolShellOutputSchema,
    toShellToolDetail,
  ),
  toolDetailBranchByName("Read", ToolReadInputSchema, z.unknown(), (input, output) => {
    const parsedOutput = ToolReadOutputSchema.safeParse(output);
    return toReadToolDetail(input, parsedOutput.success ? parsedOutput.data : null);
  }),
  toolDetailBranchByName("read", ToolReadInputSchema, z.unknown(), (input, output) => {
    const parsedOutput = ToolReadOutputSchema.safeParse(output);
    return toReadToolDetail(input, parsedOutput.success ? parsedOutput.data : null);
  }),
  toolDetailBranchByName("read_file", ToolReadInputSchema, z.unknown(), (input, output) => {
    const parsedOutput = ToolReadOutputSchema.safeParse(output);
    return toReadToolDetail(input, parsedOutput.success ? parsedOutput.data : null);
  }),
  toolDetailBranchByName("view_file", ToolReadInputSchema, z.unknown(), (input, output) => {
    const parsedOutput = ToolReadOutputSchema.safeParse(output);
    return toReadToolDetail(input, parsedOutput.success ? parsedOutput.data : null);
  }),
  toolDetailBranchByName("Write", ToolWriteInputSchema, ToolWriteOutputSchema, toWriteToolDetail),
  toolDetailBranchByName("write", ToolWriteInputSchema, ToolWriteOutputSchema, toWriteToolDetail),
  toolDetailBranchByName(
    "write_file",
    ToolWriteInputSchema,
    ToolWriteOutputSchema,
    toWriteToolDetail,
  ),
  toolDetailBranchByName(
    "create_file",
    ToolWriteInputSchema,
    ToolWriteOutputSchema,
    toWriteToolDetail,
  ),
  toolDetailBranchByName("Edit", ToolEditInputSchema, ToolEditOutputSchema, toEditToolDetail),
  toolDetailBranchByName("MultiEdit", ToolEditInputSchema, ToolEditOutputSchema, toEditToolDetail),
  toolDetailBranchByName("multi_edit", ToolEditInputSchema, ToolEditOutputSchema, toEditToolDetail),
  toolDetailBranchByName("edit", ToolEditInputSchema, ToolEditOutputSchema, toEditToolDetail),
  toolDetailBranchByName(
    "apply_patch",
    ToolEditInputSchema,
    ToolEditOutputSchema,
    toEditToolDetail,
  ),
  toolDetailBranchByName("apply_diff", ToolEditInputSchema, ToolEditOutputSchema, toEditToolDetail),
  toolDetailBranchByName(
    "str_replace_editor",
    ToolEditInputSchema,
    ToolEditOutputSchema,
    toEditToolDetail,
  ),
  toolDetailBranchByName(
    "WebSearch",
    ToolSearchInputSchema,
    ToolWebSearchOutputSchema.nullable(),
    (input, output) => toSearchToolDetail({ input, output, toolName: "web_search" }),
  ),
  toolDetailBranchByName(
    "web_search",
    ToolSearchInputSchema,
    ToolWebSearchOutputSchema.nullable(),
    (input, output) => toSearchToolDetail({ input, output, toolName: "web_search" }),
  ),
  toolDetailBranchByName("search", ToolSearchInputSchema, z.unknown(), (input) =>
    toSearchToolDetail({ input, toolName: "search" }),
  ),
  toolDetailBranchByName("Grep", ToolSearchInputSchema, ClaudeGrepOutputSchema, (input, output) =>
    toSearchToolDetail({ input, output, toolName: "grep" }),
  ),
  toolDetailBranchByName("grep", ToolSearchInputSchema, ClaudeGrepOutputSchema, (input, output) =>
    toSearchToolDetail({ input, output, toolName: "grep" }),
  ),
  toolDetailBranchByName(
    "Glob",
    ToolSearchInputSchema,
    ToolGlobOutputSchema.nullable(),
    (input, output) => toSearchToolDetail({ input, output, toolName: "glob" }),
  ),
  toolDetailBranchByName(
    "glob",
    ToolSearchInputSchema,
    ToolGlobOutputSchema.nullable(),
    (input, output) => toSearchToolDetail({ input, output, toolName: "glob" }),
  ),
  toolDetailBranchByName(
    "WebFetch",
    ToolWebFetchInputSchema,
    ToolWebFetchOutputSchema,
    toFetchToolDetail,
  ),
  toolDetailBranchByName(
    "web_fetch",
    ToolWebFetchInputSchema,
    ToolWebFetchOutputSchema,
    toFetchToolDetail,
  ),
  toolDetailBranchByName(
    "WebFetchTool",
    ToolWebFetchInputSchema,
    ToolWebFetchOutputSchema,
    toFetchToolDetail,
  ),
  toolDetailBranchByName(
    "web_fetch_tool",
    ToolWebFetchInputSchema,
    ToolWebFetchOutputSchema,
    toFetchToolDetail,
  ),
  toolDetailBranchByName(
    "webfetch",
    ToolWebFetchInputSchema,
    ToolWebFetchOutputSchema,
    toFetchToolDetail,
  ),
  toolDetailBranchByName("Task", ClaudeSubAgentInputSchema, z.unknown(), toClaudeSubAgentDetail),
  toolDetailBranchByName("Agent", ClaudeSubAgentInputSchema, z.unknown(), toClaudeSubAgentDetail),
  toolDetailBranchByName(
    "Skill",
    z.object({ skill: z.string() }).passthrough(),
    z
      .union([
        z
          .object({ output: z.string() })
          .passthrough()
          .transform((value) => value.output),
        z.string(),
      ])
      .nullable(),
    (input, output) => {
      const skillName = input?.skill;
      if (!skillName) {
        return undefined;
      }
      return {
        type: "plain_text" as const,
        label: skillName,
        icon: "sparkles" as const,
        ...(output ? { text: output } : {}),
      } satisfies ToolCallDetail;
    },
  ),
  ClaudeSpeakToolDetailSchema,
]);

export function deriveClaudeToolDetail(
  name: string,
  input: unknown,
  output: unknown,
): ToolCallDetail {
  const pass1 = ClaudeToolEnvelopeSchema.safeParse({
    name,
    input: input ?? null,
    output: output ?? null,
  });
  if (!pass1.success) {
    return {
      type: "unknown",
      input: input ?? null,
      output: output ?? null,
    };
  }

  const pass2 = ClaudeToolDetailPass2Schema.safeParse(pass1.data);
  if (pass2.success && pass2.data) {
    return pass2.data;
  }

  return {
    type: "unknown",
    input: pass1.data.input,
    output: pass1.data.output,
  };
}
