import type { ToolCall } from "./verify.js";

export type ToolHandler = (input: Record<string, unknown>) => Promise<string>;

export function ownToolHandler(
  handlers: Record<string, ToolHandler>,
  name: string | undefined,
): ToolHandler | undefined {
  return name && Object.hasOwn(handlers, name) ? handlers[name] : undefined;
}
export function toolArguments(call: ToolCall): Record<string, unknown> {
  let args: unknown = call.function?.arguments ?? call.input ?? {};
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return {};
    }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return Object.fromEntries(Object.entries(args));
}
