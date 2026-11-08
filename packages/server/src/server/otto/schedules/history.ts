import { z } from "zod";
import {
  SchedulePublicRun,
  type ScheduleEntry,
  type ScheduleHistoryState,
} from "@getpaseo/plugin/otto/schedules";
import { parseOttoStoredSchedule } from "../schedule-continuity.js";
import type { ScheduleOrigin } from "./stores.js";
import { ScheduleHistoryObjects } from "./history-objects.js";
import { ScheduleHistoryIndex, type HistoryIndexEntry, type HistoryNode } from "./history-index.js";
import { ScheduleHistoryContent } from "./history-content.js";
import { scheduleRunSummary } from "./projection.js";
import { ScheduleError } from "./files.js";

const rawRecord = z.record(z.string(), z.unknown());
const rawDocument = z.object({ runs: z.array(rawRecord) }).passthrough();
const lookup = z.object({
  runId: z.string(),
  index: z.number().int().nonnegative(),
  content: z.string(),
});
const INLINE_RUNS = 50;
const PRIMARY_BYTES = 768000;
export class ScheduleHistory {
  readonly objects: ScheduleHistoryObjects;
  readonly index: ScheduleHistoryIndex;
  readonly content: ScheduleHistoryContent;
  constructor(origin: ScheduleOrigin, scheduleId: string) {
    this.objects = new ScheduleHistoryObjects(origin, scheduleId);
    this.index = new ScheduleHistoryIndex(this.objects);
    this.content = new ScheduleHistoryContent(this.objects);
  }
  async validate(state: ScheduleHistoryState | undefined) {
    if (state) await this.index.node(state.root, state.count, state.height);
  }
  /** Archive finished prefixes before CAS publication. A failure retains the
   * original primary and any unreachable immutable objects for inspection. */
  async compact(value: unknown): Promise<unknown> {
    const raw = rawDocument.parse(value);
    let schedule = parseOttoStoredSchedule(raw);
    let state = schedule.otto?.history ?? null;
    await this.validate(state ?? undefined);
    while (
      raw.runs.length > INLINE_RUNS ||
      Buffer.byteLength(JSON.stringify(raw, null, 2)) > PRIMARY_BYTES
    ) {
      const run = schedule.runs[0];
      if (!run || run.status === "running") break;
      const metadata =
        raw.otto === undefined
          ? {
              version: 1,
              scope: this.objects.origin.scope,
              location: this.objects.origin.location,
              storeKey: this.objects.origin.storeKey,
            }
          : rawRecord.parse(raw.otto);
      const original = await this.content.capture(run.id, raw.runs[0]);
      const content = await this.content.capture(run.id, SchedulePublicRun.parse(raw.runs[0]));
      const entry = { runId: run.id, original, content, summary: scheduleRunSummary(run) };
      const position = state?.count ?? 0;
      const next = await this.index.append(state, entry);
      await this.objects.putLookup(
        run.id,
        JSON.stringify({ runId: run.id, index: position, content }) + "\n",
      );
      state = next;
      raw.runs = raw.runs.slice(1);
      raw.otto = { ...metadata, history: state };
      schedule = parseOttoStoredSchedule(raw);
    }
    return raw;
  }
  async page(entry: ScheduleEntry, offset: number) {
    const recent = entry.schedule.runs.toReversed();
    const state = entry.schedule.otto?.history;
    const total = (state?.count ?? 0) + recent.length;
    const runs = recent.slice(offset, offset + 50).map(scheduleRunSummary);
    const cache = new Map<string, HistoryNode>();
    if (state) {
      for (let position = offset + runs.length; position < Math.min(offset + 50, total); position++)
        runs.push(
          (await this.index.at(state, state.count - 1 - (position - recent.length), cache)).summary,
        );
    }
    return { runs, total, revision: entry.revision };
  }
  async last(entry: ScheduleEntry) {
    const state = entry.schedule.otto?.history;
    return state ? (await this.index.at(state, state.count - 1)).summary : undefined;
  }
  private async archived(entry: ScheduleEntry, runId: string): Promise<HistoryIndexEntry> {
    const state = entry.schedule.otto?.history;
    const bytes = state ? await this.objects.readLookup(runId) : null;
    if (!bytes || !state)
      throw new ScheduleError("invalid", "This Schedule run is unavailable in retained history.");
    const pointer = lookup.parse(JSON.parse(bytes));
    const item = await this.index.at(state, pointer.index);
    if (pointer.runId !== runId || item.runId !== runId || pointer.content !== item.content)
      throw new ScheduleError(
        "conflict",
        "Archived Schedule identity does not match its retained history root.",
      );
    return item;
  }
  async run(entry: ScheduleEntry, runId: string) {
    const current = entry.schedule.runs.find((run) => run.id === runId);
    if (current)
      return {
        kind: "inline" as const,
        run: SchedulePublicRun.parse(current),
        revision: entry.revision,
      };
    const archived = await this.archived(entry, runId);
    const small = await this.content.small(runId, archived.content);
    if (small !== null)
      return {
        kind: "inline" as const,
        run: SchedulePublicRun.parse(small),
        revision: entry.revision,
      };
    const manifest = await this.content.manifest(runId, archived.content);
    return {
      kind: "stored" as const,
      summary: archived.summary,
      content: { revision: archived.content, bytes: manifest.bytes, parts: manifest.parts.length },
      revision: entry.revision,
    };
  }
  async part(entry: ScheduleEntry, runId: string, revision: string, part: number) {
    const archived = await this.archived(entry, runId);
    if (archived.content !== revision)
      throw new ScheduleError(
        "conflict",
        "Inspect this run's current retained content identity before reading a part.",
      );
    return this.content.part(runId, revision, part);
  }
}
