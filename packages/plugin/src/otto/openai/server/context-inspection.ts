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
}
/** Provider subprocess owns its request snapshot. No launch, environment, auth or history is exposed. */
export function registerProviderContext(
  server: PluginServerContext,
  providers: readonly ContextInspectableProvider[],
) {
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
