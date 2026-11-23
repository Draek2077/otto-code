import { z } from "zod";
import path from "node:path";
import { readFileSync, statSync } from "node:fs";
import {
  ProviderEventSchema,
  type ProviderPersistence,
  type ProviderTimelineItem,
} from "@getpaseo/plugin/server/provider";
import type { AgentStreamEvent, AgentTimelineItem } from "../agent/agent-sdk-types.js";

const savedTimeline = z.object({
  format: z.literal("otto-openai-compatible-v1"),
  timeline: z.array(z.json()),
  timelineTimestamps: z.record(z.string(), z.string()).optional(),
});

// COMPAT(paseoPluginHistory): added in v0.10.0; review for removal after
// 2027-04-22 when upstream can replay authoritative plugin history after revert.
// Paseo 0.12 otherwise replays its old event cache, resurrecting rewound rows and
// both loading/completed versions of compaction rows. This format belongs to Otto.
interface ProviderHistoryInput {
  provider: string;
  persistence: ProviderPersistence | null;
  home?: string;
  mapItem: (
    item: ProviderTimelineItem,
    snapshots: Map<string, ProviderTimelineItem>,
  ) => AgentTimelineItem | null;
}

export function ottoProviderHistory({
  provider,
  persistence,
  mapItem,
  home,
}: ProviderHistoryInput): AgentStreamEvent[] | null {
  let data = persistence?.data;
  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    data.format === "otto-openai-host-session-v1"
  ) {
    if (!home)
      throw new Error(
        "The Otto conversation archive has no bound host. Saved history was left intact.",
      );
    const pointer = z.object({ id: z.uuid() }).parse(data);
    const file = path.join(home, "otto-openai-compatible", "sessions", `${pointer.id}.json`);
    if (statSync(file).size > 128 * 1024 * 1024)
      throw new Error("The Otto conversation archive exceeds 128 MiB.");
    data = z.json().parse(JSON.parse(readFileSync(file, "utf8")));
  }
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    data.format !== "otto-openai-compatible-v1"
  )
    return null;
  const saved = savedTimeline.parse(data);
  const snapshots = new Map<string, ProviderTimelineItem>();
  return saved.timeline.flatMap((raw): AgentStreamEvent[] => {
    const event = ProviderEventSchema.parse({
      type: "timeline.item",
      sessionId: "otto-replay",
      item: raw,
    });
    if (event.type !== "timeline.item") throw new Error("Invalid Otto provider timeline snapshot.");
    const item = mapItem(event.item, snapshots);
    return item
      ? [{ type: "timeline", provider, item, timestamp: saved.timelineTimestamps?.[event.item.id] }]
      : [];
  });
}
