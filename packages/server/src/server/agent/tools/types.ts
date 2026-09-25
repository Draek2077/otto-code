import type { z } from "zod";
import type { ProviderOttoToolsPolicy } from "@otto-code/protocol/provider-config";

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

/** All built-in groups register through the catalog's single policy gate. */
export type RegisterOttoTool = (
  name: string,
  config: OttoToolConfig,
  // Tool inputs are validated against their schema at the catalog execution boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (input: any, context: OttoToolExecutionContext) => Promise<OttoToolResult>,
) => void;

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
  ottoToolPolicy?: ProviderOttoToolsPolicy;
  enableVoiceTools?: boolean;
  voiceOnly?: boolean;
}

export type OttoToolCatalogFactory = (
  context: OttoToolRuntimeContext,
) => OttoToolCatalog | Promise<OttoToolCatalog>;
