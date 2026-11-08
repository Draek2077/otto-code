import {
  OttoStoredSchedule as StoredScheduleSchema,
  type OttoStoredSchedule as StoredSchedule,
} from "@getpaseo/plugin/otto/schedules";
import { writeOttoAgentRecord as preserveRecordWrite } from "./store-continuity.js";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// COMPAT(otto09ScheduleFields): added in v0.10.0; review after 2027-04-21.
// Do not execute a stored target after silently stripping the profile or provider
// policy that defined its behavior. Unsupported features retain their original
// file until their owner returns; supported schedule metadata survives rewrites.
export function parseOttoStoredSchedule(value: unknown): StoredSchedule {
  if (record(value) && record(value.target)) {
    const target = value.target;
    if (target.type === "workflow" && !record(target.source)) {
      throw new Error(
        "Review this legacy Workflow schedule and explicitly select its saved target before enabling it.",
      );
    }
    if (target.type === "new-agent" && record(target.config)) {
      const config = target.config;
      const dormant = [
        "agentProfile",
        "personality",
        "approvalPolicy",
        "sandboxMode",
        "networkAccess",
        "webSearch",
        "extra",
      ].find((field) => Object.hasOwn(config, field));
      if (dormant) {
        throw new Error(
          `This saved Otto schedule uses ${dormant}, a feature awaiting restoration.`,
        );
      }
    }
  }
  return StoredScheduleSchema.parse(value);
}

export function writeOttoStoredSchedule(file: string, schedule: StoredSchedule): Promise<void> {
  return preserveRecordWrite(file, schedule, undefined, (value) =>
    StoredScheduleSchema.parse(value),
  );
}
