/** Bounded decoder shared by CLI and daemon readers of the Brain host feed. */
export interface BrainHostEvent {
  event: "status" | "log";
  data: Record<string, unknown>;
}
const MAX_FRAME_BYTES = 256 * 1024;

export class BrainEventDecoder {
  private pending = "";
  constructor(private readonly receive: (event: BrainHostEvent) => void) {}

  push(text: string): void {
    this.pending += text;
    for (;;) {
      const boundary = /\r?\n\r?\n/u.exec(this.pending);
      if (!boundary) break;
      const frame = this.pending.slice(0, boundary.index);
      this.pending = this.pending.slice(boundary.index + boundary[0].length);
      this.frame(frame);
    }
    if (Buffer.byteLength(this.pending) > MAX_FRAME_BYTES)
      throw new Error("Brain event frame exceeds its byte limit");
  }

  private frame(frame: string): void {
    if (Buffer.byteLength(frame) > MAX_FRAME_BYTES)
      throw new Error("Brain event frame exceeds its byte limit");
    let event = "";
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/u)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (event !== "status" && event !== "log") return;
    const parsed: unknown = JSON.parse(data.join("\n"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error("Invalid Brain event data");
    this.receive({ event, data: parsed as Record<string, unknown> });
  }
}
