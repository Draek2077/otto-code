import type { ScheduleHistoryState } from "@getpaseo/plugin/otto/schedules";
import { z } from "zod";
import { ScheduleHistoryObjects } from "./history-objects.js";
import { ScheduleHistoryIndex } from "./history-index.js";
import { ScheduleHistoryContent } from "./history-content.js";
import { ScheduleError } from "./files.js";

const lookup = z.object({
  runId: z.string(),
  index: z.number().int().nonnegative(),
  content: z.string(),
});
/** A move copies and verifies only objects reachable from the captured immutable
 * root. It never discovers arbitrary directories or retires archived source data. */
export class ScheduleHistoryTransfer {
  private readonly index: ScheduleHistoryIndex;
  private readonly content: ScheduleHistoryContent;
  constructor(
    readonly source: ScheduleHistoryObjects,
    readonly destination: ScheduleHistoryObjects | null,
    readonly assertOpen: () => void,
  ) {
    this.index = new ScheduleHistoryIndex(source);
    this.content = new ScheduleHistoryContent(source);
  }
  async verify(state: ScheduleHistoryState | undefined) {
    if (state) await this.node(state.root, state.count, state.height, 0);
  }
  private async copyObject(digest: string) {
    const bytes = await this.source.read(digest);
    this.assertOpen();
    if (this.destination && (await this.destination.put(bytes)) !== digest)
      throw new ScheduleError(
        "conflict",
        "Archived Schedule transfer object did not retain its identity.",
      );
  }
  private async payload(runId: string, revision: string) {
    const manifest = await this.content.manifest(runId, revision);
    for (let part = 0; part < manifest.parts.length; part++) {
      await this.content.part(runId, revision, part);
      await this.copyObject(manifest.parts[part]);
    }
    await this.copyObject(revision);
  }
  private async node(
    digest: string,
    count: number,
    height: number,
    position: number,
  ): Promise<void> {
    this.assertOpen();
    const node = await this.index.node(digest, count, height);
    if (node.kind === "branch") {
      let offset = position;
      for (const child of node.children) {
        await this.node(child.digest, child.count, height - 1, offset);
        offset += child.count;
      }
    } else {
      for (let index = 0; index < node.entries.length; index++) {
        const entry = node.entries[index];
        await this.payload(entry.runId, entry.content);
        if (entry.original !== entry.content) await this.payload(entry.runId, entry.original);
        const bytes = await this.source.readLookup(entry.runId);
        const pointer = bytes === null ? null : lookup.parse(JSON.parse(bytes));
        if (
          !pointer ||
          pointer.runId !== entry.runId ||
          pointer.index !== position + index ||
          pointer.content !== entry.content
        )
          throw new ScheduleError(
            "conflict",
            "Archived Schedule transfer lookup does not match its retained root.",
          );
        this.assertOpen();
        if (this.destination) await this.destination.putLookup(entry.runId, bytes!);
      }
    }
    await this.copyObject(digest);
  }
}
