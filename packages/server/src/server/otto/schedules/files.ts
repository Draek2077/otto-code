/** Reuse Otto's bounded/no-link/CAS filesystem implementation; category policy stays here. */
import {
  WorkflowError,
  workflowDirectory,
  readWorkflowFile,
  publishWorkflowFile,
  retireWorkflowFile,
  workflowDigest,
  workflowExclusive,
} from "../workflows/files.js";
import { ScheduleId } from "@getpaseo/plugin/otto/schedules";

export class ScheduleError extends Error {
  constructor(
    readonly kind: "invalid" | "conflict" | "busy" | "unavailable" | "unsupported",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ScheduleError";
  }
}
async function storage<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof WorkflowError)
      throw new ScheduleError(error.kind, error.message.replaceAll("Workflow", "Schedule"), {
        cause: error,
      });
    throw error;
  }
}
export const scheduleDigest = workflowDigest;
export function assertScheduleId(id: string) {
  if (!ScheduleId.safeParse(id).success || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id))
    throw new ScheduleError("invalid", "Invalid Schedule storage identity.");
}
export const scheduleDirectory = (boundary: string, directory: string, create = false) =>
  storage(() => workflowDirectory(boundary, directory, create));
export const readScheduleFile = (file: string, max?: number) =>
  storage(() => readWorkflowFile(file, max));
export const publishScheduleFile = (file: string, bytes: string, expected: string | null) =>
  storage(() => publishWorkflowFile(file, bytes, expected));
export const retireScheduleFile = (file: string, expected: string) =>
  storage(() => retireWorkflowFile(file, expected));
export const scheduleExclusive = <T>(file: string, operation: () => Promise<T>) =>
  storage(() => workflowExclusive(file, operation));
