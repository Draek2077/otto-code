export class EditorScrollLink {
  private enabled = false;
  private readonly source = new Set<(fraction: number) => void>();
  private readonly preview = new Set<(fraction: number) => void>();
  private expected: { source?: number; preview?: number } = {};
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.expected = {};
  }
  isEnabled = () => this.enabled;
  listen(side: "source" | "preview", listener: (fraction: number) => void) {
    this[side].add(listener);
    return () => {
      this[side].delete(listener);
    };
  }
  report(side: "source" | "preview", value: number) {
    if (!this.enabled || !Number.isFinite(value)) return;
    const fraction = Math.max(0, Math.min(1, value));
    const expected = this.expected[side];
    if (expected !== undefined && Math.abs(expected - fraction) < 0.002) return;
    this.expected[side] = undefined;
    const target = side === "source" ? "preview" : "source";
    this.expected[target] = fraction;
    for (const listener of this[target]) listener(fraction);
  }
}
