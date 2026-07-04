import { describe, expect, test } from "vitest";
import { getOttoBrowserIdForWebContents, registerOttoBrowserWebContents } from "./index.js";

class FakeRegisteredWebContents {
  public readonly backgroundThrottlingCalls: boolean[] = [];
  private destroyedListener: (() => void) | null = null;
  private destroyed = false;

  public constructor(public readonly id: number) {}

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public setBackgroundThrottling(allowed: boolean): void {
    this.backgroundThrottlingCalls.push(allowed);
  }

  public once(event: "destroyed", listener: () => void): void {
    expect(event).toBe("destroyed");
    this.destroyedListener = listener;
  }

  public destroy(): void {
    this.destroyed = true;
    this.destroyedListener?.();
  }
}

describe("registerOttoBrowserWebContents", () => {
  test("disables guest background throttling once when the webview is registered", () => {
    const contents = new FakeRegisteredWebContents(9001);

    registerOttoBrowserWebContents(contents, "browser-throttle");

    expect(contents.backgroundThrottlingCalls).toEqual([false]);
    expect(getOttoBrowserIdForWebContents(contents)).toBe("browser-throttle");

    contents.destroy();

    expect(getOttoBrowserIdForWebContents(contents)).toBeNull();
    expect(contents.backgroundThrottlingCalls).toEqual([false]);
  });
});
