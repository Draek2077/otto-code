import type { z } from "zod";

export interface OttoToolExecutionContext {
  signal?: AbortSignal;
  sendUpdate?: (update: OttoToolResult) => void;
}

export interface OttoToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface OttoToolConfig {
  /** Connector grants are governed by host connector switches, not Otto groups. */
  source?: "connector";
  title?: string;
  description?: string;
  inputSchema?: z.ZodRawShape | z.ZodType;
  outputSchema?: z.ZodRawShape;
}

export interface OttoToolDefinition extends OttoToolConfig {
  name: string;
  description: string;
  handler: (input: unknown, context: OttoToolExecutionContext) => Promise<OttoToolResult>;
}

export interface OttoToolCatalog {
  tools: ReadonlyMap<string, OttoToolDefinition>;
  getTool(name: string): OttoToolDefinition | undefined;
  executeTool(
    name: string,
    input: unknown,
    context?: OttoToolExecutionContext,
  ): Promise<OttoToolResult>;
}

export interface OttoToolRuntimeContext {
  callerAgentId?: string;
  /** Daemon-resolved launch cwd; the agent may not be registered yet. */
  callerCwd?: string;
  enableVoiceTools?: boolean;
  voiceOnly?: boolean;
}

export type OttoToolCatalogFactory = (
  context: OttoToolRuntimeContext,
) => OttoToolCatalog | Promise<OttoToolCatalog>;
