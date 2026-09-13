import type { z } from "zod";
import {
  pongValidator,
  sessionOutboundValidators,
} from "../generated/validation/ws-outbound-dispatch.aot.js";
import { WSOutboundMessageSchema, type WSOutboundMessage } from "../messages.js";

type WSOutboundValidationResult =
  | { success: true; data: WSOutboundMessage }
  | { success: false; error: z.ZodError };

interface WSOutboundGeneratedValidator {
  safeParse(input: unknown): { success: true; data: unknown } | { success: false };
}

// zod-aot emits runtime JavaScript but not its TypeScript surface.
const pong = pongValidator as WSOutboundGeneratedValidator;
const sessionValidators = sessionOutboundValidators as ReadonlyMap<
  string,
  WSOutboundGeneratedValidator
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The envelope is `pong` or `{ type: "session", message }`, and every session message type has its
// own generated validator (codegen/ws-outbound.compile.ts explains why). Valid messages only take
// the generated path. Anything the generated validators reject is re-parsed with the Zod source
// schema so the failure carries a normal ZodError for logging; that path only runs for invalid
// messages.
export function validateWSOutboundMessage(input: unknown): WSOutboundValidationResult {
  if (isRecord(input)) {
    if (input.type === "pong") {
      const result = pong.safeParse(input);
      if (result.success) {
        return { success: true, data: result.data as WSOutboundMessage };
      }
    } else if (input.type === "session" && isRecord(input.message)) {
      const messageType = input.message.type;
      const validator =
        typeof messageType === "string" ? sessionValidators.get(messageType) : undefined;
      const result = validator?.safeParse(input.message);
      if (result?.success) {
        // Generated validators pass unknown keys through, so keep the original envelope unless
        // the message validator produced a new object (defaults applied).
        const data = result.data === input.message ? input : { ...input, message: result.data };
        return { success: true, data: data as WSOutboundMessage };
      }
    }
  }
  return WSOutboundMessageSchema.safeParse(input) as WSOutboundValidationResult;
}
