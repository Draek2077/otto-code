import path from "node:path";
import { ScheduleDigest } from "@getpaseo/plugin/otto/schedules";
import type { ScheduleOrigin } from "./stores.js";
import {
  assertScheduleId,
  scheduleDirectory,
  readScheduleFile,
  publishScheduleFile,
  scheduleDigest,
  ScheduleError,
} from "./files.js";

/** Content-addressed immutable objects inside the record's own store. Failed
 * root publication can leave unreachable objects, never overwritten history. */
export class ScheduleHistoryObjects {
  readonly directory: string;
  constructor(
    readonly origin: ScheduleOrigin,
    readonly scheduleId: string,
  ) {
    assertScheduleId(scheduleId);
    this.directory = path.join(origin.directory, ".otto-history", scheduleId);
  }
  private async file(digest: string, create: boolean) {
    if (!ScheduleDigest.safeParse(digest).success)
      throw new ScheduleError("invalid", "Invalid Schedule history object identity.");
    const directory = path.join(this.directory, "objects");
    if (!(await scheduleDirectory(this.origin.boundary, directory, create)))
      throw new ScheduleError(
        "unavailable",
        "Retained Schedule history is unavailable at its owning origin.",
      );
    return path.join(directory, `${digest}.data`);
  }
  async read(digest: string): Promise<string> {
    const bytes = await readScheduleFile(await this.file(digest, false));
    if (bytes === null || scheduleDigest(bytes) !== digest)
      throw new ScheduleError(
        "conflict",
        "Retained Schedule history changed or is missing. Original records were not rewritten.",
      );
    return bytes;
  }
  async put(bytes: string): Promise<string> {
    const digest = scheduleDigest(bytes);
    const file = await this.file(digest, true);
    const existing = await readScheduleFile(file);
    if (existing !== null) {
      if (existing !== bytes)
        throw new ScheduleError("conflict", "Immutable Schedule history object changed.");
      return digest;
    }
    await publishScheduleFile(file, bytes, null);
    return digest;
  }
  async readLookup(runId: string) {
    const directory = path.join(this.directory, "lookup");
    if (!(await scheduleDirectory(this.origin.boundary, directory))) return null;
    return readScheduleFile(path.join(directory, `${scheduleDigest(runId)}.json`), 32000);
  }
  async putLookup(runId: string, bytes: string) {
    const directory = path.join(this.directory, "lookup");
    await scheduleDirectory(this.origin.boundary, directory, true);
    const file = path.join(directory, `${scheduleDigest(runId)}.json`);
    const existing = await readScheduleFile(file, 32000);
    if (existing !== null) {
      if (existing !== bytes)
        throw new ScheduleError(
          "conflict",
          "This archived run identity has different retained content. Inspect it before another write.",
        );
      return;
    }
    await publishScheduleFile(file, bytes, null);
  }
}
