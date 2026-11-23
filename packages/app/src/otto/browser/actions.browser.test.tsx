import React, { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { within } from "@testing-library/dom";
import { userEvent } from "@vitest/browser/context";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { i18n as testI18n } from "@/i18n/i18next";
import type { DesktopHostBridge } from "@/desktop/host";
import type { FindableGuest } from "./find-controller";
import { useOttoBrowserActions } from "./actions.electron";

void testI18n;
const metrics = {
  frame: { x: 0, y: 0, width: 1280, height: 720 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const trigger = { width: 28, height: 28 };
function triggerStyle() {
  return trigger;
}
type Guest = HTMLDivElement & FindableGuest;
function Fixture({ guest }: { guest: Guest }) {
  const guestRef = useMemo(() => ({ current: guest }), [guest]);
  const actions = useOttoBrowserActions({
    browserId: "fixture",
    pageUrl: "https://fixture.test/page",
    active: true,
    guestRef,
    triggerStyle,
  });
  return (
    <>
      {actions.more}
      {actions.findBar}
      {actions.error}
    </>
  );
}
let previousHost: DesktopHostBridge | undefined;
let root: Root | undefined;
let container: HTMLDivElement | undefined;
let frame: HTMLIFrameElement | undefined;
beforeEach(() => {
  vi.stubGlobal("React", React);
  previousHost = window.paseoDesktop;
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  frame?.remove();
  root = undefined;
  container = undefined;
  frame = undefined;
  window.paseoDesktop = previousHost;
  vi.unstubAllGlobals();
});
function mount(guest: Guest = document.createElement("div")) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <SafeAreaProvider initialMetrics={metrics}>
        <Fixture guest={guest} />
      </SafeAreaProvider>,
    ),
  );
  return within(document.body);
}
function testId(id: string): HTMLElement {
  const node = document.querySelector(`[data-testid="${id}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing ${id}`);
  return node;
}
async function openMore() {
  await userEvent.click(testId("browser-more-actions"));
}
test("the real Find bar searches the existing page, navigates matches and clears highlights on close", async () => {
  frame = document.createElement("iframe");
  const loaded = new Promise<void>((resolve) =>
    frame!.addEventListener("load", () => resolve(), { once: true }),
  );
  frame.srcdoc = "<p>Café cafe cafeteria</p>";
  document.body.appendChild(frame);
  await loaded;
  const guestWindow = frame.contentWindow;
  if (!guestWindow) throw new Error("Missing fixture page");
  const evaluate: unknown = Reflect.get(guestWindow, "eval");
  if (typeof evaluate !== "function") throw new Error("Missing page evaluation");
  const guest = Object.assign(document.createElement("div"), {
    executeJavaScript: async (code: string): Promise<unknown> =>
      Reflect.apply(evaluate, guestWindow, [code]),
  });
  const view = mount(guest);
  await openMore();
  await userEvent.click(testId("browser-find-action"));
  const input = view.getByRole<HTMLInputElement>("textbox", { name: "Find in page" });
  await userEvent.fill(input, "cafe");
  await vi.waitFor(() => expect(view.getByText("1 of 3")).toBeVisible());
  await userEvent.click(view.getByRole("button", { name: "Next match" }));
  await vi.waitFor(() => expect(view.getByText("2 of 3")).toBeVisible());
  await userEvent.click(view.getByRole("checkbox", { name: "Whole Words" }));
  await vi.waitFor(() => expect(view.getByText("1 of 2")).toBeVisible());
  await userEvent.click(view.getByRole("button", { name: "Close find in page" }));
  expect(view.queryByRole("textbox", { name: "Find in page" })).toBeNull();
  await vi.waitFor(() =>
    expect(Reflect.apply(evaluate, guestWindow, ["CSS.highlights.has('otto-page-find-all')"])).toBe(
      false,
    ),
  );
  expect(frame.contentDocument?.body.textContent).toBe("Café cafe cafeteria");
});
test("external opening exposes pending and success without duplicate admission", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const open = vi.fn(() => pending);
  window.paseoDesktop = { opener: { openUrl: open } };
  const view = mount();
  await openMore();
  await userEvent.click(testId("browser-external-action"));
  await vi.waitFor(() => expect(view.getByText("Opening external browser")).toBeVisible());
  expect(testId("browser-external-action").getAttribute("aria-disabled")).toBe("true");
  expect(open).toHaveBeenCalledExactlyOnceWith("https://fixture.test/page");
  await act(async () => {
    finish();
    await pending;
  });
  await vi.waitFor(() => expect(view.getByText("Opened external browser")).toBeVisible());
});
test("external opening failure stays visible and a new explicit attempt can recover", async () => {
  const open = vi
    .fn<(url: string) => Promise<void>>()
    .mockRejectedValueOnce(Error("private operating-system diagnostic"))
    .mockResolvedValue(undefined);
  window.paseoDesktop = { opener: { openUrl: open } };
  const view = mount();
  await openMore();
  await userEvent.click(testId("browser-external-action"));
  await vi.waitFor(() =>
    expect(view.getByText("The page could not be opened in your external browser.")).toBeVisible(),
  );
  expect(view.queryByText("private operating-system diagnostic")).toBeNull();
  await userEvent.click(testId("browser-external-action"));
  await vi.waitFor(() => expect(view.getByText("Opened external browser")).toBeVisible());
  expect(view.queryByText("The page could not be opened in your external browser.")).toBeNull();
  expect(open).toHaveBeenCalledTimes(2);
});
