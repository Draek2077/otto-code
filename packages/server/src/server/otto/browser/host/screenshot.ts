import { z } from "zod";
import type { CDPSession, Page } from "playwright-core";
const sizeSchema = z.object({
  cssContentSize: z.object({
    width: z.number().positive().finite(),
    height: z.number().positive().finite(),
  }),
});
const pixelsSchema = z.object({ data: z.string().min(1).max(700_000) });
export function hostScreenshotScale(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error("The host page has no positive capture geometry.");
  return Math.min(1, 1568 / Math.max(width, height), Math.sqrt(1_150_000 / (width * height)));
}
export async function hostScreenshot(page: Page, cdp: CDPSession, fullPage: boolean) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("The host page has no viewport.");
  const size = fullPage
    ? sizeSchema.parse(await cdp.send("Page.getLayoutMetrics")).cssContentSize
    : viewport;
  const scale = hostScreenshotScale(size.width, size.height);
  const result = pixelsSchema.safeParse(
    await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: fullPage,
      clip: { x: 0, y: 0, width: size.width, height: size.height, scale },
    }),
  );
  if (!result.success)
    throw new Error(
      "The host screenshot exceeded its transport budget. Reduce the viewport or capture the visible page.",
    );
  return {
    mimeType: "image/png" as const,
    dataBase64: result.data.data,
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}
