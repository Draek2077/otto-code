// Measures what a hosted browser tab costs to watch: bytes on the wire, frames
// delivered, how soon a scroll shows up, and CPU time.
//
// It drives RemoteBrowserManager the way a client does, against pages served
// from this process, so a change to capture or pacing can be compared with the
// run before it. Usage:
//
//   npm run measure:hosted-browser --workspace=@otto-code/server
//   OTTO_STREAM_BENCH_SECONDS=30 OTTO_STREAM_BENCH_STRATEGY=push npm run ...
//
// `fixed` is the original client loop, a request every 900 ms (150 ms while
// scrolling). Keep it so old numbers stay reproducible. `push` holds the
// request until the page repaints. `binary` is `push` with the picture sent as
// bytes, which is what the app uses now.
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import type { Page } from "playwright";
import {
  FRAME_LONG_POLL_MS,
  nextFramePollDelayMs,
} from "@otto-code/protocol/browser-remote/frame-pacing";
import { encodeBrowserFrame } from "@otto-code/protocol/binary-frames/browser-frame";
import { RemoteBrowserManager } from "../src/server/browser-tools/remote-browser-manager.js";

type Strategy = "fixed" | "push" | "binary";
type Scenario = "static" | "caret" | "animated" | "video" | "scroll";

const SECONDS = readPositiveInteger("OTTO_STREAM_BENCH_SECONDS", 20);
const STRATEGIES = readList<Strategy>("OTTO_STREAM_BENCH_STRATEGY", ["fixed", "push", "binary"]);
const SCENARIOS = readList<Scenario>("OTTO_STREAM_BENCH_SCENARIO", [
  "static",
  "caret",
  "animated",
  "video",
  "scroll",
]);
const VIEWPORT = { mode: "fixed" as const, width: 390, height: 844 };
const WORKSPACE = "stream-bench";
// As long as a request id the client generates; one rides in every picture frame.
const REQUEST_ID = "browser-mg3k2p9x-1024";

const PAGES: Record<Scenario, string> = {
  static: page("<h1>Static page</h1><p>Nothing here moves.</p>".repeat(8)),
  // A focused field blinks its caret: the smallest real change a page makes.
  caret: page('<h1>Focused field</h1><input id="field" autofocus style="font-size:24px">'),
  animated: page(
    `<h1>Animated</h1><div id="box" style="width:80px;height:80px;background:#2563eb;position:absolute;top:200px"></div>
     <script>let x=0;function step(){x=(x+3)%300;box.style.left=x+"px";requestAnimationFrame(step)}step()</script>`,
  ),
  // Every pixel changes every frame, which is what a playing video looks like.
  video: page(
    `<canvas id="c" width="390" height="700"></canvas>
     <script>const g=c.getContext("2d");function step(){const d=g.createImageData(390,700);
     for(let i=0;i<d.data.length;i+=4){const v=Math.random()*255;d.data[i]=v;d.data[i+1]=v*0.7;d.data[i+2]=255-v;d.data[i+3]=255}
     g.putImageData(d,0,0);requestAnimationFrame(step)}step()</script>`,
  ),
  scroll: page(
    Array.from(
      { length: 200 },
      (_, index) => `<p style="font-size:20px">Row ${index} of a long page</p>`,
    ).join(""),
  ),
};

interface HostCounters {
  captures: number;
  pushed: number;
  unchanged: number;
}

interface Measurement {
  scenario: Scenario;
  strategy: Strategy;
  seconds: number;
  requests: number;
  frames: number;
  framesPerSecond: number;
  wireKilobytes: number;
  kilobytesPerSecond: number;
  megabytesPerHour: number;
  averageFrameKilobytes: number;
  pageCpuMsPerSecond: number | null;
  daemonCpuMsPerSecond: number;
  hostScreenshots: number;
  hostPushedFrames: number;
  hostUnchangedFrames: number;
  scrollLatencyP50Ms: number | null;
  scrollLatencyP95Ms: number | null;
}

interface ManagerInternals {
  tabs: Map<string, { page: Page | null }>;
}

/** What one client saw while it watched a tab. */
class Viewer {
  requests = 0;
  frames = 0;
  wireBytes = 0;
  activeUntil = 0;
  readonly pendingScrolls: number[] = [];
  readonly scrollLatencies: number[] = [];
  first: HostCounters | null = null;
  last: HostCounters = { captures: 0, pushed: 0, unchanged: 0 };
  private revision: number | undefined;
  private lastHash = "";

  constructor(
    private readonly manager: RemoteBrowserManager,
    private readonly browserId: string,
    private readonly strategy: Strategy,
  ) {}

  async watchUntil(endsAt: number): Promise<void> {
    while (performance.now() < endsAt) {
      const requestedAt = performance.now();
      const remaining = Math.max(1, Math.round(endsAt - requestedAt));
      const response = await this.manager.execute(WORKSPACE, {
        kind: "frame",
        browserId: this.browserId,
        knownRevision: this.revision,
        ...(this.strategy === "fixed" ? {} : { waitMs: Math.min(FRAME_LONG_POLL_MS, remaining) }),
        ...(this.strategy === "binary" ? { binary: true } : {}),
      });
      this.requests++;
      const { frameImage, ...described } = response;
      // What crosses the socket, before transport encryption: the JSON
      // response, and for a binary viewer the picture frame ahead of it.
      this.wireBytes += JSON.stringify(described).length;
      if (frameImage)
        this.wireBytes += encodeBrowserFrame({ requestId: REQUEST_ID, image: frameImage }).length;
      if (response.stream) {
        this.first ??= response.stream;
        this.last = response.stream;
      }
      if (response.frame) this.receive(response.frame.revision, response.frame.dataBase64);
      if (response.binaryFrame && frameImage)
        this.receive(response.binaryFrame.revision, frameImage);
      const receivedFrame = Boolean(response.frame ?? response.binaryFrame);
      await sleep(this.delayAfter(receivedFrame, performance.now() - requestedAt));
    }
  }

  private receive(revision: number, picture: string | Buffer): void {
    this.frames++;
    this.revision = revision;
    const hash = createHash("sha1").update(picture).digest("hex");
    if (hash === this.lastHash) return;
    this.lastHash = hash;
    const now = performance.now();
    // One changed frame answers every scroll sent before it arrived.
    while (this.pendingScrolls.length && this.pendingScrolls[0]! <= now)
      this.scrollLatencies.push(now - this.pendingScrolls.shift()!);
  }

  private delayAfter(receivedFrame: boolean, elapsedMs: number): number {
    if (this.strategy === "fixed") return performance.now() < this.activeUntil ? 150 : 900;
    return nextFramePollDelayMs({ receivedFrame, elapsedMs });
  }
}

function page(body: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="margin:16px;font-family:sans-serif">${body}</body></html>`;
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readList<T extends string>(name: string, fallback: T[]): T[] {
  const value = process.env[name]?.trim();
  return value ? (value.split(",").map((item) => item.trim()) as T[]) : fallback;
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One session for both readings: the counter is only comparable within it.
async function openCpuProbe(target: Page | null): Promise<() => Promise<number | null>> {
  if (!target) return async () => null;
  const session = await target.context().newCDPSession(target);
  await session.send("Performance.enable", { timeDomain: "threadTicks" });
  return async () => {
    const { metrics } = await session.send("Performance.getMetrics");
    return metrics.find((metric) => metric.name === "TaskDuration")?.value ?? null;
  };
}

/** A flick every two seconds: ten wheel steps, then rest. */
async function flick(
  manager: RemoteBrowserManager,
  browserId: string,
  viewer: Viewer,
  endsAt: number,
): Promise<void> {
  while (performance.now() < endsAt - 1_500) {
    for (let step = 0; step < 10 && performance.now() < endsAt; step++) {
      viewer.pendingScrolls.push(performance.now());
      viewer.activeUntil = performance.now() + 1_200;
      await manager.execute(WORKSPACE, {
        kind: "scroll",
        browserId,
        x: 195,
        y: 422,
        deltaX: 0,
        deltaY: 120,
      });
      await sleep(50);
    }
    await sleep(1_500);
  }
}

async function measure(
  manager: RemoteBrowserManager,
  origin: string,
  scenario: Scenario,
  strategy: Strategy,
  index: number,
): Promise<Measurement> {
  const browserId = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  await manager.execute(WORKSPACE, {
    kind: "open",
    browserId,
    url: `${origin}/${scenario}`,
    viewport: VIEWPORT,
  });
  if (scenario === "caret")
    await manager.execute(WORKSPACE, { kind: "tap", browserId, x: 60, y: 90 });
  // Let the first paint settle so it is not counted as stream traffic.
  await manager.execute(WORKSPACE, { kind: "frame", browserId });
  await sleep(1_500);

  const target = (manager as unknown as ManagerInternals).tabs.get(browserId)?.page ?? null;
  const readPageCpu = await openCpuProbe(target);
  const pageCpuBefore = await readPageCpu();
  const daemonCpuBefore = process.cpuUsage();
  const viewer = new Viewer(manager, browserId, strategy);
  const startedAt = performance.now();
  const endsAt = startedAt + SECONDS * 1_000;

  await Promise.all([
    viewer.watchUntil(endsAt),
    scenario === "scroll" ? flick(manager, browserId, viewer, endsAt) : Promise.resolve(),
  ]);

  const seconds = (performance.now() - startedAt) / 1_000;
  const pageCpuAfter = await readPageCpu();
  const daemonCpu = process.cpuUsage(daemonCpuBefore);
  await manager.execute(WORKSPACE, { kind: "close", browserId });
  const kilobytes = viewer.wireBytes / 1_024;
  const first = viewer.first ?? viewer.last;
  return {
    scenario,
    strategy,
    seconds: Math.round(seconds * 10) / 10,
    requests: viewer.requests,
    frames: viewer.frames,
    framesPerSecond: Math.round((viewer.frames / seconds) * 100) / 100,
    wireKilobytes: Math.round(kilobytes),
    kilobytesPerSecond: Math.round((kilobytes / seconds) * 10) / 10,
    megabytesPerHour: Math.round(((kilobytes / seconds) * 3_600) / 1_024),
    averageFrameKilobytes: viewer.frames ? Math.round((kilobytes / viewer.frames) * 10) / 10 : 0,
    pageCpuMsPerSecond:
      pageCpuBefore === null || pageCpuAfter === null
        ? null
        : Math.round(((pageCpuAfter - pageCpuBefore) * 1_000) / seconds),
    daemonCpuMsPerSecond: Math.round((daemonCpu.user + daemonCpu.system) / 1_000 / seconds),
    hostScreenshots: viewer.last.captures - first.captures,
    hostPushedFrames: viewer.last.pushed - first.pushed,
    hostUnchangedFrames: viewer.last.unchanged - first.unchanged,
    scrollLatencyP50Ms: percentile(viewer.scrollLatencies, 0.5),
    scrollLatencyP95Ms: percentile(viewer.scrollLatencies, 0.95),
  };
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

async function main(): Promise<void> {
  const server = createServer((request, response) => {
    const scenario = (request.url ?? "/").slice(1) as Scenario;
    response.writeHead(PAGES[scenario] ? 200 : 404, { "content-type": "text/html" });
    response.end(PAGES[scenario] ?? "");
  });
  const origin = await listen(server);
  const manager = new RemoteBrowserManager();
  const results: Measurement[] = [];
  try {
    let index = 0;
    for (const scenario of SCENARIOS) {
      for (const strategy of STRATEGIES) {
        results.push(await measure(manager, origin, scenario, strategy, ++index));
        process.stderr.write(`${scenario}/${strategy} done\n`);
      }
    }
  } finally {
    await manager.close();
    server.close();
  }
  console.table(
    results.map((result) => ({
      scenario: result.scenario,
      strategy: result.strategy,
      "frames/s": result.framesPerSecond,
      "KB/s": result.kilobytesPerSecond,
      "MB/hour": result.megabytesPerHour,
      "KB/frame": result.averageFrameKilobytes,
      "page CPU ms/s": result.pageCpuMsPerSecond,
      "daemon CPU ms/s": result.daemonCpuMsPerSecond,
      screenshots: result.hostScreenshots,
      pushed: result.hostPushedFrames,
      "scroll p50 ms": result.scrollLatencyP50Ms,
      "scroll p95 ms": result.scrollLatencyP95Ms,
    })),
  );
  console.log(
    JSON.stringify({ measuredAt: new Date().toISOString(), viewport: VIEWPORT, results }),
  );
}

await main();
