import type { ServerResponse } from "node:http";
import type { BrainLogPublisher, BrainStatusPublisher } from "./status-events.js";

/** A slow reader reconnects to a complete snapshot instead of growing an unbounded queue. */
export function serveEngineEvents(
  response: ServerResponse,
  status: BrainStatusPublisher,
  logs: BrainLogPublisher,
  instanceId: string,
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-store",
    "x-accel-buffering": "no",
  });
  response.write(": Brain events\n\n");
  let unsubscribeStatus = () => {};
  let unsubscribeLogs = () => {};
  let closed = false;
  const teardown = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribeStatus();
    unsubscribeLogs();
  };
  const write = (event: string, data: unknown) => {
    if (closed || response.destroyed) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    if (Buffer.byteLength(frame) > 256 * 1024 || !response.write(frame)) {
      teardown();
      response.destroy();
    }
  };
  const heartbeat = setInterval(() => {
    if (!response.write(": keepalive\n\n")) {
      teardown();
      response.destroy();
    }
  }, 15000);
  heartbeat.unref();
  response.once("close", teardown);
  response.once("error", teardown);
  unsubscribeStatus = status.subscribe(
    (snapshot) => write("status", snapshot),
    () => {
      teardown();
      response.end();
    },
  );
  unsubscribeLogs = logs.subscribe((line, index) => write("log", { line, index, instanceId }));
  // subscribe can synchronously replay a snapshot and discover a closed reader.
  if (closed) {
    unsubscribeStatus();
    unsubscribeLogs();
  }
}
