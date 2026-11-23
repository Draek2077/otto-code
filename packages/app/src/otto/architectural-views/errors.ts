import type { z } from "zod";
import type { ViewError } from "@getpaseo/plugin/otto/architectural-views";
export class ViewRequestError extends Error {
  constructor(
    readonly code: z.infer<typeof ViewError>["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
