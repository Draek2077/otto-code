import * as fs from "node:fs";

/**
 * One appended JSONL file, read incrementally by byte offset with a
 * partial-line buffer. Shared by the transcript watchers (workflow +
 * plain-Task) that tail the CLI's live-written sub-agent transcripts.
 */
export class JsonlTail {
  private offset = 0;
  private partial = "";

  constructor(private readonly filePath: string) {}

  readNew(): unknown[] {
    let size: number;
    try {
      size = fs.statSync(this.filePath).size;
    } catch {
      return [];
    }
    if (size < this.offset) {
      // Truncated/rewritten — restart from the top.
      this.offset = 0;
      this.partial = "";
    }
    if (size === this.offset) {
      return [];
    }
    let chunk = "";
    const fd = fs.openSync(this.filePath, "r");
    try {
      const length = size - this.offset;
      const buffer = Buffer.allocUnsafe(length);
      const read = fs.readSync(fd, buffer, 0, length, this.offset);
      this.offset += read;
      chunk = buffer.toString("utf8", 0, read);
    } finally {
      fs.closeSync(fd);
    }
    this.partial += chunk;
    const lines = this.partial.split("\n");
    this.partial = lines.pop() ?? "";
    const out: unknown[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        out.push(JSON.parse(trimmed));
      } catch {
        // A partial line mid-append; the next read will complete it.
      }
    }
    return out;
  }
}
