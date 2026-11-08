import { z } from "zod";
import { ScheduleDigest } from "@getpaseo/plugin/otto/schedules";
import { ScheduleHistoryObjects } from "./history-objects.js";
import { ScheduleError, scheduleDigest } from "./files.js";

const PART_BYTES = 256 * 1024;
export const historyContent = z.object({
  runId: z.string(),
  bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  digest: ScheduleDigest,
  parts: z.array(ScheduleDigest).min(1).max(4096),
});
export class ScheduleHistoryContent {
  constructor(readonly objects: ScheduleHistoryObjects) {}
  async capture(runId: string, value: unknown) {
    const bytes = Buffer.from(JSON.stringify(value) + "\n", "utf8");
    if (bytes.length > PART_BYTES * 4096)
      throw new ScheduleError(
        "unavailable",
        "This Schedule result exceeds its representable content manifest. Inspect its linked target; retained data was not removed.",
      );
    const parts: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += PART_BYTES)
      parts.push(
        await this.objects.put(bytes.subarray(offset, offset + PART_BYTES).toString("base64")),
      );
    const manifest = historyContent.parse({
      runId,
      bytes: bytes.length,
      digest: scheduleDigest(bytes),
      parts,
    });
    return this.objects.put(JSON.stringify(manifest) + "\n");
  }
  async manifest(runId: string, revision: string) {
    const manifest = historyContent.parse(JSON.parse(await this.objects.read(revision)));
    if (
      manifest.runId !== runId ||
      manifest.parts.length !== Math.ceil(manifest.bytes / PART_BYTES)
    )
      throw new ScheduleError("conflict", "Archived Schedule content does not match this run.");
    return manifest;
  }
  async part(runId: string, revision: string, part: number) {
    const manifest = await this.manifest(runId, revision);
    if (!Number.isInteger(part) || part < 0 || part >= manifest.parts.length)
      throw new ScheduleError("invalid", "Choose a retained Schedule result part.");
    const data = await this.objects.read(manifest.parts[part]);
    const bytes = Buffer.from(data, "base64");
    const expected = Math.min(PART_BYTES, manifest.bytes - part * PART_BYTES);
    if (bytes.length !== expected || bytes.toString("base64") !== data)
      throw new ScheduleError("conflict", "Archived Schedule result part changed.");
    return { data, revision, part, parts: manifest.parts.length };
  }
  async small(runId: string, revision: string): Promise<unknown | null> {
    const manifest = await this.manifest(runId, revision);
    if (manifest.bytes > PART_BYTES) return null;
    const { data } = await this.part(runId, revision, 0);
    const bytes = Buffer.from(data, "base64");
    if (scheduleDigest(bytes) !== manifest.digest)
      throw new ScheduleError("conflict", "Archived Schedule result digest changed.");
    return JSON.parse(bytes.toString("utf8"));
  }
}
