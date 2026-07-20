/**
 * @vitest-environment jsdom
 */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextReport } from "@otto-code/protocol/messages";
import { useSessionStore } from "@/stores/session-store";
import { useContextManagementStore } from "./store";
import { useContextReportQuery } from "./use-context-report";

// Only the sibling gate hook in this module needs it, and its own import chain
// does not survive the test transform. The query hook under test never calls it.
vi.mock("@/features/use-feature-enabled", () => ({ useFeatureEnabled: () => true }));

const SERVER_ID = "server-1";
const WINDOW_TOKENS = 200_000;

// In-flight scans are deduped in a module-level map that outlives a test, so
// every case gets its own workspace rather than inheriting the previous one's
// deliberately-never-settling promise.
let workspaceSeq = 0;
let WORKSPACE_ID = "workspace-0";

function makeReport(fixedTotal: number): ContextReport {
  return {
    workspaceId: WORKSPACE_ID,
    provider: "claude",
    scannedAt: "2026-07-20T00:00:00.000Z",
    windowTokens: WINDOW_TOKENS,
    fixedTotal,
    conditionalTotal: 0,
    referencedTotal: 0,
    workingRoom: WINDOW_TOKENS - fixedTotal,
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

const requestContextReport = vi.fn();

function installClient(): void {
  useSessionStore.setState({
    sessions: {
      [SERVER_ID]: { client: { requestContextReport } },
    },
  } as never);
}

function renderQuery() {
  return renderHook(() =>
    useContextReportQuery(SERVER_ID, WORKSPACE_ID, { windowTokens: WINDOW_TOKENS }),
  );
}

beforeEach(() => {
  workspaceSeq += 1;
  WORKSPACE_ID = `workspace-${workspaceSeq}`;
  requestContextReport.mockReset();
  useContextManagementStore.setState({ reports: {}, queryReports: {}, dismissals: {} });
  installClient();
});

afterEach(() => {
  // This config does not enable vitest globals, so Testing Library never
  // registers its own cleanup — without this, hooks from earlier cases stay
  // mounted and re-fire when the next case swaps the session client.
  cleanup();
  useSessionStore.setState({ sessions: {} } as never);
});

describe("useContextReportQuery", () => {
  it("reports loading, not empty, while the first scan runs", async () => {
    let resolve!: (value: { report: ContextReport }) => void;
    requestContextReport.mockReturnValue(
      new Promise<{ report: ContextReport }>((r) => {
        resolve = r;
      }),
    );

    const { result } = renderQuery();

    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.report).toBeNull();
    expect(result.current.isRefreshing).toBe(false);

    resolve({ report: makeReport(1000) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.report?.fixedTotal).toBe(1000);
  });

  it("paints a cached report immediately on re-open and revalidates behind it", async () => {
    requestContextReport.mockResolvedValue({ report: makeReport(1000) });
    const first = renderQuery();
    await waitFor(() => expect(first.result.current.report?.fixedTotal).toBe(1000));
    first.unmount();

    // A second scan is deliberately slow: the point is that nothing blanks.
    let resolve!: (value: { report: ContextReport }) => void;
    requestContextReport.mockReturnValue(
      new Promise<{ report: ContextReport }>((r) => {
        resolve = r;
      }),
    );

    const second = renderQuery();
    expect(second.result.current.report?.fixedTotal).toBe(1000);
    expect(second.result.current.isLoading).toBe(false);
    await waitFor(() => expect(second.result.current.isRefreshing).toBe(true));

    resolve({ report: makeReport(2000) });
    await waitFor(() => expect(second.result.current.report?.fixedTotal).toBe(2000));
    expect(second.result.current.isRefreshing).toBe(false);
  });

  it("seeds from the pushed baseline when it was evaluated against the same window", async () => {
    useContextManagementStore.getState().setReport(SERVER_ID, WORKSPACE_ID, makeReport(1500));
    requestContextReport.mockReturnValue(new Promise(() => {}));

    const { result } = renderQuery();

    expect(result.current.report?.fixedTotal).toBe(1500);
    expect(result.current.isLoading).toBe(false);
  });

  it("coalesces concurrent identical scans into one request", async () => {
    // Two panes on the same workspace used to cost two filesystem walks. The
    // scan stays pending across both mounts, which is the case that matters.
    let resolve!: (value: { report: ContextReport }) => void;
    requestContextReport.mockReturnValue(
      new Promise<{ report: ContextReport }>((r) => {
        resolve = r;
      }),
    );

    const a = renderQuery();
    const b = renderQuery();
    await waitFor(() => expect(a.result.current.isLoading).toBe(true));
    await waitFor(() => expect(b.result.current.isLoading).toBe(true));
    expect(requestContextReport).toHaveBeenCalledTimes(1);

    resolve({ report: makeReport(1000) });
    await waitFor(() => expect(a.result.current.report?.fixedTotal).toBe(1000));
    expect(b.result.current.report?.fixedTotal).toBe(1000);
  });

  it("surfaces a failed scan instead of an indefinitely empty panel", async () => {
    requestContextReport.mockRejectedValue(new Error("daemon exploded"));

    const { result } = renderQuery();

    await waitFor(() => expect(result.current.error).toBe("daemon exploded"));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.report).toBeNull();
  });
});
