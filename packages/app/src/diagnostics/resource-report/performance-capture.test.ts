import { beforeEach, expect, test, vi } from "vitest";

// Isolate the save boundary: the daemon promise deliberately outlives the UI capture.
const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  diagnostics: vi.fn(),
  longFrames: vi.fn(),
  dom: vi.fn(),
  dispatch: vi.fn(),
  listener: null as
    | null
    | ((frame: {
        at: number;
        durationMs: number;
        blockingMs: number;
        styleAndLayoutMs: number;
        scripts: [];
      }) => void),
  unsubscribe: vi.fn(),
}));
vi.mock("@/desktop/electron/invoke", () => ({ invokeDesktopCommand: mock.invoke }));
vi.mock("@/desktop/host", () => ({ isElectronRuntime: () => true }));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getSnapshots: () => [
      {
        serverId: "host",
        connectionStatus: "online",
        client: {
          getInboundDispatchTimings: mock.dispatch,
          collectDiagnostics: mock.diagnostics,
          getLastServerInfoMessage: () => ({ features: { daemonDiagnostics: true } }),
        },
      },
    ],
  }),
}));
vi.mock("./resource-monitor", () => ({
  resourceMonitor: { start() {}, reset() {}, takeSample() {}, getSamples: () => [] },
}));
vi.mock("./collect-resource-metrics", () => ({
  collectQueryHotspots: () => [],
  collectTrafficHotspots: () => [],
  getCensusStats: () => ({}),
}));
vi.mock("./runtime-counters", () => ({ getSlowTimerCallbacks: () => [] }));
vi.mock("./dom-write-attribution", () => ({
  getDomWriteReport: mock.dom,
  startDomWriteAttribution() {},
  stopDomWriteAttribution() {},
}));
vi.mock("./long-frame-attribution", () => ({
  getLongFrameReport: mock.longFrames,
  flushLongFrameAttribution() {},
  subscribeLongFrames: (listener: typeof mock.listener) => {
    mock.listener = listener;
    return mock.unsubscribe;
  },
}));

import { startPerformanceCapture, stopPerformanceCapture } from "./performance-capture";

beforeEach(() => {
  vi.clearAllMocks();
  mock.longFrames.mockReturnValue({
    supported: true,
    entries: [],
    aggregate: [],
    totalLongFrames: 0,
  });
  mock.dom.mockReturnValue({
    batches: [],
    totalRecords: 0,
    observerOverhead: { calls: 0, totalMs: 0, maxMs: 0 },
  });
  mock.dispatch.mockReturnValue([]);
  mock.invoke.mockResolvedValue({ path: "capture.json" });
});

test("freezes client evidence before waiting for daemon diagnostics and labels missing scripts", async () => {
  let finish!: (value: { diagnostic: string }) => void;
  mock.diagnostics.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  startPerformanceCapture();
  mock.listener?.({
    at: Date.now() + 1,
    durationMs: 100,
    blockingMs: 50,
    styleAndLayoutMs: 1,
    scripts: [],
  });
  const stopping = stopPerformanceCapture();
  expect(mock.unsubscribe).toHaveBeenCalledOnce();
  expect(mock.longFrames).toHaveBeenCalledOnce();
  const savedBefore = Date.now();
  // Evidence reads after this point would incorrectly include the save's own work.
  mock.longFrames.mockImplementation(() => {
    throw new Error("read after stop");
  });
  mock.dom.mockImplementation(() => {
    throw new Error("read after stop");
  });
  finish({ diagnostic: "daemon collected later" });
  await stopping;
  const saved = JSON.parse(mock.invoke.mock.calls[0][1].contents);
  expect(Date.parse(saved.stoppedAt)).toBeLessThanOrEqual(savedBefore);
  expect(saved.attribution.status).toBe("missing-scripts");
  expect(saved.frameEvidence.totalFrames).toBe(1);
  expect(saved.daemonDiagnostics[0].diagnostic).toBe("daemon collected later");
});

test("save failure releases tracing so another capture can start", async () => {
  mock.diagnostics.mockResolvedValue({ diagnostic: "ok" });
  mock.invoke.mockRejectedValueOnce(new Error("disk full"));
  startPerformanceCapture();
  await stopPerformanceCapture();
  startPerformanceCapture();
  await stopPerformanceCapture();
  expect(mock.invoke).toHaveBeenCalledTimes(2);
  expect(mock.unsubscribe).toHaveBeenCalledTimes(2);
});
