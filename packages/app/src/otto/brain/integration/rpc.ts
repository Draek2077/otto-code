import { z } from "zod";
import { BrainOperationResultSchema } from "@getpaseo/protocol/otto/brain";
import { BrainSettingsOperationError } from "../settings/contracts";

export type BrainInvoke = (method: string, input: unknown) => Promise<unknown>;
/** Existing paired-daemon transport only. Untrusted response data never enters app state. */
export class BrainRpc {
  constructor(private readonly invoke: BrainInvoke) {}
  async request<T>(method: string, input: unknown, schema: z.ZodType<T>): Promise<T> {
    let response: unknown;
    try {
      response = await this.invoke(method, input);
    } catch (error) {
      throw new BrainSettingsOperationError(
        "unavailable",
        "The Otto host could not complete the Brain request. Reload to check its current state.",
        { cause: error },
      );
    }
    const envelope = BrainOperationResultSchema.safeParse(response);
    if (!envelope.success)
      throw new BrainSettingsOperationError(
        "unknown",
        "The Otto host returned an unsupported Brain response. Update the host and reload.",
      );
    if (!envelope.data.ok)
      throw new BrainSettingsOperationError(envelope.data.error.kind, envelope.data.error.message);
    const result = schema.safeParse(envelope.data.value);
    if (!result.success)
      throw new BrainSettingsOperationError(
        "unknown",
        "The Brain response could not be verified. Reload before changing settings.",
      );
    return result.data;
  }
}
