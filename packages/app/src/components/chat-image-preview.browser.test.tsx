import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { KeyboardActionDispatcherProvider } from "@/keyboard/keyboard-action-dispatcher-context";
import { ChatImagePreview } from "./chat-image-preview";

// Storage and interface settings are outside this resolved-image interaction.
vi.mock("@/attachments/use-attachment-preview-url", () => ({
  useAttachmentPreviewUrl: () => null,
}));
vi.mock("@/hooks/use-interface-mode", () => ({
  getIsDeveloperModeSnapshot: () => true,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
const thumbnailStyle = { width: 240, height: 160 };

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

it.each([
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
])("enlarges a screenshot and keeps Close reachable at $width px", async ({ width, height }) => {
  await page.viewport(width, height);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const uri =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="steelblue"/></svg>',
    );
  act(() =>
    root.render(
      <KeyboardActionDispatcherProvider>
        <ChatImagePreview uri={uri} style={thumbnailStyle}>
          <img src={uri} alt="Screenshot thumbnail" width={240} height={160} />
        </ChatImagePreview>
      </KeyboardActionDispatcherProvider>,
    ),
  );

  await act(async () => {
    await page.getByRole("button", { name: "composer.attachments.openImage" }).click();
  });
  const previewSelector = '[data-testid="attachment-lightbox-image"]';
  await expect
    .poll(() => {
      const preview = document.querySelector(previewSelector);
      const image = preview?.querySelector("img");
      return Boolean(image?.complete && image.naturalWidth === 1200);
    })
    .toBe(true);
  const bounds = document.querySelector(previewSelector)!.getBoundingClientRect();
  expect(bounds.width).toBeGreaterThan(240);
  expect(bounds.height).toBeGreaterThan(160);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(width);
  const close = document.querySelector('[data-testid="attachment-lightbox-close"]')!;
  const closeBounds = close.getBoundingClientRect();
  expect(closeBounds.top).toBeGreaterThanOrEqual(0);
  expect(closeBounds.right).toBeLessThanOrEqual(width);
  expect(
    close.contains(
      document.elementFromPoint(
        closeBounds.left + closeBounds.width / 2,
        closeBounds.top + closeBounds.height / 2,
      ),
    ),
  ).toBe(true);
  await act(async () => {
    await page.getByTestId("attachment-lightbox-close").click();
  });
  await expect.poll(() => document.querySelector(previewSelector)).toBeNull();
});
