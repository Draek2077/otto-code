import type { HostBrowserInput } from "@getpaseo/plugin/otto/host-browser";
type Pointer = Extract<HostBrowserInput, { kind: "pointer" }>;
type Key = Extract<HostBrowserInput, { kind: "key" }>;
type Touch = Extract<HostBrowserInput, { kind: "touch" }>;
/** One page's native input state. Viewer release cannot leave modifiers, buttons or touch contacts latched. */
export class HostBrowserInputs {
  private readonly keys = new Map<string, string>();
  private readonly buttons = new Map<Pointer["button"], string>();
  private touchOwner: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private closed = false;
  constructor(
    private readonly port: {
      pointer(event: Pointer): Promise<void>;
      releaseButton(button: Pointer["button"]): Promise<void>;
      key(event: Key): Promise<void>;
      touch(event: Touch): Promise<void>;
      text(text: string): Promise<void>;
      wheel(event: Extract<HostBrowserInput, { kind: "wheel" }>): Promise<void>;
    },
  ) {}
  private serial(operation: () => Promise<void>): Promise<void> {
    this.pending++;
    const next = this.queue
      .then(async () => {
        if (!this.closed) await operation();
        return;
      })
      .finally(() => {
        this.pending--;
      });
    this.queue = next.catch(() => {});
    return next;
  }
  dispatch(ticket: string, input: HostBrowserInput): Promise<void> {
    if (this.closed || this.pending >= 64)
      return Promise.reject(new Error("The Host Browser input queue is unavailable or full."));
    const owner = ticket.toLowerCase();
    return this.serial(async () => {
      switch (input.kind) {
        case "pointer":
          return this.pointer(owner, input);
        case "key":
          return this.key(owner, input);
        case "touch":
          return this.touch(owner, input);
        case "text":
          return this.port.text(input.text);
        case "wheel":
          return this.port.wheel(input);
      }
    });
  }
  private async pointer(owner: string, input: Pointer) {
    if (input.phase === "down") this.buttons.set(input.button, owner);
    if (input.phase === "up" && this.buttons.get(input.button) !== owner) return;
    await this.port.pointer(input);
    if (input.phase === "up") this.buttons.delete(input.button);
  }
  private async key(owner: string, input: Key) {
    if (input.phase === "down") {
      if (!this.keys.has(input.key) && this.keys.size >= 64)
        throw new Error("Too many held Host Browser keys.");
      this.keys.set(input.key, owner);
    }
    if (input.phase === "up" && this.keys.get(input.key) !== owner) return;
    await this.port.key(input);
    if (input.phase === "up") this.keys.delete(input.key);
  }
  private async touch(owner: string, input: Touch) {
    if ((input.phase === "end" || input.phase === "cancel") && input.points.length)
      throw new Error("Ending or canceling a touch gesture requires an empty contact list.");
    if ((input.phase === "start" || input.phase === "move") && !input.points.length)
      throw new Error("An active touch needs a contact.");
    if (new Set(input.points.map((point) => point.id)).size !== input.points.length)
      throw new Error("Duplicate touch identities are not valid.");
    if (input.phase === "start" && !this.touchOwner) this.touchOwner = owner;
    if (this.touchOwner !== owner)
      throw new Error("This viewer does not own the active touch gesture.");
    await this.port.touch(input);
    if (input.phase === "cancel" || (input.phase === "end" && !input.points.length))
      this.touchOwner = null;
  }
  release(ticket: string): Promise<void> {
    // Cleanup is always admitted, including when input backpressure has reached its limit.
    const owner = ticket.toLowerCase();
    return this.serial(async () => {
      const failures: unknown[] = [];
      for (const [key, heldBy] of this.keys)
        if (heldBy === owner) {
          try {
            await this.port.key({ kind: "key", phase: "up", key });
          } catch (error) {
            failures.push(error);
          }
          this.keys.delete(key);
        }
      for (const [button, heldBy] of this.buttons)
        if (heldBy === owner) {
          try {
            await this.port.releaseButton(button);
          } catch (error) {
            failures.push(error);
          }
          this.buttons.delete(button);
        }
      if (this.touchOwner === owner) {
        try {
          await this.port.touch({ kind: "touch", phase: "cancel", points: [] });
        } catch (error) {
          failures.push(error);
        }
        this.touchOwner = null;
      }
      if (failures.length)
        throw new AggregateError(
          failures,
          "Host Browser could not release this viewer's native input.",
          { cause: failures[0] },
        );
    });
  }
  close() {
    this.closed = true;
    this.keys.clear();
    this.buttons.clear();
    this.touchOwner = null;
  }
}
