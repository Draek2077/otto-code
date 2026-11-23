import { z } from "zod";
import { defineRpc } from "../../../rpc.js";
import type { PluginServerContext } from "../../../server/contracts.js";
import { contextResult } from "../../context-management.js";

export const PreparedContextSchema = z.object({
  capturedAt: z.string(),
  phase: z.enum(["prepared", "completed"]),
  system: z.string().max(524288),
  instructionText: z.string().max(524288),
  tools: z.string().max(524288),
  blocks: z
    .array(z.object({ file: z.string(), scope: z.string(), text: z.string().max(131072) }))
    .max(32),
});
export type PreparedContext = z.infer<typeof PreparedContextSchema>;
export const inspectProviderContext = defineRpc({
  name: "context.provider.inspect.request",
  input: z.object({ providerId: z.string().min(1), sessionId: z.string().min(1) }).strict(),
  output: contextResult(PreparedContextSchema.nullable()),
});
export interface ContextInspectableProvider {
  id: string;
  inspectContext(sessionId: string): PreparedContext | null;
  generateContextText?(input: { model?: string; prompt: string }): Promise<string>;
}
// OTTO(context-proposals): an explicit tool-free provider operation, never a normal agent session.
export const generateProviderContextText = defineRpc({
  name: "context.provider.generate.request",
  input: z
    .object({
      providerId: z.string().min(1),
      model: z.string().min(1).max(2048).optional(),
      prompt: z.string().min(1).max(163840),
    })
    .strict(),
  output: contextResult(z.object({ text: z.string().max(262144) })),
});
/** Provider subprocess owns its request snapshot. No launch, environment, auth or history is exposed. */
export function registerProviderContext(
  server: PluginServerContext,
  providers: readonly ContextInspectableProvider[],
) {
  server.handle(
    generateProviderContextText,
    async (input): Promise<z.input<typeof generateProviderContextText.output>> => {
      const provider = providers.find((value) => value.id === input.providerId);
      if (!provider?.generateContextText)
        return {
          ok: false,
          error: {
            code: "unavailable",
            message: "This provider does not expose tool-free text generation.",
          },
        };
      try {
        return { ok: true, value: { text: await provider.generateContextText(input) } };
      } catch {
        return {
          ok: false,
          error: {
            code: "unavailable",
            message:
              "The owning provider could not complete this tool-free proposal. No agent tools were available.",
          },
        };
      }
    },
  );
  server.handle(
    inspectProviderContext,
    ({ providerId, sessionId }): z.input<typeof inspectProviderContext.output> => {
      try {
        const provider = providers.find((value) => value.id === providerId);
        if (!provider)
          return {
            ok: false,
            error: { code: "not_found", message: "This provider is no longer registered." },
          };
        return { ok: true, value: provider.inspectContext(sessionId) };
      } catch {
        return {
          ok: false,
          error: {
            code: "unavailable",
            message:
              "This session has no available prepared-request inspection. Start or resume it normally first.",
          },
        };
      }
    },
  );
}
