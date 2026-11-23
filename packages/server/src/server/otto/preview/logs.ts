export interface PreviewLogLine {
  sequence: number;
  source: "stdout" | "stderr";
  text: string;
}
/** Process output is bounded independently of whether any client reads it. */
export class PreviewLogs {
  private lines: PreviewLogLine[] = [];
  private sequence = 0;
  private partial = { stdout: "", stderr: "" };
  append(source: PreviewLogLine["source"], chunk: string): void {
    const pieces = (this.partial[source] + chunk.slice(0, 65536)).split(/\r?\n/);
    this.partial[source] = (pieces.pop() ?? "").slice(0, 1000);
    for (const text of pieces)
      this.lines.push({ sequence: ++this.sequence, source, text: text.slice(0, 1000) });
    this.lines = this.lines.slice(-2000);
  }
  flush(): void {
    for (const source of ["stdout", "stderr"] as const) {
      if (this.partial[source]) this.append(source, "\n");
    }
  }
  read(
    options: { lines?: number; search?: string; level?: "all" | "error" } = {},
  ): PreviewLogLine[] {
    const count = Math.min(2000, Math.max(1, Math.trunc(options.lines ?? 100)));
    const query = options.search?.toLowerCase();
    const matched = this.lines
      .filter(
        (line) =>
          (!query || line.text.toLowerCase().includes(query)) &&
          (options.level !== "error" || /error|exception|failed|fatal/i.test(line.text)),
      )
      .slice(-count);
    const tail: PreviewLogLine[] = [];
    let bytes = 0;
    for (let index = matched.length - 1; index >= 0; index--) {
      const line = matched[index];
      bytes += Buffer.byteLength(JSON.stringify(line), "utf8");
      if (bytes > 128 * 1024) break;
      tail.push(Object.assign({}, line));
    }
    return tail.toReversed();
  }
}
