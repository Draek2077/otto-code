import type { ElementHandle, Page } from "playwright-core";
import { BrowserSnapshotEngine } from "@getpaseo/plugin/server/otto-browser";
import { createBrowserToolsRequestError } from "../../../browser-tools/errors.js";
export class HostBrowserRefs {
  readonly snapshots = new BrowserSnapshotEngine();
  clear(browserId: string) {
    this.snapshots.clearBrowser(browserId);
  }
  page(page: Page) {
    return {
      getURL: () => page.url(),
      executeJavaScript: (code: string) => page.evaluate<unknown>(code),
    };
  }
  expression(browserId: string, ref: string): string {
    const expression = this.snapshots.runtimeElementExpression({ browserId, ref });
    if (typeof expression !== "string") throw this.stale();
    return expression;
  }
  private stale() {
    return createBrowserToolsRequestError({
      code: "browser_stale_ref",
      message: "This element ref is stale or missing. Read a fresh browser_snapshot before acting.",
    });
  }
  async element(page: Page, browserId: string, ref: string): Promise<ElementHandle> {
    const handle = await page.evaluateHandle(this.expression(browserId, ref));
    const element = handle.asElement();
    if (!element) {
      await handle.dispose();
      throw this.stale();
    }
    return element;
  }
  async withElement<T>(
    page: Page,
    browserId: string,
    ref: string,
    action: (element: ElementHandle) => Promise<T>,
  ): Promise<T> {
    const element = await this.element(page, browserId, ref);
    try {
      return await action(element);
    } finally {
      await element.dispose();
    }
  }
  async value(kind: "fill" | "select", page: Page, browserId: string, ref: string, value: string) {
    const input = { page: this.page(page), browserId, ref, value };
    const result =
      kind === "fill" ? await this.snapshots.fill(input) : await this.snapshots.select(input);
    if (!result.ok) throw this.stale();
  }
}
