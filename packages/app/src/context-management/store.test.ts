import { beforeEach, describe, expect, it } from "vitest";
import type { ContextReport } from "@otto-code/protocol/messages";
import { contextQueryKey, MAX_QUERY_REPORTS_PER_SERVER, useContextManagementStore } from "./store";

const SERVER_ID = "server-1";

function makeReport(fixedTotal: number): ContextReport {
  return {
    workspaceId: "workspace-1",
    provider: "claude",
    scannedAt: "2026-08-02T00:00:00.000Z",
    windowTokens: 200_000,
    fixedTotal,
    conditionalTotal: 0,
    referencedTotal: 0,
    workingRoom: 200_000 - fixedTotal,
    aggregateSeverity: "ok",
    confidence: "convention",
    supported: true,
    supportsImports: true,
    nodes: [],
    edges: [],
    findings: [],
    categoryTotals: [],
  };
}

function keyFor(serverId: string, windowTokens: number): string {
  return contextQueryKey({
    serverId,
    workspaceId: "workspace-1",
    provider: "claude",
    windowTokens,
    personalityId: undefined,
  });
}

function storedKeys(): string[] {
  return Object.keys(useContextManagementStore.getState().queryReports);
}

beforeEach(() => {
  useContextManagementStore.setState({ reports: {}, queryReports: {}, dismissals: {} });
});

describe("query report retention", () => {
  it("keeps the most recent answers per server and drops the tail", () => {
    const { setQueryReport } = useContextManagementStore.getState();
    for (let index = 0; index < MAX_QUERY_REPORTS_PER_SERVER + 3; index += 1) {
      setQueryReport({ serverId: SERVER_ID, key: keyFor(SERVER_ID, index), report: makeReport(1) });
    }

    const keys = storedKeys();
    expect(keys).toHaveLength(MAX_QUERY_REPORTS_PER_SERVER);
    expect(keys).not.toContain(keyFor(SERVER_ID, 0));
    expect(keys).toContain(keyFor(SERVER_ID, MAX_QUERY_REPORTS_PER_SERVER + 2));
  });

  it("re-writing an answer refreshes its place in the queue", () => {
    const { setQueryReport } = useContextManagementStore.getState();
    const oldest = keyFor(SERVER_ID, 0);
    for (let index = 0; index < MAX_QUERY_REPORTS_PER_SERVER; index += 1) {
      setQueryReport({ serverId: SERVER_ID, key: keyFor(SERVER_ID, index), report: makeReport(1) });
    }

    // Revalidating the oldest key makes it the newest, so the next insert
    // evicts what is actually stale instead.
    setQueryReport({ serverId: SERVER_ID, key: oldest, report: makeReport(2) });
    setQueryReport({
      serverId: SERVER_ID,
      key: keyFor(SERVER_ID, MAX_QUERY_REPORTS_PER_SERVER),
      report: makeReport(1),
    });

    const keys = storedKeys();
    expect(keys).toContain(oldest);
    expect(keys).not.toContain(keyFor(SERVER_ID, 1));
    expect(useContextManagementStore.getState().queryReports[oldest]?.fixedTotal).toBe(2);
  });

  it("caps each server independently", () => {
    const { setQueryReport } = useContextManagementStore.getState();
    setQueryReport({ serverId: "server-2", key: keyFor("server-2", 0), report: makeReport(1) });
    for (let index = 0; index < MAX_QUERY_REPORTS_PER_SERVER + 3; index += 1) {
      setQueryReport({ serverId: SERVER_ID, key: keyFor(SERVER_ID, index), report: makeReport(1) });
    }

    expect(storedKeys()).toContain(keyFor("server-2", 0));
  });

  // A stored null is a real answer ("this workspace has no report") and has to
  // survive the cap the same way a report does.
  it("stores a null answer under the cap like any other", () => {
    const { setQueryReport } = useContextManagementStore.getState();
    const key = keyFor(SERVER_ID, 0);
    setQueryReport({ serverId: SERVER_ID, key, report: null });

    expect(useContextManagementStore.getState().queryReports).toHaveProperty(key, null);
  });
});
