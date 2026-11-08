import { z } from "zod";
import {
  ScheduleDigest,
  ScheduleRunSummary,
  type ScheduleHistoryState,
} from "@getpaseo/plugin/otto/schedules";
import { ScheduleHistoryObjects } from "./history-objects.js";
import { ScheduleError } from "./files.js";

const WIDTH = 32;
export const historyIndexEntry = z.object({
  runId: z.string(),
  content: ScheduleDigest,
  original: ScheduleDigest,
  summary: ScheduleRunSummary,
});
export type HistoryIndexEntry = z.infer<typeof historyIndexEntry>;
export const historyNode = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("leaf"), entries: z.array(historyIndexEntry).min(1).max(WIDTH) }),
  z.object({
    kind: z.literal("branch"),
    children: z
      .array(
        z.object({
          digest: ScheduleDigest,
          count: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        }),
      )
      .min(1)
      .max(WIDTH),
  }),
]);
export type HistoryNode = z.infer<typeof historyNode>;
type NodeCache = Map<string, HistoryNode>;
/** Persistent bounded-fanout index: append copies only the rightmost path.
 * Paging follows at most nine levels, regardless of retained run count. */
export class ScheduleHistoryIndex {
  constructor(readonly objects: ScheduleHistoryObjects) {}
  async node(
    digest: string,
    count: number,
    height: number,
    cache: NodeCache = new Map(),
  ): Promise<HistoryNode> {
    const node =
      cache.get(digest) ?? historyNode.parse(JSON.parse(await this.objects.read(digest)));
    const actual =
      node.kind === "leaf"
        ? node.entries.length
        : node.children.reduce((sum, child) => sum + child.count, 0);
    if (height < 0 || height > 8 || actual !== count || (height === 0) !== (node.kind === "leaf"))
      throw new ScheduleError(
        "conflict",
        "Schedule history index does not match its retained root.",
      );
    if (
      node.kind === "branch" &&
      node.children.some(
        (child, index) =>
          child.count > WIDTH ** height ||
          (index < node.children.length - 1 && child.count !== WIDTH ** height),
      )
    )
      throw new ScheduleError(
        "conflict",
        "Schedule history index contains an invalid branch span.",
      );
    cache.set(digest, node);
    return node;
  }
  private put(node: HistoryNode) {
    return this.objects.put(JSON.stringify(node) + "\n");
  }
  private async fresh(height: number, entry: HistoryIndexEntry): Promise<string> {
    if (height === 0) return this.put({ kind: "leaf", entries: [entry] });
    return this.put({
      kind: "branch",
      children: [{ digest: await this.fresh(height - 1, entry), count: 1 }],
    });
  }
  async append(
    state: ScheduleHistoryState | null,
    entry: HistoryIndexEntry,
  ): Promise<ScheduleHistoryState> {
    if (!state)
      return { root: await this.fresh(0, entry), count: 1, height: 0, lastRunId: entry.runId };
    await this.node(state.root, state.count, state.height);
    if (state.count === WIDTH ** (state.height + 1)) {
      if (state.height === 8)
        throw new ScheduleError(
          "unavailable",
          "Schedule history exceeds its representable index depth. Retained data was not removed.",
        );
      return {
        count: state.count + 1,
        lastRunId: entry.runId,
        height: state.height + 1,
        root: await this.put({
          kind: "branch",
          children: [
            { digest: state.root, count: state.count },
            { digest: await this.fresh(state.height, entry), count: 1 },
          ],
        }),
      };
    }
    return {
      ...state,
      lastRunId: entry.runId,
      count: state.count + 1,
      root: await this.appendNode(state.root, state.count, state.height, entry),
    };
  }
  private async appendNode(
    digest: string,
    count: number,
    height: number,
    entry: HistoryIndexEntry,
  ): Promise<string> {
    const node = await this.node(digest, count, height);
    if (node.kind === "leaf") return this.put({ ...node, entries: [...node.entries, entry] });
    const children = [...node.children],
      last = children.at(-1)!;
    if (last.count < WIDTH ** height)
      children[children.length - 1] = {
        count: last.count + 1,
        digest: await this.appendNode(last.digest, last.count, height - 1, entry),
      };
    else children.push({ count: 1, digest: await this.fresh(height - 1, entry) });
    return this.put({ kind: "branch", children });
  }
  async at(
    state: ScheduleHistoryState,
    index: number,
    cache: NodeCache = new Map(),
  ): Promise<HistoryIndexEntry> {
    if (!Number.isSafeInteger(index) || index < 0 || index >= state.count)
      throw new ScheduleError("invalid", "Schedule history position is outside its retained root.");
    let digest = state.root,
      count = state.count,
      position = index;
    for (let height = state.height; height >= 0; height--) {
      const node = await this.node(digest, count, height, cache);
      if (node.kind === "leaf") return node.entries[position];
      const child = node.children.find((candidate) => {
        if (position < candidate.count) return true;
        position -= candidate.count;
        return false;
      });
      if (!child) break;
      digest = child.digest;
      count = child.count;
    }
    throw new ScheduleError("conflict", "Schedule history index cannot resolve this run.");
  }
}
