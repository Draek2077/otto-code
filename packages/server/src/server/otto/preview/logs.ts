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
    return this.lines
      .filter(
        (line) =>
          (!query || line.text.toLowerCase().includes(query)) &&
          (options.level !== "error" || /error|exception|failed|fatal/i.test(line.text)),
      )
      .slice(-count)
      .map((line) => Object.assign({}, line));
  }
}
