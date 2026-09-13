import { afterEach, describe, expect, it } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import {
  createTimelineReplica,
  createViewedTimelineOwner,
  type TimelineResponsePayload,
  type ViewedTimelineOwner,
} from "./viewed-timeline-sync";
const SERVER = "prompt-index-host";
const AGENT = "prompt-index-agent";
const owners: ViewedTimelineOwner[] = [];
function owner() {
  useSessionStore.getState().initializeSession(SERVER, null);
  const replica = createTimelineReplica({
    serverId: SERVER,
    prepareAgent: async () => undefined,
    storage: { readTimeline: async () => undefined, commitTimeline: () => undefined },
  });
  const result = createViewedTimelineOwner({
    serverId: SERVER,
    replica,
    replaceDemandedAgentIds: () => undefined,
    drainQueuedAgentMessage: () => undefined,
    ports: {
      initialDeliveryMode: "legacy",
      setSubscription: async () => undefined,
      readCursor: () => undefined,
      fetchPage: async () => ({ hasNewer: false, endCursor: null }),
      fetchLatestTail: async () => ({ hasNewer: false, endCursor: null }),
      reportError: () => undefined,
      schedule: () => () => undefined,
    },
  });
  owners.push(result);
  return result;
}
const prompt = (seq: number) => ({
  seq,
  timestamp: "2026-09-13T00:00:00Z",
  preview: `Prompt ${seq}`,
});
function page(epoch: string, seq: number): TimelineResponsePayload {
  return {
    requestId: `page-${epoch}-${seq}`,
    agentId: AGENT,
    agent: null,
    direction: "tail",
    projection: "projected",
    epoch,
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 1, maxSeq: seq, nextSeq: seq + 1 },
    startCursor: { epoch, seq },
    endCursor: { epoch, seq },
    hasOlder: false,
    hasNewer: false,
    entries: [
      {
        provider: "mock",
        item: { type: "user_message", text: `Prompt ${seq}` },
        timestamp: "2026-09-13T00:00:00Z",
        seqStart: seq,
        seqEnd: seq,
        sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
        collapsed: [],
      },
    ],
    error: null,
    promptIndex: { epoch, prompts: [prompt(seq)] },
  };
}
const index = () =>
  useSessionStore.getState().sessions[SERVER]?.agentTimelinePromptIndexes.get(AGENT);
afterEach(() => {
  owners.splice(0).forEach((value) => value.dispose());
  useSessionStore.getState().clearSession(SERVER);
});
describe("viewed timeline prompt-index projection", () => {
  it("projects the initial canonical index and accepts a shorter new-epoch rewind", () => {
    const viewed = owner();
    viewed.applyTimelineResponse(page("epoch-A", 5));
    expect(index()).toEqual({ epoch: "epoch-A", prompts: [prompt(5)] });
    viewed.applyTimelineResponse({ ...page("epoch-B", 1), reset: true });
    expect(index()).toEqual({ epoch: "epoch-B", prompts: [prompt(1)] });
    viewed.applyTimelineResponse({
      ...page("epoch-C", 0),
      reset: true,
      startCursor: null,
      endCursor: null,
      entries: [],
      promptIndex: { epoch: "epoch-C", prompts: [] },
    });
    expect(index()).toEqual({ epoch: "epoch-C", prompts: [] });
  });
  it("does not let a discarded duplicate or delayed older same-epoch page replace a newer outline", () => {
    const viewed = owner();
    viewed.applyTimelineResponse(page("epoch-A", 5));
    const newer = index();
    viewed.applyTimelineResponse({
      ...page("epoch-A", 5),
      promptIndex: { epoch: "epoch-A", prompts: [] },
    });
    expect(index()).toBe(newer);
    viewed.applyTimelineResponse(page("epoch-A", 2));
    expect(index()).toBe(newer);
  });
  it("rejects mismatched-epoch and failed metadata without affecting the existing outline", () => {
    const viewed = owner();
    viewed.applyTimelineResponse(page("epoch-A", 2));
    const current = index();
    viewed.applyTimelineResponse({
      ...page("epoch-A", 3),
      promptIndex: { epoch: "unrelated", prompts: [prompt(3)] },
    });
    expect(index()).toBe(current);
    viewed.applyTimelineResponse({ ...page("epoch-A", 4), error: "unavailable" });
    expect(index()).toBe(current);
  });
});
