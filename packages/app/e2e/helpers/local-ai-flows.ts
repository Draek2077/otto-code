import type { Page } from "@playwright/test";
import type { SeedDaemonClient } from "./seed-client";

/**
 * Tier-2 (local-AI) flow support shared by the `*.local.spec.ts` specs beyond
 * the flagship loop smoke: durable-timeline access (asserting on daemon-emitted
 * markers instead of model prose), a provider-config patch surface for the
 * max-tool-rounds override, and a permission-prompt answering loop. Follows the
 * rewind-flow helper's pattern of widening the seed client onto methods the
 * real DaemonClient already exposes.
 */

/** A durable timeline item as fetched from the daemon (open field set). */
export interface TimelineItemRecord {
  [key: string]: unknown;
  type: string;
}

interface FetchTimelinePayload {
  epoch: string;
  entries: Array<{ item: TimelineItemRecord }>;
}

export interface LocalAiFlowClient extends SeedDaemonClient {
  fetchAgentTimeline(
    agentId: string,
    options?: {
      direction?: "tail";
      projection?: "projected";
      limit?: number;
    },
  ): Promise<FetchTimelinePayload>;
  /**
   * `set_daemon_config_request` deep-merges provider patches, so patching
   * `maxToolRounds` alone leaves the injected LM Studio endpoint/env intact.
   */
  patchDaemonConfig(config: {
    providers: Record<string, { maxToolRounds?: number }>;
  }): Promise<{ requestId: string; config: unknown }>;
}

/**
 * The seed client is a narrowed view over the real DaemonClient; widen it onto
 * the timeline/config methods these specs need (same pattern as rewind-flow).
 */
export function asLocalAiFlowClient(client: SeedDaemonClient): LocalAiFlowClient {
  return client as LocalAiFlowClient;
}

export async function fetchTimelineItems(
  client: LocalAiFlowClient,
  agentId: string,
  limit = 200,
): Promise<TimelineItemRecord[]> {
  const payload = await client.fetchAgentTimeline(agentId, {
    direction: "tail",
    projection: "projected",
    limit,
  });
  return payload.entries.map((entry) => entry.item);
}

export async function fetchTimelineEpoch(
  client: LocalAiFlowClient,
  agentId: string,
): Promise<string> {
  const payload = await client.fetchAgentTimeline(agentId, {
    direction: "tail",
    projection: "projected",
    limit: 0,
  });
  return payload.epoch;
}

/**
 * Polls the durable timeline until an item matches. Fetch errors are retried
 * silently (the daemon may still be rehydrating right after a restart).
 */
export async function waitForTimelineItem(input: {
  client: LocalAiFlowClient;
  agentId: string;
  predicate: (item: TimelineItemRecord) => boolean;
  label: string;
  timeoutMs?: number;
}): Promise<TimelineItemRecord> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  for (;;) {
    try {
      const items = await fetchTimelineItems(input.client, input.agentId);
      const match = items.find(input.predicate);
      if (match) {
        return match;
      }
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      const suffix = lastError instanceof Error ? ` (last fetch error: ${lastError.message})` : "";
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for timeline item: ${input.label}${suffix}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export function isToolCallItem(
  item: TimelineItemRecord,
  input: { name: string; status: string },
): boolean {
  return (
    item.type === "tool_call" && item["name"] === input.name && item["status"] === input.status
  );
}

/**
 * Answers every permission prompt the agent raises with the same behavior
 * until the turn finishes. A single deny is usually enough, but a local model
 * may retry the gated tool (or reach for another gated one); answering in a
 * loop keeps the spec's contract — "denial means no side effect" — honest
 * without racing the model's retry policy.
 */
export async function respondToPermissionsUntilFinish(input: {
  page: Page;
  client: SeedDaemonClient;
  agentId: string;
  behavior: "allow" | "deny";
  timeoutMs: number;
}): Promise<{ status: string }> {
  const buttonTestId =
    input.behavior === "allow" ? "permission-request-accept" : "permission-request-deny";
  const state = { settled: false };
  // Wait for a genuinely settled state, not just "finished": waitForFinish
  // treats a parked permission prompt ("permission") as a stopping point and
  // resolves before the prompt is answered. Draining until the agent is idle
  // (or failed) is what proves the deny/approve actually ran to completion.
  const finishPromise = input.client
    .waitForAgentUpsert(
      input.agentId,
      (snapshot) => snapshot.status === "idle" || snapshot.status === "failed",
      input.timeoutMs,
    )
    .finally(() => {
      state.settled = true;
    });
  // Looping must not die to an unhandled rejection; the caller still awaits
  // (and surfaces) the real result below.
  finishPromise.catch(() => undefined);
  while (!state.settled) {
    const button = input.page.getByTestId(buttonTestId).first();
    const visible = await button.isVisible().catch(() => false);
    if (visible) {
      await button.click().catch(() => undefined);
    }
    await input.page.waitForTimeout(500);
  }
  return finishPromise;
}
